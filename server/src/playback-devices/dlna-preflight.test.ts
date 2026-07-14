import { describe, expect, it, vi } from 'vitest';
import { maskDlnaPlaybackUrl, preflightDlnaPlaybackUrl, validateDlnaPlaybackUrl } from './dlna-preflight.js';

const base = 'http://192.168.178.223:8788';
const token = 'geldige-afspeelsleutel-met-voldoende-lengte';

describe('DLNA-afspeel-URL preflight', () => {
  it('accepteert uitsluitend een mediaresource met Samsung-vriendelijke extensie op de LAN-streamserver', () => {
    expect(validateDlnaPlaybackUrl(`${base}/api/playback/26/file.mp4?token=${token}`, base).pathname).toBe('/api/playback/26/file.mp4');
    expect(validateDlnaPlaybackUrl(`${base}/api/playback/26/dlna.ts?token=${token}`, base).pathname).toBe('/api/playback/26/dlna.ts');
    for (const unsafe of [
      `http://127.0.0.1:8788/api/playback/26/file.mp4?token=${token}`,
      `http://100.80.1.2:8788/api/playback/26/file.mp4?token=${token}`,
      `http://192.168.178.223:8787/api/playback/26/file.mp4?token=${token}`,
      `${base}/C:/Films/Alien%20Romulus.mp4?token=${token}`,
      `${base}/api/playback/26/file?token=${token}`,
    ]) expect(() => validateDlnaPlaybackUrl(unsafe, base)).toThrow();
  });

  it('maskeert de volledige afspeelsleutel in logs', () => {
    const masked = maskDlnaPlaybackUrl(`${base}/api/playback/26/file.mp4?token=${token}`);
    expect(masked).toContain('token=[VERBORGEN]');
    expect(masked).not.toContain(token);
  });

  it('controleert HEAD en een Range GET voordat de URL wordt gebruikt', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '123', 'Accept-Ranges': 'bytes' } }))
      .mockResolvedValueOnce(new Response(Uint8Array.from([0, 1]), { status: 206, headers: { 'Content-Range': 'bytes 0-1/123' } }));
    const result = await preflightDlnaPlaybackUrl(`${base}/api/playback/26/file.mp4?token=${token}`, base, { fetcher });
    expect(result).toMatchObject({ headStatus: 200, rangeStatus: 206, contentType: 'video/mp4', contentLength: '123', contentRange: 'bytes 0-1/123' });
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Range: 'bytes=0-1' }) }));
  });

  it.each([401, 404, 500])('stuurt een route met HTTP %s niet door naar de tv', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
    await expect(preflightDlnaPlaybackUrl(`${base}/api/playback/26/file.mp4?token=${token}`, base, { fetcher })).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('weigert een transcodestream die na de headers nog geen eerste bytes levert', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(preflightDlnaPlaybackUrl(`${base}/api/playback/26/dlna.ts?token=${token}`, base, { fetcher })).rejects.toThrow(/geen afspeelbare gegevens/i);
  });
});
