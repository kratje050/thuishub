import type { DeviceCapabilities } from '../playback.js';

export type PlaybackDeviceProtocol =
  | 'google-cast'
  | 'dlna-upnp'
  | 'thuishub-tv-app'
  | 'android-tv'
  | 'samsung-tizen'
  | 'local-browser';

export type PlaybackDeviceType = 'television' | 'display' | 'audio' | 'computer' | 'browser' | 'unknown';
export type PlaybackDeviceOnlineState = 'online' | 'possibly-offline' | 'offline';

export type PlaybackDevice = {
  id: string;
  name: string;
  protocol: PlaybackDeviceProtocol;
  deviceType: PlaybackDeviceType;
  manufacturer: string;
  model: string;
  address?: string;
  port?: number;
  online: boolean;
  onlineState: PlaybackDeviceOnlineState;
  lastSeen?: string;
  capabilities: DeviceCapabilities;
  icon: 'tv' | 'cast' | 'speaker' | 'computer' | 'browser';
  requiresPairing: boolean;
  paired: boolean;
  trusted: boolean;
  active?: boolean;
  protocolId?: string;
  physicalKey?: string;
  appVersion?: string;
  metadata?: Record<string, unknown>;
};

export type DiscoveredPlaybackDevice = Omit<PlaybackDevice, 'id' | 'online' | 'onlineState' | 'lastSeen' | 'paired' | 'trusted'> & {
  id?: string;
  serialNumber?: string;
  udn?: string;
  hostName?: string;
  lastSeen?: string;
  paired?: boolean;
  trusted?: boolean;
};

export type PlaybackDeviceDiscoveryResult = {
  provider: string;
  devices: DiscoveredPlaybackDevice[];
  startedAt: string;
  finishedAt: string;
  error?: string;
  multicastAvailable?: boolean;
};

export const PLAYBACK_PROTOCOL_PRIORITY: Record<PlaybackDeviceProtocol, number> = {
  'thuishub-tv-app': 600,
  'google-cast': 500,
  'android-tv': 400,
  'samsung-tizen': 300,
  'dlna-upnp': 200,
  'local-browser': 100,
};
