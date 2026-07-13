import { db, getSetting } from './db.js';

const BASE = 'https://api.themoviedb.org/3';

async function tmdb(pathname: string, params: Record<string, string> = {}) {
  const token = getSetting('tmdbToken');
  if (!token) return null;
  const url = new URL(BASE + pathname);
  url.searchParams.set('language', getSetting('language', 'nl-NL'));
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token.includes('.') || token.length > 80) headers.Authorization = `Bearer ${token}`;
  else url.searchParams.set('api_key', token);
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`TMDB gaf status ${response.status}`);
  return response.json() as Promise<any>;
}

export async function testTmdbToken(token: string) {
  const old = getSetting('tmdbToken');
  db.prepare(`INSERT INTO settings(key,value) VALUES('tmdbToken',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(token);
  try { await tmdb('/configuration'); return true; }
  finally {
    if (old) db.prepare(`UPDATE settings SET value=? WHERE key='tmdbToken'`).run(old);
    else db.prepare(`DELETE FROM settings WHERE key='tmdbToken'`).run();
  }
}

export async function enrichMedia() {
  const rows = db.prepare(`SELECT id, kind, title, year, series_title FROM media_items
    WHERE tmdb_id IS NULL ORDER BY kind, series_title, title`).all() as any[];
  const cache = new Map<string, any>();
  const update = db.prepare(`UPDATE media_items SET tmdb_id=?, overview=?, poster_path=?, backdrop_path=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
  for (const row of rows) {
    const query = row.kind === 'episode' ? row.series_title : row.title;
    const type = row.kind === 'episode' ? 'tv' : 'movie';
    const key = `${type}:${query}:${row.year || ''}`.toLowerCase();
    try {
      let match = cache.get(key);
      if (match === undefined) {
        const params: Record<string, string> = { query };
        if (row.year) params[type === 'movie' ? 'year' : 'first_air_date_year'] = String(row.year);
        const result = await tmdb(`/search/${type}`, params);
        match = result?.results?.[0] || null;
        cache.set(key, match);
      }
      if (match) update.run(match.id, match.overview || '', match.poster_path || null, match.backdrop_path || null, row.id);
    } catch { /* Een mislukte metadata-opvraag mag de scan niet stoppen. */ }
  }
}

export async function searchTmdb(kind: 'movie' | 'tv', query: string, year?: number) {
  const params: Record<string, string> = { query };
  if (year) params[kind === 'movie' ? 'year' : 'first_air_date_year'] = String(year);
  const result = await tmdb(`/search/${kind}`, params);
  return (result?.results || []).slice(0, 8);
}

export async function applyTmdb(mediaId: number, type: 'movie' | 'tv', tmdbId: number) {
  const details = await tmdb(`/${type}/${tmdbId}`);
  if (!details) throw new Error('Geen metadata gevonden.');
  const item = db.prepare('SELECT kind, series_title FROM media_items WHERE id=?').get(mediaId) as any;
  if (!item) throw new Error('Media niet gevonden.');
  if (item.kind === 'episode') {
    db.prepare(`UPDATE media_items SET tmdb_id=?, overview=?, poster_path=?, backdrop_path=?, updated_at=CURRENT_TIMESTAMP WHERE series_title=?`).run(details.id, details.overview || '', details.poster_path || null, details.backdrop_path || null, item.series_title);
  } else {
    db.prepare(`UPDATE media_items SET tmdb_id=?, overview=?, poster_path=?, backdrop_path=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(details.id, details.overview || '', details.poster_path || null, details.backdrop_path || null, mediaId);
  }
}
