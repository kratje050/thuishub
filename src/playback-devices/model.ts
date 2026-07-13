import type { DeviceGroups, PlaybackDevice, PlaybackDeviceProtocol, PlaybackDeviceStatus, PlaybackSession, PlaybackSessionResponse } from './types';

function protocol(value: unknown): PlaybackDeviceProtocol {
  const normalized = String(value || 'unknown').toLowerCase();
  if (normalized === 'cast') return 'google-cast';
  if (normalized === 'dlna') return 'dlna-upnp';
  if (normalized === 'tizen') return 'samsung-tizen';
  return normalized;
}

function status(value: unknown, online: boolean): PlaybackDeviceStatus {
  const normalized = String(value || '').toLowerCase().replaceAll('_', '-');
  if (['online', 'possibly-offline', 'offline'].includes(normalized)) return normalized as PlaybackDeviceStatus;
  return online ? 'online' : 'unknown';
}

export function normalizePlaybackDevice(value: any): PlaybackDevice | null {
  if (!value || typeof value !== 'object' || !value.id || !value.name) return null;
  const deviceProtocol = protocol(value.protocol || value.platform);
  const rawStatus = value.status || value.onlineState;
  const normalizedStatus = String(rawStatus || '').toLowerCase().replaceAll('_', '-');
  const online = value.online !== false && normalizedStatus !== 'offline';
  return {
    id: String(value.id),
    name: String(value.name).slice(0, 120),
    protocol: deviceProtocol,
    deviceType: value.deviceType ? String(value.deviceType) : undefined,
    manufacturer: value.manufacturer ? String(value.manufacturer) : undefined,
    model: value.model ? String(value.model) : undefined,
    online,
    status: status(rawStatus, online),
    lastSeen: value.lastSeen || value.lastSeenAt || undefined,
    capabilities: value.capabilities && typeof value.capabilities === 'object' ? value.capabilities : {},
    icon: value.icon ? String(value.icon) : undefined,
    requiresPairing: Boolean(value.requiresPairing),
    trusted: Boolean(value.trusted),
    paired: Boolean(value.paired ?? value.trusted),
    active: Boolean(value.active),
    currentMedia: value.currentMedia ? String(value.currentMedia) : undefined,
  };
}

export function normalizeDeviceList(value: any): PlaybackDevice[] {
  const items: unknown[] = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.devices) ? value.devices : [];
  const seen = new Set<string>();
  return items.map(normalizePlaybackDevice).filter((item): item is PlaybackDevice => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function groupPlaybackDevices(devices: PlaybackDevice[]): DeviceGroups {
  const groups: DeviceGroups = { mine: [], other: [], local: [] };
  for (const device of devices) {
    if (device.protocol === 'local-browser') groups.local.push(device);
    else if (device.trusted || device.paired) groups.mine.push(device);
    else groups.other.push(device);
  }
  const order = (left: PlaybackDevice, right: PlaybackDevice) => Number(right.online) - Number(left.online) || left.name.localeCompare(right.name, 'nl');
  groups.mine.sort(order); groups.other.sort(order); groups.local.sort(order);
  return groups;
}

export function normalizePlaybackSession(value: any): PlaybackSessionResponse {
  const source = value?.session === null ? null : value?.session || value || null;
  const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const device = source?.device || value?.device || {};
  const capabilities = device?.capabilities && typeof device.capabilities === 'object' ? device.capabilities : {};
  const sessionProtocol = protocol(source?.protocol || device?.protocol || device?.platform);
  const media = source?.media || value?.media || {};
  const session = source && source.id ? {
    ...source,
    id: String(source.id),
    deviceId: String(source.deviceId || device.id || ''),
    deviceName: source.deviceName || device.name || metadata.deviceName || undefined,
    protocol: sessionProtocol,
    state: String(source.state || 'connecting'),
    revision: source.revision == null ? undefined : Number(source.revision),
    mediaId: source.mediaId == null ? undefined : Number(source.mediaId),
    title: source.title || metadata.title || media.seriesTitle || media.title || undefined,
    subtitle: source.subtitle || metadata.subtitle || (media.seriesTitle ? media.title : undefined),
    posterUrl: source.posterUrl || metadata.posterUrl || value?.urls?.poster || value?.urls?.artwork || undefined,
    position: source.position == null ? undefined : Number(source.position),
    duration: source.duration == null ? undefined : Number(source.duration),
    volume: source.volume == null && metadata.volume == null ? undefined : Number(source.volume ?? metadata.volume),
    quality: source.quality || metadata.quality || undefined,
    canSeek: source.canSeek ?? capabilities.seek ?? ['google-cast','local-browser'].includes(sessionProtocol),
    canSetVolume: source.canSetVolume ?? capabilities.volume ?? ['google-cast','local-browser'].includes(sessionProtocol),
    canSkipNext: source.canSkipNext ?? capabilities.next ?? false,
    canSkipPrevious: source.canSkipPrevious ?? capabilities.previous ?? false,
    canChangeAudioTrack: source.canChangeAudioTrack ?? capabilities.audioTrackSelection ?? false,
    canChangeSubtitleTrack: source.canChangeSubtitleTrack ?? capabilities.subtitleTrackSelection ?? false,
    canChangeQuality: source.canChangeQuality ?? capabilities.qualitySelection ?? false,
  } as PlaybackSession : null;
  return {
    session,
    urls: value?.urls ? { ...value.urls, poster: value.urls.poster || value.urls.artwork } : value?.playback?.urls,
    decision: value?.decision || value?.playback?.decision,
    media: value?.media || source?.media || undefined,
    localStreamingRequired: Boolean(value?.localStreamingRequired || value?.playback?.localStreamingRequired),
  };
}

export function protocolLabel(value: PlaybackDeviceProtocol) {
  const labels: Record<string, string> = {
    'google-cast': 'Google Cast',
    'dlna-upnp': 'DLNA',
    'thuishub-tv-app': 'ThuisHub TV',
    'android-tv': 'Android TV',
    'samsung-tizen': 'Samsung Tizen',
    'local-browser': 'Deze browser',
  };
  return labels[value] || value;
}

export function deviceSecondaryLabel(device: PlaybackDevice) {
  const platform = protocolLabel(device.protocol);
  const detail = [device.manufacturer, device.model].filter(Boolean).join(' ');
  const state = device.protocol === 'local-browser' ? 'Beschikbaar' : device.status === 'possibly-offline' ? 'Mogelijk offline' : device.online ? device.requiresPairing && !device.paired ? 'Koppelen vereist' : device.paired ? 'Gekoppeld' : 'Beschikbaar' : 'Offline';
  return [detail || platform, detail ? platform : '', state].filter(Boolean).join(' · ');
}

let cachedLocalBrowserDeviceId = '';
function createLocalBrowserReceiverId() {
  return globalThis.crypto?.randomUUID?.() || `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function localBrowserDeviceId() {
  if (cachedLocalBrowserDeviceId) return cachedLocalBrowserDeviceId;
  // Bewust per top-level pagina, niet in localStorage: twee tabbladen zijn
  // afzonderlijke receivers en mogen elkaars speler nooit overnemen.
  cachedLocalBrowserDeviceId = `local-browser:${createLocalBrowserReceiverId()}`;
  return cachedLocalBrowserDeviceId;
}

export const LOCAL_BROWSER_DEVICE: PlaybackDevice = {
  id: localBrowserDeviceId(), name: 'Deze browser', protocol: 'local-browser', deviceType: 'browser', online: true, status: 'online', capabilities: {}, icon: 'browser', trusted: true, paired: true,
};

export const modelInternals = { createLocalBrowserReceiverId };
