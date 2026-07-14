import crypto from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';
import { getPlaybackSession, playbackSessionInternals } from './playback-devices/sessions.js';

export type PlaybackResource = 'file' | 'hls' | 'dlna' | 'subtitle' | 'download' | 'artwork';
export type PlaybackGrantOptions = {
  copyVideo?: boolean;
  copyAudio?: boolean;
  burnSubtitles?: boolean;
  targetBitrateMbps?: number;
  targetWidth?: number;
  targetHeight?: number;
};

export type PlaybackGrant = {
  mediaId: number;
  resource: PlaybackResource;
  userId?: number;
  deviceId?: string;
  sessionId?: string;
  options?: PlaybackGrantOptions;
  iat?: number;
  exp: number;
  nonce: string;
  grantId?: string;
};

type GrantInput = Omit<PlaybackGrant, 'exp' | 'nonce' | 'iat' | 'grantId'>;
type StoredGrant = {
  id_hash: string;
  session_id: string | null;
  media_id: number;
  resource: PlaybackResource;
  user_id: number | null;
  device_id: string | null;
  expires_at: number;
  revoked_at: string | null;
  session_ended_at: string | null;
  session_state: string | null;
  session_user_id: number | null;
  session_media_id: number | null;
  session_device_id: string | null;
};

const resources = new Set<PlaybackResource>(['file', 'hls', 'dlna', 'subtitle', 'download', 'artwork']);
const nowSeconds = () => Math.floor(Date.now() / 1000);
const boundedTtl = (value: number) => Math.min(3600, Math.max(30, Number.isFinite(value) ? Math.floor(value) : 300));

function signingSecret() {
  let secret = getSetting('playbackSigningSecret');
  if (!secret) { secret = crypto.randomBytes(48).toString('base64url'); setSetting('playbackSigningSecret', secret); }
  return secret;
}

function signature(encoded: string) {
  return crypto.createHmac('sha256', signingSecret()).update(encoded).digest('base64url');
}

function decodeSignedToken(token: string): PlaybackGrant | null {
  try {
    if (!token || token.length > 16_384) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [encoded, supplied] = parts;
    const expected = signature(encoded);
    const left = Buffer.from(supplied, 'utf8');
    const right = Buffer.from(expected, 'utf8');
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const grant = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PlaybackGrant;
    if (!Number.isInteger(grant.mediaId) || grant.mediaId <= 0 || !resources.has(grant.resource)) return null;
    if (!Number.isInteger(grant.exp) || typeof grant.nonce !== 'string' || grant.nonce.length < 8) return null;
    if (grant.grantId && !/^[A-Za-z0-9_-]{20,100}$/.test(grant.grantId)) return null;
    if (grant.sessionId && !/^[A-Za-z0-9-]{20,100}$/.test(grant.sessionId)) return null;
    return grant;
  } catch { return null; }
}

function registeredGrant(grant: PlaybackGrant) {
  if (!grant.grantId) return null;
  return db.prepare(`SELECT g.*,
    s.ended_at session_ended_at,s.state session_state,s.user_id session_user_id,
    s.media_id session_media_id,s.device_id session_device_id
    FROM playback_grants g LEFT JOIN playback_sessions s ON s.id=g.session_id WHERE g.id_hash=?`).get(
      playbackSessionInternals.grantHash(grant.grantId)
    ) as StoredGrant | undefined;
}

function registrationIsActive(grant: PlaybackGrant, expectedSessionId?: string) {
  if (!grant.grantId) return !expectedSessionId;
  const stored = registeredGrant(grant);
  const now = nowSeconds();
  if (!stored || stored.revoked_at || stored.expires_at <= now) return false;
  if (stored.media_id !== grant.mediaId || stored.resource !== grant.resource) return false;
  if ((stored.user_id ?? undefined) !== grant.userId || (stored.device_id ?? undefined) !== grant.deviceId) return false;
  if ((stored.session_id ?? undefined) !== grant.sessionId) return false;
  if (expectedSessionId && grant.sessionId !== expectedSessionId) return false;
  if (grant.sessionId) {
    if (stored.session_ended_at || stored.session_state === 'stopped') return false;
    if (stored.session_user_id !== grant.userId || stored.session_media_id !== grant.mediaId || stored.session_device_id !== grant.deviceId) return false;
  }
  db.prepare(`UPDATE playback_grants SET last_used_at=CURRENT_TIMESTAMP,
    expires_at=CASE WHEN session_id IS NOT NULL AND expires_at<? THEN ? ELSE expires_at END WHERE id_hash=?
    AND (last_used_at IS NULL OR last_used_at<datetime('now','-1 minute'))`).run(now + 600, now + 600, stored.id_hash);
  return true;
}

function validateSessionBinding(grant: GrantInput) {
  if (!grant.sessionId) return;
  const session = getPlaybackSession(grant.sessionId);
  if (!session || session.endedAt || session.state === 'stopped') throw Object.assign(new Error('De afspeelsessie is niet actief.'), { status: 409, code: 'PLAYBACK_SESSION_ENDED' });
  if (session.mediaId !== grant.mediaId || session.userId !== grant.userId || session.deviceId !== grant.deviceId) {
    throw Object.assign(new Error('De afspeelgrant hoort niet bij deze sessie.'), { status: 403, code: 'PLAYBACK_GRANT_SESSION_MISMATCH' });
  }
}

function issuePlaybackToken(grant: GrantInput, ttlSeconds = 300, renewedFromHash?: string) {
  validateSessionBinding(grant);
  const now = nowSeconds();
  const payload: PlaybackGrant = {
    ...grant,
    iat: now,
    exp: now + boundedTtl(ttlSeconds),
    nonce: crypto.randomBytes(12).toString('base64url'),
    grantId: crypto.randomBytes(24).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `${encoded}.${signature(encoded)}`;
  db.prepare(`INSERT INTO playback_grants(id_hash,session_id,media_id,resource,user_id,device_id,issued_at,expires_at,renewed_from_hash)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
      playbackSessionInternals.grantHash(payload.grantId!), payload.sessionId || null, payload.mediaId, payload.resource,
      payload.userId ?? null, payload.deviceId || null, now, payload.exp, renewedFromHash || null
    );
  return token;
}

/** Backwards-compatible token factory. New TV playback should supply sessionId. */
export function createPlaybackToken(grant: GrantInput, ttlSeconds = 300) {
  return issuePlaybackToken(grant, ttlSeconds);
}

export function createPlaybackGrant(input: { sessionId: string; resource: PlaybackResource; options?: PlaybackGrantOptions }, ttlSeconds = 300) {
  const session = getPlaybackSession(input.sessionId);
  if (!session || session.endedAt || session.state === 'stopped') throw Object.assign(new Error('De afspeelsessie is niet actief.'), { status: 409, code: 'PLAYBACK_SESSION_ENDED' });
  return issuePlaybackToken({
    sessionId: session.id,
    mediaId: session.mediaId,
    userId: session.userId,
    deviceId: session.deviceId,
    resource: input.resource,
    options: input.options,
  }, ttlSeconds);
}

export function verifyPlaybackToken(token: string, mediaId: number, resource: PlaybackResource, expectedSessionId?: string) {
  const grant = decodeSignedToken(token);
  if (!grant || grant.mediaId !== mediaId || grant.resource !== resource) return null;
  // Sessiegebonde grants hebben een korte, glijdende inactiviteitsduur in de
  // database. De ondertekende oorspronkelijke exp blijft onaangepast; alleen
  // een nog actieve, niet-ingetrokken sessie kan de grant stilzwijgend verlengen.
  if (grant.exp <= nowSeconds() && !grant.sessionId) return null;
  if (!registrationIsActive(grant, expectedSessionId)) return null;
  return grant;
}

export function renewPlaybackGrant(token: string, expectedSessionId: string, expectedUserId: number, ttlSeconds = 300) {
  const grant = decodeSignedToken(token);
  if (!grant || !grant.grantId || !grant.sessionId || grant.sessionId !== expectedSessionId || grant.userId !== expectedUserId
    || !verifyPlaybackToken(token, grant.mediaId, grant.resource, expectedSessionId)) {
    throw Object.assign(new Error('De afspeelgrant is ongeldig, verlopen of ingetrokken.'), { status: 401, code: 'INVALID_PLAYBACK_GRANT' });
  }
  const oldHash = playbackSessionInternals.grantHash(grant.grantId);
  const replacement = issuePlaybackToken({
    mediaId: grant.mediaId,
    resource: grant.resource,
    userId: grant.userId,
    deviceId: grant.deviceId,
    sessionId: grant.sessionId,
    options: grant.options,
  }, ttlSeconds, oldHash);
  const revoked = db.prepare('UPDATE playback_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id_hash=? AND revoked_at IS NULL').run(oldHash).changes;
  if (!revoked) {
    revokePlaybackGrant(replacement);
    throw Object.assign(new Error('De afspeelgrant kon niet veilig worden vernieuwd.'), { status: 409, code: 'PLAYBACK_GRANT_RENEW_FAILED' });
  }
  return replacement;
}

export function revokePlaybackGrant(token: string) {
  const grant = decodeSignedToken(token);
  if (!grant?.grantId) return false;
  return db.prepare('UPDATE playback_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id_hash=? AND revoked_at IS NULL').run(
    playbackSessionInternals.grantHash(grant.grantId)
  ).changes > 0;
}

export const playbackTokenInternals = { signingSecret, decodeSignedToken, boundedTtl, nowSeconds };
