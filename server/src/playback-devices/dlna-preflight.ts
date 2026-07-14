import { isPrivateIpv4 } from '../network.js';

export type DlnaPlaybackPreflight = {
  maskedUrl: string;
  headStatus: number;
  rangeStatus: number;
  contentType: string;
  contentLength: string;
  contentRange: string;
};

export function maskDlnaPlaybackUrl(input: string) {
  try {
    const url = new URL(input);
    if (url.searchParams.has('token')) url.searchParams.set('token', '[VERBORGEN]');
    return url.toString().replace(/%5BVERBORGEN%5D/i, '[VERBORGEN]');
  } catch {
    return '[ONGELDIGE DLNA-URL]';
  }
}

export function validateDlnaPlaybackUrl(input: string, expectedBase: string) {
  let url: URL;
  let base: URL;
  try {
    url = new URL(input);
    base = new URL(expectedBase);
  } catch {
    throw new Error('De tijdelijke DLNA-afspeel-URL is ongeldig.');
  }
  if (url.protocol !== 'http:' || url.username || url.password) throw new Error('DLNA vereist een lokale HTTP-afspeel-URL zonder gebruikersgegevens.');
  if (!isPrivateIpv4(url.hostname) || url.hostname === '127.0.0.1') throw new Error('De DLNA-afspeel-URL verwijst niet naar het privé-LAN-adres.');
  if (url.origin !== base.origin) throw new Error('De DLNA-afspeel-URL gebruikt niet de actieve LAN-streamserver.');
  if (!/^\/api\/playback\/\d+\/(?:file\.mp4|dlna\.ts)$/.test(url.pathname)) throw new Error('De DLNA-afspeel-URL heeft geen geldige Samsung-mediaresource.');
  const token = url.searchParams.get('token') || '';
  if (token.length < 20) throw new Error('De tijdelijke DLNA-afspeellink bevat geen geldige afspeelsleutel.');
  return url;
}

async function probe(input: string, method: 'HEAD' | 'GET', fetcher: typeof fetch, timeoutMs: number) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetcher(input, {
      method,
      redirect: 'manual',
      signal: abort.signal,
      headers: {
        Connection: 'close',
        'getcontentFeatures.dlna.org': '1',
        'transferMode.dlna.org': 'Streaming',
        ...(method === 'GET' ? { Range: 'bytes=0-1' } : {}),
      },
    });
    if (![200, 206].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`De lokale DLNA-streamroute antwoordde met HTTP ${response.status}.`);
    }
    if (method === 'GET') {
      const reader = response.body?.getReader();
      const first = await reader?.read();
      await reader?.cancel().catch(() => undefined);
      if (!first || first.done || !first.value?.byteLength) throw new Error('De lokale DLNA-streamroute leverde geen afspeelbare gegevens.');
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('De lokale DLNA-streamroute was niet op tijd gereed.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function preflightDlnaPlaybackUrl(input: string, expectedBase: string, options: { fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<DlnaPlaybackPreflight> {
  const url = validateDlnaPlaybackUrl(input, expectedBase);
  const fetcher = options.fetcher || fetch;
  const timeoutMs = Math.min(15_000, Math.max(500, Number(options.timeoutMs) || 8_000));
  const head = await probe(url.toString(), 'HEAD', fetcher, timeoutMs);
  const range = await probe(url.toString(), 'GET', fetcher, timeoutMs);
  return {
    maskedUrl: maskDlnaPlaybackUrl(url.toString()),
    headStatus: head.status,
    rangeStatus: range.status,
    contentType: head.headers.get('content-type') || '',
    contentLength: head.headers.get('content-length') || '',
    contentRange: range.headers.get('content-range') || '',
  };
}
