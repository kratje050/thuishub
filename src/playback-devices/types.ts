import type { MediaItem } from '../api';

export type PlaybackDeviceProtocol =
  | 'google-cast'
  | 'dlna-upnp'
  | 'thuishub-tv-app'
  | 'android-tv'
  | 'samsung-tizen'
  | 'local-browser'
  | string;

export type PlaybackDeviceStatus = 'online' | 'possibly-offline' | 'offline' | 'unknown';

export type PlaybackDevice = {
  id: string;
  name: string;
  protocol: PlaybackDeviceProtocol;
  deviceType?: string;
  manufacturer?: string;
  model?: string;
  online: boolean;
  status: PlaybackDeviceStatus;
  lastSeen?: string;
  capabilities: Record<string, unknown>;
  icon?: string;
  requiresPairing?: boolean;
  trusted?: boolean;
  paired?: boolean;
  active?: boolean;
  currentMedia?: string;
};

export type PlaybackTrack = { id: string | number; label: string; language?: string };

export type PlaybackSession = {
  id: string;
  deviceId: string;
  deviceName: string;
  protocol: PlaybackDeviceProtocol;
  state: 'connecting' | 'playing' | 'paused' | 'stopped' | 'error' | string;
  revision?: number;
  controllerId?: string | null;
  mediaId?: number;
  title?: string;
  subtitle?: string;
  posterUrl?: string;
  position?: number;
  duration?: number;
  volume?: number;
  muted?: boolean;
  canSeek?: boolean;
  canSetVolume?: boolean;
  canSkipNext?: boolean;
  canSkipPrevious?: boolean;
  canChangeAudioTrack?: boolean;
  canChangeSubtitleTrack?: boolean;
  canChangeQuality?: boolean;
  audioTracks?: PlaybackTrack[];
  subtitleTracks?: PlaybackTrack[];
  activeAudioTrackId?: string | number;
  activeSubtitleTrackId?: string | number;
  quality?: string;
  error?: string;
  updatedAt?: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
};

export type PlaybackSessionResponse = {
  session: PlaybackSession | null;
  urls?: { playback: string; subtitle?: string; poster?: string };
  decision?: unknown;
  media?: Pick<MediaItem, 'id' | 'kind' | 'title'> & Partial<MediaItem>;
  localStreamingRequired?: boolean;
};

export type PendingPlayback = {
  item: MediaItem;
  startPosition: number;
};

export type DeviceGroups = {
  mine: PlaybackDevice[];
  other: PlaybackDevice[];
  local: PlaybackDevice[];
};
