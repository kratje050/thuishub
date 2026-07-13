import Database from 'better-sqlite3';
import fs from 'node:fs';
import { APP_VERSION } from './constants.js';
import { log } from './logger.js';
import { appPaths, applyPendingRestore, migrateLegacyData } from './paths.js';

export type User = { id: number; username: string; role: 'admin' | 'user'; maxContentRating?: string; canDownload?: boolean };

migrateLegacyData(appPaths);
applyPendingRestore(appPaths);
const dataDir = appPaths.dataDir;
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(appPaths.databaseFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind TEXT NOT NULL CHECK(kind IN ('movies', 'series')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS media_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('movie', 'episode')),
    title TEXT NOT NULL,
    sort_title TEXT NOT NULL,
    year INTEGER,
    series_title TEXT,
    season INTEGER,
    episode INTEGER,
    file_path TEXT NOT NULL UNIQUE COLLATE NOCASE,
    subtitle_path TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    duration REAL,
    video_codec TEXT,
    audio_codec TEXT,
    width INTEGER,
    height INTEGER,
    tmdb_id INTEGER,
    overview TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS media_kind_idx ON media_items(kind);
  CREATE INDEX IF NOT EXISTS media_series_idx ON media_items(series_title, season, episode);
  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    position REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, media_id)
  );
  CREATE TABLE IF NOT EXISTS media_user_state (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    favorite INTEGER NOT NULL DEFAULT 0,
    watchlist INTEGER NOT NULL DEFAULT 0,
    watched INTEGER NOT NULL DEFAULT 0,
    rating REAL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, media_id)
  );
  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_public INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS collection_items (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(collection_id, media_id)
  );
  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS playlist_items (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(playlist_id, media_id)
  );
  CREATE TABLE IF NOT EXISTS playback_markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    marker_type TEXT NOT NULL CHECK(marker_type IN ('intro','credits','commercial')),
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    UNIQUE(media_id, marker_type, start_time)
  );
  CREATE TABLE IF NOT EXISTS optimized_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    profile TEXT NOT NULL,
    file_path TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    progress REAL NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT 'play,pause,stop,scan',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS extra_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind TEXT NOT NULL CHECK(kind IN ('music','photos')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS music_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES extra_sources(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT 'Onbekende artiest',
    album TEXT NOT NULL DEFAULT 'Onbekend album',
    album_artist TEXT,
    track INTEGER,
    disc INTEGER,
    year INTEGER,
    genre TEXT NOT NULL DEFAULT '[]',
    duration REAL,
    file_path TEXT NOT NULL UNIQUE COLLATE NOCASE,
    cover_path TEXT,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS music_artist_idx ON music_tracks(artist,album,disc,track);
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES extra_sources(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE COLLATE NOCASE,
    width INTEGER,
    height INTEGER,
    taken_at TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS tv_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    playlist_url TEXT NOT NULL,
    xmltv_url TEXT,
    recording_path TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS tv_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES tv_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    channel_number TEXT,
    logo_url TEXT,
    stream_url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    UNIQUE(source_id, external_id)
  );
  CREATE TABLE IF NOT EXISTS tv_programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT,
    episode TEXT,
    UNIQUE(channel_id,start_time,title)
  );
  CREATE INDEX IF NOT EXISTS tv_program_time_idx ON tv_programs(start_time,end_time);
  CREATE TABLE IF NOT EXISTS tv_recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER REFERENCES tv_programs(id) ON DELETE SET NULL,
    channel_id INTEGER NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    file_path TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('users', 'pin_hash', 'TEXT');
ensureColumn('users', 'max_content_rating', "TEXT NOT NULL DEFAULT 'ALL'");
ensureColumn('users', 'can_download', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('media_items', 'content_rating', 'TEXT');
ensureColumn('media_items', 'genres', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('media_items', 'edition', 'TEXT');
ensureColumn('media_items', 'original_title', 'TEXT');
ensureColumn('media_items', 'tagline', 'TEXT');
ensureColumn('media_items', 'color_transfer', 'TEXT');

export function getSetting(key: string, fallback = ''): string {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function publicSettings() {
  const token = getSetting('tmdbToken');
  return {
    version: APP_VERSION,
    serverName: getSetting('serverName', 'ThuisHub'),
    language: getSetting('language', 'nl-NL'),
    tmdbConfigured: Boolean(token),
    tmdbTokenMasked: token ? `${token.slice(0, 4)}••••${token.slice(-4)}` : '',
    autoplay: getSetting('autoplay', 'true') === 'true',
    rewindOnResume: Number(getSetting('rewindOnResume', '8')),
    skipIntro: getSetting('skipIntro', 'true') === 'true',
    skipCredits: getSetting('skipCredits', 'true') === 'true',
    hardwareTranscoding: getSetting('hardwareTranscoding', 'auto'),
    toneMapping: getSetting('toneMapping', 'true') === 'true',
    maxTranscodes: Number(getSetting('maxTranscodes', '2')),
    uploadLimitMbps: Number(getSetting('uploadLimitMbps', '0')),
    webhookCount: (db.prepare('SELECT COUNT(*) count FROM webhooks WHERE enabled=1').get() as { count: number }).count,
    automaticBackups: getSetting('automaticBackups', 'daily'),
    backupRetention: Number(getSetting('backupRetention', '14')),
    backupLocation: getSetting('backupLocation', appPaths.backupsDir),
    automaticUpdateCheck: getSetting('automaticUpdateCheck', 'false') === 'true',
    updateChannel: getSetting('updateChannel', 'stable'),
    updateManifestUrl: getSetting('updateManifestUrl', ''),
    maxLogStorageMb: Number(getSetting('maxLogStorageMb', '100'))
  };
}

export function databaseIntegrity() {
  const rows = db.pragma('integrity_check') as { integrity_check: string }[];
  const details = rows.map(row => row.integrity_check);
  return { ok: details.every(value => value === 'ok'), details };
}

export function markCleanShutdown() {
  try { setSetting('cleanShutdown', 'true'); } catch {}
}

const previousShutdownWasClean = getSetting('cleanShutdown', 'true') === 'true';
if (!previousShutdownWasClean) {
  const result = databaseIntegrity();
  log(result.ok ? 'WARNING' : 'CRITICAL', 'database', result.ok ? 'Database gecontroleerd na een onverwachte afsluiting.' : 'Database lijkt beschadigd na een onverwachte afsluiting.', { details: result.details });
}
setSetting('cleanShutdown', 'false');
log('INFO', 'database', 'Database geopend.', { file: appPaths.databaseFile, previousShutdownWasClean });

export { dataDir };
