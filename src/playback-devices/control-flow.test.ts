import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api';
import { controlPlaybackSession, createPlaybackSession, stopPlaybackSessionAtLatestRevision } from './api';
import { localPlayerVolume } from './local-player-command';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clientcontract voor sessiebediening', () => {
  it('accepteert het centrale level-volumeveld en begrenst ongeldige waarden', () => {
    expect(localPlayerVolume({ level: 0.35 })).toBe(0.35);
    expect(localPlayerVolume({ value: 2 })).toBe(1);
    expect(localPlayerVolume({ level: 'ongeldig' })).toBeNull();
  });
  it('bewaart de foutcode zodat alleen een verouderde revisie opnieuw wordt geprobeerd', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: 'De afspeelsessie is ondertussen bijgewerkt.',
      code: 'STALE_PLAYBACK_SESSION',
    }, 409)));

    const error = await api('/playback-sessions/test').catch(caught => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'STALE_PLAYBACK_SESSION' });
  });

  it('stuurt kwaliteit en revisie mee en behoudt alle gegevens van de vervangende sessie', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      session: {
        id: 'session-new',
        deviceId: 'cast-woonkamer',
        protocol: 'google-cast',
        state: 'connecting',
        revision: 0,
        metadata: { quality: '720p' },
        canSkipNext: true,
      },
      media: { id: 22, kind: 'episode', title: 'Aflevering twee', seriesTitle: 'Serie' },
      urls: { playback: 'http://192.168.1.10:8788/api/playback/22/file?token=test' },
      decision: { mode: 'direct_play' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await controlPlaybackSession('session-old', 'quality', { quality: '720p' }, 7);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/playback-sessions/session-old/control');
    expect(JSON.parse(String(request.body))).toEqual({
      command: 'quality',
      action: 'quality',
      revision: 7,
      payload: { quality: '720p' },
      quality: '720p',
    });
    expect(result.session).toMatchObject({ id: 'session-new', quality: '720p', canSkipNext: true });
    expect(result.media).toMatchObject({ id: 22, kind: 'episode' });
    expect(result.urls?.playback).toContain('/api/playback/22/file');
    expect(result.decision).toEqual({ mode: 'direct_play' });
  });

  it('stuurt de gekozen startkwaliteit ook bij een nieuwe tv-sessie', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      session: { id: 'session-new', deviceId: 'tv', protocol: 'android-tv', state: 'connecting' },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await createPlaybackSession(42, 'tv', 90, '1080p-high');

    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      mediaId: 42,
      deviceId: 'tv',
      startPosition: 90,
      quality: '1080p-high',
      controllerId: expect.stringMatching(/^browser:local-browser:/),
    });
  });

  it('stopt na een rapport altijd met de nieuwste revisie van precies de bron', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ session: { id: 'local-1', deviceId: 'local-browser', protocol: 'local-browser', state: 'playing', revision: 8 } }))
      .mockResolvedValueOnce(jsonResponse({ session: { id: 'local-1', deviceId: 'local-browser', protocol: 'local-browser', state: 'stopped', revision: 9 } }));
    vi.stubGlobal('fetch', fetchMock);

    await stopPlaybackSessionAtLatestRevision('local-1', { position: 120, duration: 600, reason: 'local-player-closed' }, 7);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/playback-sessions/local-1');
    const [url, request] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/api/playback-sessions/local-1/control');
    expect(JSON.parse(String(request.body))).toMatchObject({
      command: 'stop',
      revision: 8,
      position: 120,
      duration: 600,
      reason: 'local-player-closed',
    });
  });

  it('probeert een stale stop eenmalig opnieuw met de vernieuwde revisie', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ session: { id: 'local-1', deviceId: 'local-browser', protocol: 'local-browser', state: 'playing', revision: 8 } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Verouderde sessie.', code: 'STALE_PLAYBACK_SESSION' }, 409))
      .mockResolvedValueOnce(jsonResponse({ session: { id: 'local-1', deviceId: 'local-browser', protocol: 'local-browser', state: 'playing', revision: 9 } }))
      .mockResolvedValueOnce(jsonResponse({ session: { id: 'local-1', deviceId: 'local-browser', protocol: 'local-browser', state: 'stopped', revision: 10 } }));
    vi.stubGlobal('fetch', fetchMock);

    await stopPlaybackSessionAtLatestRevision('local-1', { reason: 'completed' }, 7);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/playback-sessions/local-1');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/playback-sessions/local-1');
    const [, retryRequest] = fetchMock.mock.calls[3] as unknown as [string, RequestInit];
    expect(JSON.parse(String(retryRequest.body))).toMatchObject({ command: 'stop', revision: 9, reason: 'completed' });
  });
});
