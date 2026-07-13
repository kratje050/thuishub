import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';
import type { DeviceCapabilities } from './playback.js';
import { physicalKeyFor, protocolForPlatform } from './playback-devices/registry.js';

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const nowSeconds = () => Math.floor(Date.now() / 1000);
const HDR_FORMATS = new Set(['sdr', 'hdr10', 'hdr10plus', 'hlg', 'dolby-vision']);
const SUBTITLE_FORMATS = new Set(['none', 'srt', 'webvtt', 'ass', 'ssa', 'pgs', 'vobsub', 'unknown']);
const BOOLEAN_CAPABILITIES = ['passthrough', 'atmos', 'trueHd', 'eac3', 'dts', 'play', 'pause', 'stop', 'seek', 'position', 'volume', 'next', 'previous', 'audioTrackSelection', 'subtitleTrackSelection', 'qualitySelection'] as const;

declare global {
  namespace Express { interface Request { playbackDevice?: { id: string; name: string; platform: string; userId: number } } }
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number, integer = false) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const bounded = Math.min(maximum, Math.max(minimum, number));
  return integer ? Math.round(bounded) : Math.round(bounded * 100) / 100;
}

function boundedIdentity(value: unknown, fallback: string, maximum: number, lowerCase = false) {
  const source = typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
  const clean = source.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum);
  const result = clean || fallback;
  return lowerCase ? result.toLowerCase() : result;
}

function stringList(value: unknown, maximum = 32) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  let inspected = 0;
  for (const entry of value) {
    inspected += 1;
    if (result.length >= maximum || inspected > maximum * 4) break;
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim().toLowerCase();
    if (!normalized || normalized.length > 40 || !/^[a-z0-9][a-z0-9+._-]*$/.test(normalized) || result.includes(normalized)) continue;
    result.push(normalized);
  }
  return result;
}

function enumList<T extends string>(value: unknown, allowed: Set<string>, fallback: T[]) {
  const result = stringList(value).filter(entry => allowed.has(entry)) as T[];
  return result.length ? result : fallback;
}

function profileMap(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string[]> = {};
  for (const [rawKey, rawProfiles] of Object.entries(value).slice(0, 16)) {
    const key = stringList([rawKey], 1)[0];
    const profiles = stringList(rawProfiles, 16);
    if (key && profiles.length) result[key] = profiles;
  }
  return Object.keys(result).length ? result : undefined;
}

function levelMap(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [rawKey, rawLevel] of Object.entries(value).slice(0, 16)) {
    const key = stringList([rawKey], 1)[0];
    if (key && typeof rawLevel === 'number' && Number.isFinite(rawLevel)) result[key] = boundedNumber(rawLevel, 0, 0, 1_000);
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeCapabilities(value: unknown): DeviceCapabilities {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const capabilities: DeviceCapabilities = {
    maxWidth: boundedNumber(input.maxWidth, 1920, 320, 16_384, true),
    maxHeight: boundedNumber(input.maxHeight, 1080, 240, 8_640, true),
    maxFrameRate: boundedNumber(input.maxFrameRate, 30, 1, 240),
    maxBitrateMbps: boundedNumber(input.maxBitrateMbps, 12, 0.1, 1_000),
    containers: stringList(input.containers),
    videoCodecs: stringList(input.videoCodecs),
    maxBitDepth: boundedNumber(input.maxBitDepth, 8, 8, 16, true),
    hdrFormats: enumList(input.hdrFormats, HDR_FORMATS, ['sdr']),
    dolbyVisionProfiles: Array.isArray(input.dolbyVisionProfiles)
      ? [...new Set(input.dolbyVisionProfiles.filter((entry): entry is number => typeof entry === 'number' && Number.isInteger(entry) && entry >= 1 && entry <= 20))].slice(0, 20)
      : [],
    audioCodecs: stringList(input.audioCodecs),
    maxAudioChannels: boundedNumber(input.maxAudioChannels, 2, 1, 32, true),
    passthrough: false,
    atmos: false,
    trueHd: false,
    eac3: false,
    dts: false,
    subtitleFormats: enumList(input.subtitleFormats, SUBTITLE_FORMATS, ['none']),
    arc: ['none', 'arc', 'earc', 'unknown'].includes(String(input.arc)) ? input.arc as DeviceCapabilities['arc'] : 'unknown',
  };
  for (const key of BOOLEAN_CAPABILITIES) capabilities[key] = input[key] === true;
  const videoProfiles = profileMap(input.videoProfiles);
  const videoLevels = levelMap(input.videoLevels);
  if (videoProfiles) capabilities.videoProfiles = videoProfiles;
  if (videoLevels) capabilities.videoLevels = videoLevels;
  return capabilities;
}

function cleanupExpiredPairings(at = nowSeconds()) {
  return db.transaction(() => {
    const reset = db.prepare(`UPDATE playback_devices SET trusted=0,user_id=NULL WHERE requires_pairing=1
      AND id IN (SELECT device_id FROM device_pairing_codes WHERE expires_at<? AND claimed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM device_pairing_codes live WHERE live.device_id=playback_devices.id AND live.expires_at>=? AND live.claimed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM device_sessions session WHERE session.device_id=playback_devices.id AND session.expires_at>=? AND session.revoked_at IS NULL)`).run(at, at, at).changes;
    const removed = db.prepare('DELETE FROM device_pairing_codes WHERE expires_at<? OR claimed_at IS NOT NULL').run(at).changes;
    return { reset, removed };
  })();
}

export function requestPairing(input: { id?: string; name: string; manufacturer?: string; model?: string; platform: string; appVersion?: string; capabilities: DeviceCapabilities; address?: string; protocolId?: string }) {
  cleanupExpiredPairings();
  const id = input.id && /^[a-zA-Z0-9_-]{8,80}$/.test(input.id) ? input.id : crypto.randomUUID();
  const name = boundedIdentity(input.name, 'TV', 100);
  const manufacturer = boundedIdentity(input.manufacturer, '', 100);
  const model = boundedIdentity(input.model, '', 100);
  const platform = boundedIdentity(input.platform, 'unknown', 50, true);
  const appVersion = boundedIdentity(input.appVersion, '', 30);
  const protocolId = boundedIdentity(input.protocolId, id, 200);
  const address = boundedIdentity(input.address, '', 64);
  const existing = db.prepare(`SELECT trusted,user_id userId,requires_pairing requiresPairing
    FROM playback_devices WHERE id=?`).get(id) as { trusted: number; userId: number | null; requiresPairing: number } | undefined;
  if (existing?.trusted && (existing.userId || !existing.requiresPairing)) throw Object.assign(new Error('Dit apparaat is al gekoppeld. Vergeet het apparaat eerst in de instellingen wanneer opnieuw koppelen nodig is.'), { status: 409 });
  if (existing?.trusted) db.transaction(() => {
    db.prepare('DELETE FROM device_sessions WHERE device_id=?').run(id);
    db.prepare('DELETE FROM device_pairing_codes WHERE device_id=?').run(id);
    db.prepare('UPDATE playback_devices SET trusted=0 WHERE id=? AND user_id IS NULL AND requires_pairing=1').run(id);
  })();
  const pairingSecret = crypto.randomBytes(32).toString('base64url');
  const protocol = protocolForPlatform(platform);
  const physicalKey = physicalKeyFor({ id, name, manufacturer, model, appVersion, address, protocol, protocolId });
  db.prepare(`INSERT INTO playback_devices(id,name,manufacturer,model,platform,app_version,capabilities,last_seen_at,protocol,device_type,address,online_state,protocol_id,physical_key,requires_pairing,icon)
    VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?,1,'tv') ON CONFLICT(id) DO UPDATE SET name=excluded.name,manufacturer=excluded.manufacturer,model=excluded.model,
    platform=excluded.platform,app_version=excluded.app_version,capabilities=excluded.capabilities,last_seen_at=CURRENT_TIMESTAMP,address=excluded.address,online_state='online',protocol_id=excluded.protocol_id,physical_key=excluded.physical_key`).run(
      id, name, manufacturer, model,
      platform, appVersion, JSON.stringify(normalizeCapabilities(input.capabilities)),
      protocol, 'television', address || null, 'online', protocolId, physicalKey
    );
  db.prepare('DELETE FROM device_pairing_codes WHERE device_id=?').run(id);
  let code = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      db.prepare('INSERT INTO device_pairing_codes(code_hash,device_id,secret_hash,expires_at) VALUES(?,?,?,?)').run(hash(code), id, hash(pairingSecret), nowSeconds() + 600);
      break;
    } catch (error) {
      if (attempt === 19) throw error;
    }
  }
  return { deviceId: id, code, pairingSecret, expiresInSeconds: 600 };
}

export function approvePairing(code: string, userId: number) {
  cleanupExpiredPairings();
  if (!/^\d{6}$/.test(code)) return false;
  const row = db.prepare('SELECT device_id deviceId FROM device_pairing_codes WHERE code_hash=? AND expires_at>=? AND attempts<10').get(hash(code), nowSeconds()) as any;
  if (!row) return false;
  db.transaction(() => {
    db.prepare('UPDATE playback_devices SET trusted=1,user_id=?,last_seen_at=CURRENT_TIMESTAMP WHERE id=?').run(userId,row.deviceId);
    db.prepare('UPDATE device_pairing_codes SET approved_at=CURRENT_TIMESTAMP WHERE code_hash=?').run(hash(code));
  })();
  return true;
}

export function claimPairing(deviceId: string, pairingSecret: string) {
  cleanupExpiredPairings();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(deviceId)) return { status: 'expired' as const };
  if (pairingSecret.length < 32 || pairingSecret.length > 128) {
    db.prepare('UPDATE device_pairing_codes SET attempts=attempts+1 WHERE device_id=? AND expires_at>=? AND claimed_at IS NULL').run(deviceId, nowSeconds());
    return { status: 'expired' as const };
  }
  const row = db.prepare(`SELECT approved_at approvedAt FROM device_pairing_codes WHERE device_id=? AND secret_hash=? AND expires_at>=? AND claimed_at IS NULL`).get(deviceId, hash(pairingSecret), nowSeconds()) as any;
  if (!row) {
    db.prepare('UPDATE device_pairing_codes SET attempts=attempts+1 WHERE device_id=? AND expires_at>=? AND claimed_at IS NULL').run(deviceId, nowSeconds());
    return { status: 'expired' as const };
  }
  if (!row.approvedAt) return { status: 'waiting' as const };
  const token = crypto.randomBytes(40).toString('base64url');
  db.transaction(() => {
    db.prepare(`INSERT INTO device_sessions(token_hash,device_id,expires_at,scopes) VALUES(?,?,?,?)`).run(
      hash(token), deviceId, nowSeconds() + 365 * 86400,
      JSON.stringify(['playback:read','playback:control','progress:write','tracks:write','quality:write']),
    );
    db.prepare('UPDATE device_pairing_codes SET claimed_at=CURRENT_TIMESTAMP WHERE device_id=?').run(deviceId);
  })();
  return { status: 'approved' as const, token };
}

export function requireDevice(req: Request, res: Response, next: NextFunction) {
  const token = String(req.headers.authorization || '').match(/^Device\s+(.+)$/i)?.[1] || '';
  if (!token) return res.status(401).json({ error: 'Apparaattoken ontbreekt.' });
  const device = authenticateDeviceToken(token);
  if (!device||!device.userId) return res.status(401).json({ error: 'Apparaattoken is ongeldig, verlopen of niet aan een profiel gekoppeld.' });
  req.playbackDevice = device;
  markDeviceOnline(device.id, hash(token));
  next();
}

export function authenticateDeviceToken(token: string) {
  if (!token || token.length > 512) return null;
  return (db.prepare(`SELECT d.id,d.name,d.platform,d.user_id userId,s.scopes FROM device_sessions s JOIN playback_devices d ON d.id=s.device_id
    WHERE s.token_hash=? AND s.expires_at>=? AND s.revoked_at IS NULL AND d.trusted=1`).get(hash(token), nowSeconds()) as any) || null;
}

export function markDeviceOnline(deviceId: string, tokenHash?: string) {
  db.prepare("UPDATE playback_devices SET last_seen_at=CURRENT_TIMESTAMP,online_state='online' WHERE id=?").run(deviceId);
  if (tokenHash) db.prepare('UPDATE device_sessions SET last_used_at=CURRENT_TIMESTAMP WHERE token_hash=?').run(tokenHash);
}

export function listDevices() {
  return (db.prepare(`SELECT id,name,manufacturer,model,platform,app_version appVersion,capabilities,overrides,trusted,last_seen_at lastSeenAt,created_at createdAt
    FROM playback_devices WHERE requires_pairing=1 OR trusted=1 ORDER BY COALESCE(last_seen_at,created_at) DESC`).all() as any[]).map(row => ({ ...row, trusted: Boolean(row.trusted), capabilities: safeJson(row.capabilities), overrides: safeJson(row.overrides) }));
}

export function deviceCapabilities(id: string) {
  const row = db.prepare('SELECT capabilities,overrides FROM playback_devices WHERE id=? AND trusted=1').get(id) as any;
  if (!row) return null;
  return { ...safeJson(row.capabilities), ...safeJson(row.overrides) } as DeviceCapabilities;
}

export function setDeviceOverrides(id: string, overrides: Record<string, unknown>) {
  const clean = JSON.stringify(overrides || {});
  if (clean.length > 50_000) throw new Error('Het capability-profiel is te groot.');
  return db.prepare('UPDATE playback_devices SET overrides=? WHERE id=?').run(clean, id).changes > 0;
}

export function forgetDevice(id: string) {
  return db.transaction(() => {
    try {
      db.prepare(`UPDATE playback_grants SET revoked_at=CURRENT_TIMESTAMP WHERE session_id IN
        (SELECT id FROM playback_sessions WHERE device_id=?) AND revoked_at IS NULL`).run(id);
      db.prepare(`UPDATE playback_sessions SET state='stopped',ended_at=CURRENT_TIMESTAMP,end_reason='device-forgotten',
        revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE device_id=? AND ended_at IS NULL`).run(id);
    } catch { /* Oude databases initialiseren deze tabellen zodra de afspeellaag wordt geladen. */ }
    return db.prepare('DELETE FROM playback_devices WHERE id=?').run(id).changes > 0;
  })();
}

export function queueDeviceCommand(deviceId: string, command: string, payload: unknown = {}) {
  const allowed = ['play', 'pause', 'stop', 'seek', 'next', 'previous', 'volume', 'audio-track', 'subtitle-track', 'quality', 'disconnect', 'load'];
  if (!allowed.includes(command)) throw new Error('Onbekende apparaatopdracht.');
  const next = (db.prepare('SELECT COALESCE(MAX(sequence),0)+1 sequence FROM device_commands WHERE device_id=?').get(deviceId) as { sequence: number }).sequence;
  const result = db.prepare('INSERT INTO device_commands(device_id,command,payload,sequence,expires_at) VALUES(?,?,?,?,?)').run(deviceId, command, JSON.stringify(payload || {}), next, nowSeconds() + 600);
  return Number(result.lastInsertRowid);
}

export function pendingDeviceCommands(deviceId: string) {
  db.prepare('UPDATE device_commands SET acknowledged_at=CURRENT_TIMESTAMP WHERE device_id=? AND acknowledged_at IS NULL AND expires_at IS NOT NULL AND expires_at<?').run(deviceId, nowSeconds());
  return (db.prepare('SELECT id,command,payload,sequence,expires_at expiresAt,created_at createdAt FROM device_commands WHERE device_id=? AND acknowledged_at IS NULL ORDER BY sequence,id LIMIT 50').all(deviceId) as any[]).map(row => ({ ...row, payload: safeJson(row.payload) }));
}

export function acknowledgeDeviceCommand(deviceId: string, commandId: number) {
  return db.prepare('UPDATE device_commands SET acknowledged_at=CURRENT_TIMESTAMP WHERE id=? AND device_id=?').run(commandId, deviceId).changes > 0;
}

function safeJson(value: string) { try { return JSON.parse(value || '{}'); } catch { return {}; } }

export const deviceInternals = { hash, normalizeCapabilities, cleanupExpiredPairings, boundedIdentity };
