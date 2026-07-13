import crypto from 'node:crypto';
import { db } from '../db.js';
import type { DeviceCapabilities } from '../playback.js';
import {
  PLAYBACK_PROTOCOL_PRIORITY,
  type DiscoveredPlaybackDevice,
  type PlaybackDevice,
  type PlaybackDeviceOnlineState,
  type PlaybackDeviceProtocol,
} from './types.js';
import { capabilityProfileFor } from './profiles.js';
import { databaseTimestampMs } from '../time.js';

const EMPTY_CAPABILITIES: DeviceCapabilities = {
  platform: 'unknown', maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30, maxBitrateMbps: 12,
  containers: ['mp4'], videoCodecs: ['h264'], maxBitDepth: 8, hdrFormats: ['sdr'], dolbyVisionProfiles: [],
  audioCodecs: ['aac'], maxAudioChannels: 2, passthrough: false, atmos: false, trueHd: false, eac3: false,
  dts: false, subtitleFormats: ['none'], arc: 'unknown',
};

const safeJson = <T>(value: unknown, fallback: T): T => {
  try { return typeof value === 'string' ? JSON.parse(value) as T : value as T; } catch { return fallback; }
};
const normalized = (value: unknown) => String(value || '').trim().toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '');
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export function protocolForPlatform(platform: string): PlaybackDeviceProtocol {
  const value = normalized(platform);
  if (value.includes('android') || value.includes('googletv')) return 'thuishub-tv-app';
  if (value.includes('tizen') || value.includes('samsung')) return 'thuishub-tv-app';
  if (value.includes('cast')) return 'google-cast';
  if (value.includes('dlna') || value.includes('upnp')) return 'dlna-upnp';
  return 'thuishub-tv-app';
}

export function physicalKeyFor(device: Partial<DiscoveredPlaybackDevice>) {
  const strongest = normalized(device.serialNumber) || normalized(device.udn) || normalized(device.protocolId);
  const addressIdentity = normalized(device.address) && `${normalized(device.address)}:${normalized(device.manufacturer)}:${normalized(device.model)}`;
  const hostIdentity = normalized(device.hostName) && `${normalized(device.hostName)}:${normalized(device.manufacturer)}:${normalized(device.model)}`;
  return digest(strongest || addressIdentity || hostIdentity || `${normalized(device.protocol)}:${normalized(device.name)}:${normalized(device.model)}`);
}

export function stableDeviceId(device: Partial<DiscoveredPlaybackDevice>) {
  if (device.id && /^[a-zA-Z0-9:_-]{8,120}$/.test(device.id)) return device.id;
  return `${device.protocol || 'device'}:${digest(`${device.protocol || ''}:${device.protocolId || device.udn || device.serialNumber || physicalKeyFor(device)}`).slice(0, 32)}`;
}

export function onlineStateFor(lastSeen: string | undefined, now = Date.now()): PlaybackDeviceOnlineState {
  if (!lastSeen) return 'offline';
  const seenAt = databaseTimestampMs(lastSeen);
  if (!Number.isFinite(seenAt)) return 'offline';
  const age = now - seenAt;
  if (age < 0) return 'online';
  if (age <= 90_000) return 'online';
  if (age <= 10 * 60_000) return 'possibly-offline';
  return 'offline';
}

function rowToDevice(row: any): PlaybackDevice {
  const protocol = (row.protocol || protocolForPlatform(row.platform || '')) as PlaybackDeviceProtocol;
  const lastSeen = row.lastSeen || row.last_seen_at || undefined;
  const onlineState = onlineStateFor(lastSeen);
  const profile = capabilityProfileFor({ protocol, manufacturer: row.manufacturer, model: row.model, platform: row.platform });
  const base = safeJson<DeviceCapabilities>(row.capabilities, profile);
  const overrides = safeJson<Partial<DeviceCapabilities>>(row.overrides, {});
  const metadata = safeJson<Record<string, unknown>>(row.discoveryData || row.discovery_data, {});
  return {
    id: row.id,
    name: row.name || 'Onbekend apparaat',
    protocol,
    deviceType: row.deviceType || row.device_type || 'television',
    manufacturer: row.manufacturer || '',
    model: row.model || '',
    address: row.address || undefined,
    port: row.port ? Number(row.port) : undefined,
    online: onlineState === 'online',
    onlineState,
    lastSeen,
    capabilities: { ...EMPTY_CAPABILITIES, ...profile, ...base, ...overrides, platform: base.platform || row.platform || protocol },
    icon: row.icon || (row.device_type === 'audio' ? 'speaker' : protocol === 'google-cast' ? 'cast' : 'tv'),
    requiresPairing: Boolean(row.requiresPairing ?? row.requires_pairing),
    paired: Boolean(row.trusted),
    trusted: Boolean(row.trusted),
    protocolId: row.protocolId || row.protocol_id || undefined,
    physicalKey: row.physicalKey || row.physical_key || undefined,
    appVersion: row.appVersion || row.app_version || undefined,
    metadata,
  };
}

export function deduplicateDevices(devices: PlaybackDevice[]) {
  // Provider-ID's (bijvoorbeeld een Cast deviceId en een DLNA UDN) zijn
  // protocolspecifiek. Gebruik daarom daarnaast alleen sterke lokale signalen
  // om twee records van dezelfde fysieke tv samen te voegen. Een IP-adres op
  // zichzelf is onvoldoende: fabrikant of model moet eveneens overeenkomen.
  const parent = devices.map((_, index) => index);
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]));
  const merge = (left: number, right: number) => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const strongKeys = (device: PlaybackDevice) => {
    const metadata = device.metadata || {};
    const keys = new Set<string>();
    if (device.physicalKey) keys.add(`physical:${device.physicalKey}`);
    const address = normalized(device.address);
    const manufacturer = normalized(device.manufacturer);
    const model = normalized(device.model);
    const hostName = normalized(metadata.hostName);
    if (address && (manufacturer || model)) keys.add(`address:${address}:${manufacturer}:${model}`);
    if (hostName && (manufacturer || model)) keys.add(`host:${hostName}:${manufacturer}:${model}`);
    return keys;
  };
  const firstByKey = new Map<string, number>();
  devices.forEach((device, index) => {
    for (const key of strongKeys(device)) {
      const first = firstByKey.get(key);
      if (first === undefined) firstByKey.set(key, index);
      else merge(first, index);
    }
  });
  const groups = new Map<number, PlaybackDevice[]>();
  devices.forEach((device, index) => groups.set(root(index), [...(groups.get(root(index)) || []), device]));
  return [...groups.values()].map(group => group.sort((left, right) => {
    const priority = PLAYBACK_PROTOCOL_PRIORITY[right.protocol] - PLAYBACK_PROTOCOL_PRIORITY[left.protocol];
    if (priority) return priority;
    if (left.online !== right.online) return left.online ? -1 : 1;
    return String(right.lastSeen || '').localeCompare(String(left.lastSeen || ''));
  })[0]).sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1;
    return left.name.localeCompare(right.name, 'nl');
  });
}

export class PlaybackDeviceRegistry {
  upsertDiscovered(device: DiscoveredPlaybackDevice) {
    const id = stableDeviceId(device);
    const now = device.lastSeen || new Date().toISOString();
    const physicalKey = physicalKeyFor(device);
    const profile = capabilityProfileFor(device);
    const capabilities = { ...EMPTY_CAPABILITIES, ...profile, ...(device.capabilities || {}), platform: device.capabilities?.platform || profile.platform || device.protocol };
    db.prepare(`INSERT INTO playback_devices(
      id,name,manufacturer,model,platform,app_version,capabilities,overrides,trusted,last_seen_at,
      protocol,device_type,address,port,online_state,protocol_id,physical_key,requires_pairing,icon,discovery_data
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,manufacturer=excluded.manufacturer,model=excluded.model,platform=excluded.platform,
      app_version=excluded.app_version,capabilities=excluded.capabilities,last_seen_at=excluded.last_seen_at,
      protocol=excluded.protocol,device_type=excluded.device_type,address=excluded.address,port=excluded.port,
      online_state='online',protocol_id=excluded.protocol_id,physical_key=excluded.physical_key,
      requires_pairing=excluded.requires_pairing,icon=excluded.icon,discovery_data=excluded.discovery_data`).run(
      id, String(device.name || 'Onbekend apparaat').slice(0, 100), String(device.manufacturer || '').slice(0, 100),
      String(device.model || '').slice(0, 100), device.capabilities?.platform || device.protocol,
      String(device.appVersion || '').slice(0, 30), JSON.stringify(capabilities), '{}', Number(Boolean(device.trusted)), now,
      device.protocol, device.deviceType || 'television', device.address || null, device.port || null, 'online',
      device.protocolId || device.udn || null, physicalKey, Number(Boolean(device.requiresPairing)), device.icon || 'tv',
      JSON.stringify({ ...(device.metadata || {}), hostName: device.hostName, udn: device.udn }),
    );
    if (device.protocolId || device.udn || device.serialNumber) {
      db.prepare(`INSERT INTO playback_device_identities(device_id,protocol,protocol_id,address,port,metadata,updated_at)
        VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(protocol,protocol_id) DO UPDATE SET
        device_id=excluded.device_id,address=excluded.address,port=excluded.port,metadata=excluded.metadata,updated_at=CURRENT_TIMESTAMP`).run(
        id, device.protocol, device.protocolId || device.udn || device.serialNumber, device.address || null, device.port || null,
        JSON.stringify({ serialNumberHash: device.serialNumber ? digest(device.serialNumber) : undefined, hostName: device.hostName }),
      );
    }
    return this.get(id);
  }

  touch(id: string, address?: string) {
    db.prepare(`UPDATE playback_devices SET last_seen_at=CURRENT_TIMESTAMP,online_state='online',address=COALESCE(?,address) WHERE id=?`).run(address || null, id);
  }

  markProviderMissing(protocol: PlaybackDeviceProtocol, seenIds: string[]) {
    const placeholders = seenIds.map(() => '?').join(',');
    const sql = `UPDATE playback_devices SET online_state=CASE
      WHEN last_seen_at >= datetime('now','-90 seconds') THEN 'online'
      WHEN last_seen_at >= datetime('now','-10 minutes') THEN 'possibly-offline'
      ELSE 'offline' END WHERE protocol=?${seenIds.length ? ` AND id NOT IN (${placeholders})` : ''}`;
    db.prepare(sql).run(protocol, ...seenIds);
  }

  get(id: string) {
    const row = db.prepare(`SELECT *,last_seen_at lastSeen,app_version appVersion,device_type deviceType,
      protocol_id protocolId,physical_key physicalKey,requires_pairing requiresPairing,discovery_data discoveryData
      FROM playback_devices WHERE id=?`).get(id) as any;
    return row ? rowToDevice(row) : null;
  }

  getForUser(id: string, userId: number) {
    const row = db.prepare(`SELECT *,last_seen_at lastSeen,app_version appVersion,device_type deviceType,
      protocol_id protocolId,physical_key physicalKey,requires_pairing requiresPairing,discovery_data discoveryData
      FROM playback_devices WHERE id=? AND (user_id=? OR (user_id IS NULL AND requires_pairing=0))`).get(id, userId) as any;
    return row ? rowToDevice(row) : null;
  }

  list(userId?: number) {
    const rows = db.prepare(`SELECT *,last_seen_at lastSeen,app_version appVersion,device_type deviceType,
      protocol_id protocolId,physical_key physicalKey,requires_pairing requiresPairing,discovery_data discoveryData
      FROM playback_devices WHERE user_id=? OR user_id IS NULL ORDER BY COALESCE(last_seen_at,created_at) DESC`).all(userId || -1) as any[];
    return deduplicateDevices(rows.map(rowToDevice));
  }

  removeStale(retentionDays = 30) {
    const days = Math.min(365, Math.max(1, retentionDays));
    return db.prepare(`DELETE FROM playback_devices WHERE trusted=0 AND last_seen_at < datetime('now',?)`).run(`-${days} days`).changes;
  }
}

export const playbackDeviceRegistry = new PlaybackDeviceRegistry();
export const playbackDeviceRegistryInternals = { EMPTY_CAPABILITIES, rowToDevice };
