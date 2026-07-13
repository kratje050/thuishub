export type User = { id: number; username: string; role: 'admin' | 'user'; maxContentRating?: string; canDownload?: boolean };
export type Source = { id: number; name: string; path: string; kind: 'movies' | 'series'; createdAt?: string };
export type ScanState = { running: boolean; current: string; scanned: number; total: number; errors: number; startedAt: string; finishedAt: string };
export type Settings = { version:string; serverName: string; language: string; tmdbConfigured: boolean; tmdbTokenMasked: string; autoplay: boolean; rewindOnResume: number; skipIntro: boolean; skipCredits: boolean; hardwareTranscoding: string; toneMapping: boolean; maxTranscodes: number; uploadLimitMbps: number; webhookCount: number; automaticBackups:'off'|'daily'|'weekly'; backupRetention:number; backupLocation:string; automaticUpdateCheck:boolean; updateChannel:'stable'|'beta'|'development'; updateManifestUrl:string; maxLogStorageMb:number };
export type MediaItem = {
  id: number; kind: 'movie' | 'episode'; title: string; year?: number; seriesTitle?: string;
  season?: number; episode?: number; duration?: number; size: number; videoCodec?: string; audioCodec?: string;
  width?: number; height?: number; overview?: string; posterUrl?: string; backdropUrl?: string; tmdbId?: number;
  hasSubtitle: boolean; directPlay: boolean;
  progress?: { position: number; duration: number; completed: boolean } | null;
  state: { favorite: boolean; watchlist: boolean; watched: boolean; rating?: number | null };
  contentRating?: string; genres: string[]; edition?: string; tagline?: string; hdr?: boolean;
};
export type Bootstrap = { user: User; settings: Settings; sources: Source[]; scan: ScanState; networkUrls: string[] };

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${url}`, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.error || `Verzoek mislukt (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const post = <T>(url: string, body?: unknown) => api<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T>(url: string, body: unknown) => api<T>(url, { method: 'PATCH', body: JSON.stringify(body) });
export const put = <T>(url: string, body: unknown) => api<T>(url, { method: 'PUT', body: JSON.stringify(body) });
