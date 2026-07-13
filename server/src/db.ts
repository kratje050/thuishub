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
  CREATE TABLE IF NOT EXISTS playback_devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    manufacturer TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL,
    app_version TEXT NOT NULL DEFAULT '',
    capabilities TEXT NOT NULL DEFAULT '{}',
    overrides TEXT NOT NULL DEFAULT '{}',
    trusted INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS device_sessions (
    token_hash TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES playback_devices(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS device_pairing_codes (
    code_hash TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES playback_devices(id) ON DELETE CASCADE,
    secret_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    approved_at TEXT,
    claimed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS device_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES playback_devices(id) ON DELETE CASCADE,
    command TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    acknowledged_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS device_commands_pending_idx ON device_commands(device_id,acknowledged_at,id);
  CREATE TABLE IF NOT EXISTS metadata_external_ids (
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    legacy INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(media_id,provider)
  );
  CREATE INDEX IF NOT EXISTS metadata_external_lookup_idx ON metadata_external_ids(provider,external_id);
  CREATE TABLE IF NOT EXISTS metadata_field_state (
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    value_json TEXT,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    manually_modified INTEGER NOT NULL DEFAULT 0,
    auto_overwrite INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(media_id,field_name)
  );
  CREATE TABLE IF NOT EXISTS metadata_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    previous_value_json TEXT,
    new_value_json TEXT,
    provider TEXT NOT NULL,
    manual INTEGER NOT NULL DEFAULT 0,
    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS metadata_history_media_idx ON metadata_history(media_id,changed_at DESC);
  CREATE TABLE IF NOT EXISTS metadata_credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    credit_type TEXT NOT NULL CHECK(credit_type IN ('cast','crew')),
    name TEXT NOT NULL,
    role TEXT,
    character_name TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL,
    UNIQUE(media_id,credit_type,name,role,character_name)
  );
  CREATE TABLE IF NOT EXISTS metadata_ratings (
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    value REAL NOT NULL,
    max_value REAL NOT NULL DEFAULT 10,
    votes INTEGER,
    provider TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(media_id,source)
  );
  CREATE TABLE IF NOT EXISTS metadata_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    image_type TEXT NOT NULL CHECK(image_type IN ('poster','backdrop','banner','logo','landscape','episode')),
    provider TEXT NOT NULL,
    original_url TEXT,
    local_path TEXT,
    content_type TEXT,
    byte_size INTEGER,
    sha256 TEXT,
    manually_selected INTEGER NOT NULL DEFAULT 0,
    selected INTEGER NOT NULL DEFAULT 0,
    downloaded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(media_id,image_type,provider,original_url,local_path)
  );
  CREATE INDEX IF NOT EXISTS metadata_images_selected_idx ON metadata_images(media_id,image_type,selected);
  CREATE TABLE IF NOT EXISTS metadata_provider_cache (
    provider TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    status_code INTEGER NOT NULL DEFAULT 200,
    stored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    PRIMARY KEY(provider,cache_key)
  );
  CREATE TABLE IF NOT EXISTS metadata_provider_state (
    provider TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_success_at TEXT,
    last_error_at TEXT,
    last_error TEXT,
    rate_limited_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS metadata_provider_usage (
    provider TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    cache_hits INTEGER NOT NULL DEFAULT 0,
    cache_misses INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(provider,usage_date)
  );
  CREATE TABLE IF NOT EXISTS metadata_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    operation TEXT NOT NULL DEFAULT 'fill_missing',
    preferred_provider TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','review','completed','error')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(media_id,operation,status)
  );
  CREATE INDEX IF NOT EXISTS metadata_queue_status_idx ON metadata_queue(status,id);
  CREATE TABLE IF NOT EXISTS metadata_migration_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    report_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
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
ensureColumn('media_items', 'metadata_provider', 'TEXT');
ensureColumn('media_items', 'metadata_last_refreshed', 'TEXT');
ensureColumn('media_items', 'metadata_match_confidence', 'TEXT');
ensureColumn('media_items', 'metadata_needs_review', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('media_items', 'metadata_runtime_minutes', 'INTEGER');
ensureColumn('media_items', 'premiered', 'TEXT');
ensureColumn('media_items', 'original_content_rating', 'TEXT');
ensureColumn('media_items', 'metadata_language', 'TEXT');
ensureColumn('media_items', 'metadata_country', 'TEXT');
ensureColumn('media_items', 'studio', 'TEXT');
ensureColumn('media_items', 'directors', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('media_items', 'writers', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('media_items', 'cast_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('media_items', 'ratings_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('media_items', 'official_url', 'TEXT');
ensureColumn('media_items', 'banner_path', 'TEXT');
ensureColumn('media_items', 'absolute_episode', 'INTEGER');
ensureColumn('media_items', 'aired', 'TEXT');
ensureColumn('media_items', 'display_season', 'INTEGER');
ensureColumn('media_items', 'display_episode', 'INTEGER');
ensureColumn('media_items', 'metadata_tags', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('media_items', 'series_status', 'TEXT');
ensureColumn('media_items', 'metadata_network', 'TEXT');
ensureColumn('media_items', 'streaming_service', 'TEXT');
ensureColumn('media_items', 'awards', 'TEXT');
ensureColumn('media_items', 'trailer_url', 'TEXT');
ensureColumn('media_items', 'color_transfer', 'TEXT');
ensureColumn('media_items', 'container', 'TEXT');
ensureColumn('media_items', 'probe_json', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('media_items', 'video_profile', 'TEXT');
ensureColumn('media_items', 'codec_level', 'TEXT');
ensureColumn('media_items', 'pixel_format', 'TEXT');
ensureColumn('media_items', 'bit_depth', 'INTEGER NOT NULL DEFAULT 8');
ensureColumn('media_items', 'frame_rate', 'REAL');
ensureColumn('media_items', 'bitrate', 'INTEGER');
ensureColumn('media_items', 'color_primaries', 'TEXT');
ensureColumn('media_items', 'color_space', 'TEXT');
ensureColumn('media_items', 'hdr_type', "TEXT NOT NULL DEFAULT 'sdr'");
ensureColumn('media_items', 'dolby_vision_profile', 'INTEGER');
ensureColumn('media_items', 'dolby_vision_layer', 'TEXT');
ensureColumn('media_items', 'dolby_vision_enhancement', 'TEXT');
ensureColumn('media_items', 'hdr10_compatibility_layer', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('media_items', 'audio_profile', 'TEXT');
ensureColumn('media_items', 'audio_channels', 'INTEGER');
ensureColumn('media_items', 'audio_layout', 'TEXT');
ensureColumn('media_items', 'atmos', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('media_items', 'dts_x', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('media_items', 'subtitle_format', "TEXT NOT NULL DEFAULT 'none'");
ensureColumn('playback_devices', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');

export function getSetting(key: string, fallback = ''): string {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function publicSettings() {
  return {
    version: APP_VERSION,
    serverName: getSetting('serverName', 'ThuisHub'),
    language: getSetting('language', 'nl-NL'),
    metadataCacheDays: Number(getSetting('metadataCacheDays','14')),
    omdbLocalDailyLimit: Number(getSetting('omdbLocalDailyLimit','1000')),
    metadataStrategy:getSetting('metadataStrategy','local_first'),
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
    developmentUpdatesEnabled: getSetting('developmentUpdatesEnabled', 'false') === 'true',
    updateManifestUrl: getSetting('updateManifestUrl', ''),
    maxLogStorageMb: Number(getSetting('maxLogStorageMb', '100'))
    ,localStreamingEnabled: getSetting('localStreamingEnabled', 'false') === 'true'
    ,localStreamingAddress: getSetting('localStreamingAddress', '')
    ,localStreamingPort: Number(getSetting('localStreamingPort', '8788'))
    ,castReceiverAppId: getSetting('castReceiverAppId', '')
    ,defaultQualityLan: getSetting('defaultQualityLan', 'original')
    ,defaultQualityTailscale: getSetting('defaultQualityTailscale', 'auto')
    ,defaultQualityMobile: getSetting('defaultQualityMobile', '1080p-balanced')
    ,defaultQualityDownload: getSetting('defaultQualityDownload', 'original')
    ,defaultQualityLiveTv: getSetting('defaultQualityLiveTv', 'auto')
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
