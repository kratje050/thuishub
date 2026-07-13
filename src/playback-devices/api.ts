import { ApiError, api, patch, post } from '../api';
import { localBrowserDeviceId, normalizeDeviceList, normalizePlaybackSession } from './model';
import type { PlaybackSessionResponse } from './types';

export async function getPlaybackDevices() {
  return normalizeDeviceList(await api('/playback-devices'));
}

export async function discoverPlaybackDevices() {
  const result = await post('/playback-devices/discover', {});
  const discovered = normalizeDeviceList(result);
  return discovered.length ? discovered : getPlaybackDevices();
}

export async function createPlaybackSession(mediaId: number, deviceId: string, startPosition = 0, quality = 'auto'): Promise<PlaybackSessionResponse> {
  return normalizePlaybackSession(await post('/playback-sessions', { mediaId, deviceId, startPosition, quality, controllerId: `browser:${localBrowserDeviceId()}` }));
}

export async function getActivePlaybackSession(): Promise<PlaybackSessionResponse> {
  return normalizePlaybackSession(await api('/playback-sessions/active'));
}

export async function getPlaybackSession(sessionId: string): Promise<PlaybackSessionResponse> {
  return normalizePlaybackSession(await api(`/playback-sessions/${encodeURIComponent(sessionId)}`));
}

export async function controlPlaybackSession(sessionId: string, command: string, payload: Record<string, unknown> = {}, revision?: number) {
  return normalizePlaybackSession(await post(`/playback-sessions/${encodeURIComponent(sessionId)}/control`, { command, action: command, revision, payload, ...payload }));
}

export async function stopPlaybackSessionAtLatestRevision(sessionId: string, payload: Record<string, unknown>, fallbackRevision = 0) {
  let revision = fallbackRevision;
  const latest = await getPlaybackSession(sessionId);
  if (!latest.session || latest.session.state === 'stopped' || latest.session.endedAt) return latest;
  revision = Number(latest.session.revision ?? revision);
  try {
    return await controlPlaybackSession(sessionId, 'stop', payload, revision);
  } catch (caught) {
    if (!(caught instanceof ApiError) || caught.status !== 409 || caught.code !== 'STALE_PLAYBACK_SESSION') throw caught;
    const refreshed = await getPlaybackSession(sessionId);
    if (!refreshed.session || refreshed.session.state === 'stopped' || refreshed.session.endedAt) return refreshed;
    return controlPlaybackSession(sessionId, 'stop', payload, Number(refreshed.session.revision ?? revision));
  }
}

export async function deletePlaybackSession(sessionId: string, reason = 'transfer-cancelled') {
  return api(`/playback-sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}

export async function updatePlaybackSession(sessionId: string, revision: number, state: string, position: number, duration: number) {
  return normalizePlaybackSession(await patch(`/playback-sessions/${encodeURIComponent(sessionId)}`, { revision, state, position, duration }));
}

export async function confirmPlaybackReceiverStatus(sessionId: string, revision: number, state: 'playing' | 'error', position = 0, duration = 0) {
  return normalizePlaybackSession(await post(`/playback-sessions/${encodeURIComponent(sessionId)}/receiver-status`, { revision, state, position, duration }));
}

export async function claimBrowserPlaybackCommand(sessionId: string, revision: number, commandId: string) {
  return normalizePlaybackSession(await post(`/playback-sessions/${encodeURIComponent(sessionId)}/browser-command/claim`, {
    revision,
    commandId,
    claimedBy: localBrowserDeviceId(),
  }));
}
