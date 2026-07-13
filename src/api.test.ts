import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

describe('API-fouten', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bewaart de servercode zodat alleen echte sessieconflicten opnieuw worden geprobeerd', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'De sessie is gewijzigd.',
      code: 'STALE_PLAYBACK_SESSION',
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })));

    const error = await api('/playback-sessions/test').catch(caught => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: 'De sessie is gewijzigd.',
      status: 409,
      code: 'STALE_PLAYBACK_SESSION',
    });
  });
});
