import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

type PlaybackGrant = { mediaId: number; resource: 'file' | 'hls' | 'subtitle' | 'download'; userId?: number; deviceId?: string; options?: { copyVideo?: boolean; copyAudio?: boolean; burnSubtitles?: boolean; targetBitrateMbps?: number; targetWidth?: number; targetHeight?: number }; exp: number; nonce: string };

function signingSecret() {
  let secret = getSetting('playbackSigningSecret');
  if (!secret) { secret = crypto.randomBytes(48).toString('base64url'); setSetting('playbackSigningSecret', secret); }
  return secret;
}

export function createPlaybackToken(grant: Omit<PlaybackGrant, 'exp' | 'nonce'>, ttlSeconds = 300) {
  const payload: PlaybackGrant = { ...grant, exp: Math.floor(Date.now() / 1000) + Math.min(3600, Math.max(30, ttlSeconds)), nonce: crypto.randomBytes(12).toString('base64url') };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', signingSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyPlaybackToken(token: string, mediaId: number, resource: PlaybackGrant['resource']) {
  try {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return null;
    const expected = crypto.createHmac('sha256', signingSecret()).update(encoded).digest('base64url');
    const left = Buffer.from(signature); const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const grant = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PlaybackGrant;
    if (grant.mediaId !== mediaId || grant.resource !== resource || grant.exp < Math.floor(Date.now() / 1000)) return null;
    return grant;
  } catch { return null; }
}

export const playbackTokenInternals = { signingSecret };
