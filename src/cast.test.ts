import { afterEach, describe, expect, it, vi } from 'vitest';
import { castDevicesAvailable, currentCastDevice, describeCastEnvironment, disconnectCast, initializeCast, isCastPlaybackConfirmed, loadCurrentCastMedia, setCurrentCastTextTrack, waitForCurrentCastPlaying, type CastEnvironment } from './cast';

const environment: CastEnvironment = { chromeCast: true, castFramework: true, secureContext: true, hostname: 'localhost', userAgent: 'Chrome' };

describe('Google Cast runtimecontrole', () => {
  it('is alleen beschikbaar als beide officiële API-onderdelen werkelijk geladen zijn', () => {
    expect(describeCastEnvironment(environment).available).toBe(true);
    expect(describeCastEnvironment({ ...environment, castFramework: false })).toMatchObject({ available: false, supportedBrowser: false });
  });

  it('legt een onveilige context begrijpelijk uit', () => {
    const result = describeCastEnvironment({ ...environment, secureContext: false, hostname: '192.168.1.20' });
    expect(result.available).toBe(false);
    expect(result.message).toMatch(/HTTPS|localhost/);
  });

  it('claimt geen ondersteuning op iPhone of iPad', () => {
    const result = describeCastEnvironment({ ...environment, userAgent: 'Mozilla/5.0 (iPhone)' });
    expect(result.available).toBe(false);
    expect(result.message).toMatch(/iPhone|iPad/);
  });
});

function installCastRuntime(options: { state?: string; receiver?: { id: string; name: string; sessionId: string } | null; activeMedia?: boolean } = {}) {
  const setOptions = vi.fn();
  const loadMedia = vi.fn(async (_request: any) => undefined);
  const endSession = vi.fn(async () => undefined);
  const editTracksInfo = vi.fn((_request: any, success: () => void) => success());
  const mediaSession = options.activeMedia === false ? null : { editTracksInfo };
  const receiver = options.receiver === undefined ? { id: 'cast-woonkamer', name: 'Woonkamer-tv', sessionId: 'session-1' } : options.receiver;
  const session = receiver ? {
    getCastDevice: () => ({ deviceId: receiver.id, friendlyName: receiver.name }),
    getSessionId: () => receiver.sessionId,
    getMediaSession: () => mediaSession,
    loadMedia,
    endSession,
  } : null;
  const context = {
    setOptions,
    getCastState: () => options.state || 'NOT_CONNECTED',
    getCurrentSession: () => session,
  };
  class MediaInfo { metadata: any; tracks: any; constructor(public contentId: string, public contentType: string) {} }
  class Track { trackContentId = ''; trackContentType = ''; subtype = ''; name = ''; language = ''; constructor(public trackId: number, public type: string) {} }
  class LoadRequest { autoplay = false; currentTime = 0; activeTrackIds: number[] = []; constructor(public media: any) {} }
  class EditTracksInfoRequest { constructor(public activeTrackIds: number[]) {} }
  const remotePlayer = { isMediaLoaded: false, isPaused: true, isConnected: true, playerState: 'BUFFERING' };
  const listeners = new Map<string, Set<() => void>>();
  class RemotePlayer { constructor() { return remotePlayer; } }
  class RemotePlayerController {
    constructor(public player: any) {}
    addEventListener(type: string, listener: () => void) { const current = listeners.get(type) || new Set(); current.add(listener); listeners.set(type, current); }
    removeEventListener(type: string, listener: () => void) { listeners.get(type)?.delete(listener); }
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Chrome op Windows' } });
  (globalThis as any).window = {
    isSecureContext: true,
    location: { hostname: 'localhost' },
    chrome: { cast: {
      AutoJoinPolicy: { ORIGIN_SCOPED: 'origin-scoped' },
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845', MediaInfo, GenericMediaMetadata: class {}, Track, LoadRequest, EditTracksInfoRequest,
        TrackType: { TEXT: 'TEXT' }, TextTrackType: { SUBTITLES: 'SUBTITLES' }, PlayerState: { PLAYING: 'PLAYING' },
      },
    } },
    cast: { framework: {
      CastContext: { getInstance: () => context },
      CastState: { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE' },
      RemotePlayer, RemotePlayerController,
      RemotePlayerEventType: { PLAYER_STATE_CHANGED: 'PLAYER_STATE_CHANGED', IS_MEDIA_LOADED_CHANGED: 'IS_MEDIA_LOADED_CHANGED', IS_PAUSED_CHANGED: 'IS_PAUSED_CHANGED', IS_CONNECTED_CHANGED: 'IS_CONNECTED_CHANGED' },
    } },
  };
  return {
    context, setOptions, session, mediaSession, loadMedia, editTracksInfo, endSession, remotePlayer,
    emit(type: string) { for (const listener of listeners.get(type) || []) listener(); },
  };
}

afterEach(() => {
  delete (globalThis as any).window;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
});

describe('officiële Google Cast Web Sender', () => {
  it('gebruikt standaard de Default Media Receiver en accepteert een ontwikkelaars-App-ID', () => {
    const first = installCastRuntime();
    expect(initializeCast('')).toBe(true);
    expect(first.setOptions).toHaveBeenCalledWith(expect.objectContaining({ receiverApplicationId: 'CC1AD845', resumeSavedSession: true }));
    expect(initializeCast('A1B2C3D4')).toBe(true);
    expect(first.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ receiverApplicationId: 'A1B2C3D4' }));
  });

  it('rapporteert verschijnen, verdwijnen en hervatten van een Cast-apparaat via het SDK-framework', () => {
    installCastRuntime({ state: 'NOT_CONNECTED' });
    expect(castDevicesAvailable()).toBe(true);
    expect(currentCastDevice()).toEqual({ id: 'cast-woonkamer', name: 'Woonkamer-tv', sessionId: 'session-1' });
    installCastRuntime({ state: 'NO_DEVICES_AVAILABLE', receiver: null });
    expect(castDevicesAvailable()).toBe(false);
    expect(currentCastDevice()).toBeNull();
  });

  it('laadt media met startpositie en verbreekt de actieve sessie', async () => {
    const runtime = installCastRuntime();
    const item = { id: 7, title: 'Voorbeeldfilm', kind: 'movie', videoCodec: 'h264' } as any;
    await loadCurrentCastMedia(item, { playback: 'http://192.168.1.10:8788/api/playback/7/file?token=test', subtitle: 'http://192.168.1.10:8788/api/playback/7/subtitle?token=test' }, { mode: 'direct_play' }, 42);
    expect(runtime.loadMedia).toHaveBeenCalledOnce();
    const request = runtime.loadMedia.mock.calls[0][0] as any;
    expect(request.currentTime).toBe(42);
    expect(request.autoplay).toBe(true);
    expect(request.media.contentId).toContain('/api/playback/7/file');
    await disconnectCast();
    expect(runtime.endSession).toHaveBeenCalledWith(true);
  });

  it('meldt WebM/VP8 direct play met het juiste Cast-contenttype', async () => {
    const runtime = installCastRuntime();
    const item = { id: 8, title: 'WebM-film', kind: 'movie', videoCodec: 'vp8' } as any;
    await loadCurrentCastMedia(item, { playback: 'http://192.168.1.10:8788/api/playback/8/file?token=test' }, { mode: 'direct_play', outputContainer: 'webm' });
    const request = runtime.loadMedia.mock.calls[0][0] as any;
    expect(request.media.contentType).toBe('video/webm; codecs="vp8"');
  });

  it('schakelt de externe ondertiteltrack via EditTracksInfoRequest in en uit', async () => {
    const runtime = installCastRuntime();
    await setCurrentCastTextTrack(true);
    await setCurrentCastTextTrack(false);
    expect(runtime.editTracksInfo).toHaveBeenCalledTimes(2);
    expect(runtime.editTracksInfo.mock.calls[0][0]).toMatchObject({ activeTrackIds: [1] });
    expect(runtime.editTracksInfo.mock.calls[1][0]).toMatchObject({ activeTrackIds: [] });
  });

  it('beschouwt een LOAD pas als gestart nadat RemotePlayer werkelijk PLAYING meldt', async () => {
    const runtime = installCastRuntime();
    expect(isCastPlaybackConfirmed(runtime.remotePlayer)).toBe(false);
    const confirmation = waitForCurrentCastPlaying(2_000);
    runtime.remotePlayer.isMediaLoaded = true;
    runtime.remotePlayer.isPaused = false;
    runtime.remotePlayer.playerState = 'PLAYING';
    runtime.emit('PLAYER_STATE_CHANGED');
    await expect(confirmation).resolves.toMatchObject({ session: runtime.session });
    expect(isCastPlaybackConfirmed(runtime.remotePlayer)).toBe(true);
  });

  it('geeft een duidelijke fout als er geen Cast-sessie of actieve media is', async () => {
    installCastRuntime({ receiver: null });
    await expect(setCurrentCastTextTrack(true)).rejects.toThrow(/geen Google Cast-apparaat/i);
    installCastRuntime({ activeMedia: false });
    await expect(setCurrentCastTextTrack(true)).rejects.toThrow(/geen media afgespeeld/i);
  });
});
