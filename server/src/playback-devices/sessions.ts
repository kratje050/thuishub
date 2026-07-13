import crypto from 'node:crypto';
import { db } from '../db.js';

export type PlaybackSessionState = 'connecting' | 'playing' | 'paused' | 'buffering' | 'stopped' | 'error';

export type PlaybackSession = {
  id: string;
  userId: number;
  mediaId: number;
  deviceId: string;
  protocol: string;
  state: PlaybackSessionState;
  position: number;
  duration: number;
  revision: number;
  controllerId: string | null;
  playbackMode: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  endReason: string | null;
};

export type CreatePlaybackSessionInput = {
  userId: number;
  mediaId: number;
  deviceId: string;
  protocol: string;
  startPosition?: number;
  duration?: number;
  state?: Exclude<PlaybackSessionState, 'stopped'>;
  controllerId?: string | null;
  playbackMode?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Keep this active session alive until the newly created receiver confirms
   * playback. This is intentionally separate from metadata so callers cannot
   * accidentally opt into a non-atomic handoff by supplying an arbitrary
   * transferFromSessionId value.
   */
  handoffFromSessionId?: string;
  /**
   * Internal opt-in for replacing media on the very same receiver. Normal
   * device handoffs keep rejecting this so an accidental duplicate session
   * cannot retire the only active source.
   */
  allowSameDeviceHandoff?: boolean;
};

export type UpdatePlaybackSessionInput = {
  id: string;
  revision: number;
  userId?: number;
  state?: PlaybackSessionState;
  position?: number;
  duration?: number;
  controllerId?: string | null;
  playbackMode?: string | null;
  metadata?: Record<string, unknown>;
};

export type StopPlaybackSessionInput = {
  id: string;
  userId?: number;
  revision?: number;
  position?: number;
  duration?: number;
  reason?: string;
};

export type PlaybackControlAction = 'play' | 'pause' | 'buffer' | 'seek' | 'stop' | 'error';
export type ControlPlaybackSessionInput = Omit<UpdatePlaybackSessionInput, 'state'> & {
  action: PlaybackControlAction;
  reason?: string;
};

type SessionRow = {
  id: string;
  user_id: number;
  media_id: number;
  device_id: string;
  protocol: string;
  state: PlaybackSessionState;
  position: number;
  duration: number;
  revision: number;
  controller_id: string | null;
  playback_mode: string | null;
  metadata_json: string;
  progress_dirty: number;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  end_reason: string | null;
};

const states = new Set<PlaybackSessionState>(['connecting', 'playing', 'paused', 'buffering', 'stopped', 'error']);
const activeStates = new Set<PlaybackSessionState>(['connecting', 'playing', 'paused', 'buffering', 'error']);
const controlActions = new Set<PlaybackControlAction>(['play', 'pause', 'buffer', 'seek', 'stop', 'error']);

export const PLAYBACK_TRANSFER_TIMEOUT_MS = 45_000;

export class PlaybackSessionError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export function initializePlaybackSessionSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS playback_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      protocol TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'connecting',
      position REAL NOT NULL DEFAULT 0,
      duration REAL NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      controller_id TEXT,
      playback_mode TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      progress_dirty INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      end_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS playback_sessions_user_active_idx
      ON playback_sessions(user_id, ended_at, updated_at DESC);
    CREATE INDEX IF NOT EXISTS playback_sessions_device_active_idx
      ON playback_sessions(device_id, ended_at, updated_at DESC);
    CREATE TABLE IF NOT EXISTS playback_grants (
      id_hash TEXT PRIMARY KEY,
      session_id TEXT REFERENCES playback_sessions(id) ON DELETE CASCADE,
      media_id INTEGER NOT NULL,
      resource TEXT NOT NULL,
      user_id INTEGER,
      device_id TEXT,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at TEXT,
      last_used_at TEXT,
      renewed_from_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS playback_grants_session_active_idx
      ON playback_grants(session_id, revoked_at, expires_at);
  `);
}

initializePlaybackSessionSchema();

function finiteNonNegative(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new PlaybackSessionError(`${label} moet een geldig positief getal zijn.`, 400, 'INVALID_PLAYBACK_SESSION');
  return parsed;
}

function normalizedPosition(position: number, duration: number) {
  return duration > 0 ? Math.min(position, duration) : position;
}

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new PlaybackSessionError(`${label} is ongeldig.`, 400, 'INVALID_PLAYBACK_SESSION');
  return parsed;
}

function limitedText(value: unknown, label: string, maximum: number) {
  const text = String(value || '').trim();
  if (!text || text.length > maximum) throw new PlaybackSessionError(`${label} is ongeldig.`, 400, 'INVALID_PLAYBACK_SESSION');
  return text;
}

function metadataJson(value: Record<string, unknown> | undefined) {
  const json = JSON.stringify(value || {});
  if (json.length > 50_000) throw new PlaybackSessionError('De sessiemetadata is te groot.', 400, 'INVALID_PLAYBACK_SESSION');
  return json;
}

function safeJson(value: string) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function sessionFromRow(row: SessionRow | undefined): PlaybackSession | null {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    mediaId: row.media_id,
    deviceId: row.device_id,
    protocol: row.protocol,
    state: row.state,
    position: Number(row.position),
    duration: Number(row.duration),
    revision: Number(row.revision),
    controllerId: row.controller_id,
    playbackMode: row.playback_mode,
    metadata: safeJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
  };
}

function sessionRow(id: string, userId?: number) {
  return (userId === undefined
    ? db.prepare('SELECT * FROM playback_sessions WHERE id=?').get(id)
    : db.prepare('SELECT * FROM playback_sessions WHERE id=? AND user_id=?').get(id, userId)) as SessionRow | undefined;
}

function persistProgress(row: SessionRow, options: { allowPending?: boolean; monotonic?: boolean } = {}) {
  if (!row.progress_dirty) return;
  if (!options.allowPending && transferSourceIdFromMetadata(safeJson(row.metadata_json))) return;
  let duration = Math.max(0, Number(row.duration) || 0);
  let position = Math.max(0, duration > 0 ? Math.min(Number(row.position) || 0, duration) : Number(row.position) || 0);
  let completed = duration > 0 && position / duration >= 0.92 ? 1 : 0;
  if (options.monotonic) {
    const existing = db.prepare('SELECT position,duration,completed FROM progress WHERE user_id=? AND media_id=?')
      .get(row.user_id, row.media_id) as { position: number; duration: number; completed: number } | undefined;
    const existingPosition = Math.max(0, Number(existing?.position) || 0);
    if (existing && (Boolean(existing.completed) || existingPosition > position)) {
      position = existingPosition;
      duration = Math.max(0, Number(existing.duration) || duration);
      completed = Boolean(existing.completed) || (duration > 0 && position / duration >= 0.92) ? 1 : 0;
    }
  }
  db.prepare(`INSERT INTO progress(user_id,media_id,position,duration,completed,updated_at)
    VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id,media_id) DO UPDATE SET position=excluded.position,duration=excluded.duration,
      completed=excluded.completed,updated_at=CURRENT_TIMESTAMP`).run(row.user_id, row.media_id, position, duration, completed);
}

function revokeRowsForSession(sessionId: string) {
  return db.prepare('UPDATE playback_grants SET revoked_at=CURRENT_TIMESTAMP WHERE session_id=? AND revoked_at IS NULL').run(sessionId).changes;
}

function finishRow(row: SessionRow, reason: string) {
  persistProgress(row);
  db.prepare(`UPDATE playback_sessions SET state='stopped',ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP),
    end_reason=COALESCE(end_reason,?),revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ended_at IS NULL`).run(reason, row.id);
  revokeRowsForSession(row.id);
}

function transferSourceIdFromMetadata(metadata: Record<string, unknown>) {
  const value = metadata.transferFromSessionId;
  return typeof value === 'string' && value.length > 0 && value.length <= 100 ? value : null;
}

function transferDeadlineFromMetadata(metadata: Record<string, unknown>, createdAt: string) {
  const value = Number(metadata.transferDeadlineAt);
  if (Number.isFinite(value) && value > 0) return value;
  const created = Date.parse(createdAt.endsWith('Z') ? createdAt : `${createdAt.replace(' ', 'T')}Z`);
  return (Number.isFinite(created) ? created : Date.now()) + PLAYBACK_TRANSFER_TIMEOUT_MS;
}

export function createPlaybackSession(input: CreatePlaybackSessionInput) {
  const userId = positiveInteger(input.userId, 'Gebruiker');
  const mediaId = positiveInteger(input.mediaId, 'Media-item');
  const deviceId = limitedText(input.deviceId, 'Apparaat-ID', 200);
  const protocol = limitedText(input.protocol, 'Protocol', 50).toLowerCase();
  const state = input.state === undefined ? 'connecting' : input.state;
  if (!activeStates.has(state)) throw new PlaybackSessionError('De beginsituatie van de afspeelsessie is ongeldig.', 400, 'INVALID_PLAYBACK_SESSION');
  const duration = finiteNonNegative(input.duration || 0, 'Speelduur');
  const position = normalizedPosition(finiteNonNegative(input.startPosition || 0, 'Afspeelpositie'), duration);
  const controllerId = input.controllerId === null || input.controllerId === undefined ? null : limitedText(input.controllerId, 'Controller-ID', 200);
  const playbackMode = input.playbackMode === null || input.playbackMode === undefined ? null : limitedText(input.playbackMode, 'Afspeelmethode', 50);
  const handoffFromSessionId = input.handoffFromSessionId === undefined ? null : limitedText(input.handoffFromSessionId, 'Overdrachtsbron', 100);
  const metadata: Record<string, unknown> = { ...(input.metadata || {}) };
  delete metadata.transferFromSessionId;
  delete metadata.transferDeadlineAt;
  if (handoffFromSessionId) {
    metadata.transferFromSessionId = handoffFromSessionId;
    metadata.transferDeadlineAt = Date.now() + PLAYBACK_TRANSFER_TIMEOUT_MS;
  }
  const id = crypto.randomUUID();

  const create = db.transaction(() => {
    const current = db.prepare('SELECT * FROM playback_sessions WHERE user_id=? AND ended_at IS NULL ORDER BY rowid DESC').all(userId) as SessionRow[];
    const source = handoffFromSessionId ? current.find(row => row.id === handoffFromSessionId) : undefined;
    if (handoffFromSessionId && (!source || source.device_id === deviceId && !input.allowSameDeviceHandoff)) {
      throw new PlaybackSessionError('De bron van de afspeeloverdracht is niet meer actief of gebruikt hetzelfde apparaat.', 409, 'PLAYBACK_TRANSFER_SOURCE_UNAVAILABLE');
    }
    for (const row of current) {
      if (source && row.id === source.id) continue;
      const reason = transferSourceIdFromMetadata(safeJson(row.metadata_json)) ? 'transfer-replaced' : 'superseded';
      finishRow(row, reason);
    }
    db.prepare(`INSERT INTO playback_sessions(id,user_id,media_id,device_id,protocol,state,position,duration,controller_id,playback_mode,metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, mediaId, deviceId, protocol, state, position, duration, controllerId, playbackMode, metadataJson(metadata));
  });
  try { create(); }
  catch (error) {
    if (error instanceof PlaybackSessionError) throw error;
    throw new PlaybackSessionError('De afspeelsessie kon niet worden aangemaakt.', 400, 'PLAYBACK_SESSION_CREATE_FAILED');
  }
  return getPlaybackSession(id)!;
}

export function getActivePlaybackSession(userId: number) {
  const row = db.prepare('SELECT * FROM playback_sessions WHERE user_id=? AND ended_at IS NULL ORDER BY rowid DESC LIMIT 1').get(positiveInteger(userId, 'Gebruiker')) as SessionRow | undefined;
  return sessionFromRow(row);
}

export function listActivePlaybackSessions(userId: number) {
  return (db.prepare('SELECT * FROM playback_sessions WHERE user_id=? AND ended_at IS NULL ORDER BY rowid DESC').all(positiveInteger(userId, 'Gebruiker')) as SessionRow[])
    .map(row => sessionFromRow(row)!);
}

export function listPendingPlaybackTransfers(userId?: number) {
  const rows = (userId === undefined
    ? db.prepare('SELECT * FROM playback_sessions WHERE ended_at IS NULL ORDER BY rowid DESC').all()
    : db.prepare('SELECT * FROM playback_sessions WHERE user_id=? AND ended_at IS NULL ORDER BY rowid DESC').all(positiveInteger(userId, 'Gebruiker'))) as SessionRow[];
  return rows.map(row => sessionFromRow(row)!).filter(session => Boolean(transferSourceIdFromMetadata(session.metadata)));
}

export function getPlaybackSession(id: string, userId?: number) {
  return sessionFromRow(sessionRow(limitedText(id, 'Sessiesleutel', 100), userId));
}

function normalizeUpdate(first: string | UpdatePlaybackSessionInput, second?: Omit<UpdatePlaybackSessionInput, 'id'>): UpdatePlaybackSessionInput {
  return typeof first === 'string' ? { id: first, ...second! } : first;
}

export function updatePlaybackSession(input: UpdatePlaybackSessionInput): PlaybackSession;
export function updatePlaybackSession(id: string, input: Omit<UpdatePlaybackSessionInput, 'id'>): PlaybackSession;
export function updatePlaybackSession(first: string | UpdatePlaybackSessionInput, second?: Omit<UpdatePlaybackSessionInput, 'id'>) {
  const input = normalizeUpdate(first, second);
  if (input.state === 'stopped') return stopPlaybackSession({ id: input.id, userId: input.userId, revision: input.revision, position: input.position, duration: input.duration });
  const id = limitedText(input.id, 'Sessiesleutel', 100);
  if (!Number.isInteger(input.revision) || input.revision < 0) throw new PlaybackSessionError('De sessierevisie is ongeldig.', 400, 'INVALID_PLAYBACK_SESSION');
  const current = sessionRow(id, input.userId);
  if (!current) throw new PlaybackSessionError('De afspeelsessie is niet gevonden.', 404, 'PLAYBACK_SESSION_NOT_FOUND');
  if (current.ended_at) throw new PlaybackSessionError('De afspeelsessie is al gestopt.', 409, 'PLAYBACK_SESSION_ENDED');
  if (current.revision !== input.revision) throw new PlaybackSessionError('De afspeelsessie is ondertussen op een ander apparaat bijgewerkt.', 409, 'STALE_PLAYBACK_SESSION');
  const state = input.state === undefined ? current.state : input.state;
  if (!states.has(state) || state === 'stopped') throw new PlaybackSessionError('De afspeelstatus is ongeldig.', 400, 'INVALID_PLAYBACK_SESSION');
  const duration = input.duration === undefined ? current.duration : finiteNonNegative(input.duration, 'Speelduur');
  const position = normalizedPosition(input.position === undefined ? current.position : finiteNonNegative(input.position, 'Afspeelpositie'), duration);
  const controllerId = input.controllerId === undefined ? current.controller_id : input.controllerId === null ? null : limitedText(input.controllerId, 'Controller-ID', 200);
  const playbackMode = input.playbackMode === undefined ? current.playback_mode : input.playbackMode === null ? null : limitedText(input.playbackMode, 'Afspeelmethode', 50);
  let meta = current.metadata_json;
  if (input.metadata !== undefined) {
    const currentMetadata = safeJson(current.metadata_json);
    const suppliedMetadata = { ...input.metadata };
    // Transfer markers are server-owned lifecycle state. A controller may
    // update presentation metadata, but cannot forge or clear a handoff.
    delete suppliedMetadata.transferFromSessionId;
    delete suppliedMetadata.transferDeadlineAt;
    const transferSourceId = transferSourceIdFromMetadata(currentMetadata);
    if (transferSourceId) {
      suppliedMetadata.transferFromSessionId = transferSourceId;
      suppliedMetadata.transferDeadlineAt = transferDeadlineFromMetadata(currentMetadata, current.created_at);
    }
    meta = metadataJson(suppliedMetadata);
  }
  const dirty = current.progress_dirty || input.position !== undefined || input.duration !== undefined ? 1 : 0;

  const apply = db.transaction(() => {
    const changed = db.prepare(`UPDATE playback_sessions SET state=?,position=?,duration=?,controller_id=?,playback_mode=?,metadata_json=?,
      progress_dirty=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? AND ended_at IS NULL`).run(
      state, position, duration, controllerId, playbackMode, meta, dirty, id, input.revision
    ).changes;
    if (!changed) throw new PlaybackSessionError('De afspeelsessie is ondertussen op een ander apparaat bijgewerkt.', 409, 'STALE_PLAYBACK_SESSION');
    const updated = sessionRow(id)!;
    persistProgress(updated);
  });
  apply();
  return getPlaybackSession(id)!;
}

function normalizeStop(first: string | StopPlaybackSessionInput, second?: Omit<StopPlaybackSessionInput, 'id'>): StopPlaybackSessionInput {
  return typeof first === 'string' ? { id: first, ...second } : first;
}

export function stopPlaybackSession(input: StopPlaybackSessionInput): PlaybackSession;
export function stopPlaybackSession(id: string, input?: Omit<StopPlaybackSessionInput, 'id'>): PlaybackSession;
export function stopPlaybackSession(first: string | StopPlaybackSessionInput, second?: Omit<StopPlaybackSessionInput, 'id'>) {
  const input = normalizeStop(first, second);
  const id = limitedText(input.id, 'Sessiesleutel', 100);
  const current = sessionRow(id, input.userId);
  if (!current) throw new PlaybackSessionError('De afspeelsessie is niet gevonden.', 404, 'PLAYBACK_SESSION_NOT_FOUND');
  if (input.revision !== undefined && (!Number.isInteger(input.revision) || input.revision !== current.revision)) {
    throw new PlaybackSessionError('De afspeelsessie is ondertussen op een ander apparaat bijgewerkt.', 409, 'STALE_PLAYBACK_SESSION');
  }
  if (current.ended_at) {
    revokeRowsForSession(id);
    return sessionFromRow(current)!;
  }
  const duration = input.duration === undefined ? current.duration : finiteNonNegative(input.duration, 'Speelduur');
  const position = normalizedPosition(input.position === undefined ? current.position : finiteNonNegative(input.position, 'Afspeelpositie'), duration);
  const reason = String(input.reason || 'stopped').slice(0, 100);
  const dirty = current.progress_dirty || input.position !== undefined || input.duration !== undefined ? 1 : 0;
  const stop = db.transaction(() => {
    const changed = db.prepare(`UPDATE playback_sessions SET state='stopped',position=?,duration=?,progress_dirty=?,revision=revision+1,
      ended_at=CURRENT_TIMESTAMP,end_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? AND ended_at IS NULL`).run(
      position, duration, dirty, reason, id, current.revision
    ).changes;
    if (!changed) throw new PlaybackSessionError('De afspeelsessie is ondertussen op een ander apparaat bijgewerkt.', 409, 'STALE_PLAYBACK_SESSION');
    const stopped = sessionRow(id)!;
    persistProgress(stopped);
    revokeRowsForSession(id);
  });
  stop();
  return getPlaybackSession(id)!;
}

function normalizeControl(first: string | ControlPlaybackSessionInput, action?: PlaybackControlAction, input?: Omit<ControlPlaybackSessionInput, 'id' | 'action'>): ControlPlaybackSessionInput {
  if (typeof first !== 'string') return first;
  if (!action || !input) throw new PlaybackSessionError('De afspeelopdracht is onvolledig.', 400, 'INVALID_PLAYBACK_SESSION');
  return { id: first, action, ...input };
}

export function controlPlaybackSession(input: ControlPlaybackSessionInput): PlaybackSession;
export function controlPlaybackSession(id: string, action: PlaybackControlAction, input: Omit<ControlPlaybackSessionInput, 'id' | 'action'>): PlaybackSession;
export function controlPlaybackSession(first: string | ControlPlaybackSessionInput, action?: PlaybackControlAction, extra?: Omit<ControlPlaybackSessionInput, 'id' | 'action'>) {
  const input = normalizeControl(first, action, extra);
  if (!controlActions.has(input.action)) throw new PlaybackSessionError('De afspeelopdracht is ongeldig.', 400, 'INVALID_PLAYBACK_SESSION');
  if (input.action === 'stop') return stopPlaybackSession({ id: input.id, userId: input.userId, revision: input.revision, position: input.position, duration: input.duration, reason: input.reason });
  const mapped: PlaybackSessionState = input.action === 'play' ? 'playing' : input.action === 'pause' ? 'paused' : input.action === 'buffer' ? 'buffering' : input.action === 'error' ? 'error' : sessionRow(input.id, input.userId)?.state || 'paused';
  return updatePlaybackSession({ ...input, state: mapped });
}

export function revokePlaybackGrantsForSession(sessionId: string) {
  return revokeRowsForSession(limitedText(sessionId, 'Sessiesleutel', 100));
}

/** Atomically promotes a confirmed receiver and retires the old one. */
export function finalizePlaybackHandoff(id: string, userId: number) {
  const sessionId = limitedText(id, 'Sessiesleutel', 100);
  const ownerId = positiveInteger(userId, 'Gebruiker');
  const finalize = db.transaction(() => {
    const current = sessionRow(sessionId, ownerId);
    if (!current || current.ended_at) return;
    const metadata = safeJson(current.metadata_json);
    const sourceId = transferSourceIdFromMetadata(metadata);
    if (!sourceId) return;
    if (current.state !== 'playing') throw new PlaybackSessionError('De nieuwe ontvanger heeft het afspelen nog niet bevestigd.', 409, 'PLAYBACK_TRANSFER_NOT_PLAYING');
    const source = sessionRow(sourceId, ownerId);
    if (source && !source.ended_at && source.id !== current.id) finishRow(source, 'transferred');
    // A pending receiver may report an initial or slightly stale position while
    // the source is still running. Persist it only after the source has been
    // finalized, and never move watch progress backwards for the same media.
    persistProgress(current, { allowPending: true, monotonic: source?.media_id === current.media_id });
    delete metadata.transferFromSessionId;
    delete metadata.transferDeadlineAt;
    db.prepare(`UPDATE playback_sessions SET metadata_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND user_id=? AND ended_at IS NULL`).run(metadataJson(metadata), current.id, ownerId);
  });
  finalize();
  return getPlaybackSession(sessionId, ownerId);
}

/** Ends only the unconfirmed destination; the transfer source remains active. */
export function rollbackPlaybackHandoff(id: string, userId: number, reason = 'transfer-failed') {
  const sessionId = limitedText(id, 'Sessiesleutel', 100);
  const ownerId = positiveInteger(userId, 'Gebruiker');
  const rollback = db.transaction(() => {
    const current = sessionRow(sessionId, ownerId);
    if (!current || current.ended_at) return;
    if (!transferSourceIdFromMetadata(safeJson(current.metadata_json))) {
      throw new PlaybackSessionError('Deze afspeelsessie is geen wachtende overdracht.', 409, 'PLAYBACK_TRANSFER_NOT_PENDING');
    }
    finishRow(current, String(reason || 'transfer-failed').slice(0, 100));
  });
  rollback();
  return getPlaybackSession(sessionId, ownerId);
}

export function playbackTransferSourceId(session: PlaybackSession) {
  return transferSourceIdFromMetadata(session.metadata);
}

export function playbackTransferDeadline(session: PlaybackSession) {
  return transferDeadlineFromMetadata(session.metadata, session.createdAt);
}

export const playbackSessionInternals = {
  grantHash(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); },
  sessionRow,
  transferSourceIdFromMetadata,
};
