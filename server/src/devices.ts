import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';
import type { DeviceCapabilities } from './playback.js';

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const nowSeconds = () => Math.floor(Date.now() / 1000);

declare global {
  namespace Express { interface Request { playbackDevice?: { id: string; name: string; platform: string; userId: number } } }
}

export function requestPairing(input: { id?: string; name: string; manufacturer?: string; model?: string; platform: string; appVersion?: string; capabilities: DeviceCapabilities }) {
  const id = input.id && /^[a-zA-Z0-9_-]{8,80}$/.test(input.id) ? input.id : crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const pairingSecret = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO playback_devices(id,name,manufacturer,model,platform,app_version,capabilities,last_seen_at)
    VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name=excluded.name,manufacturer=excluded.manufacturer,model=excluded.model,
    platform=excluded.platform,app_version=excluded.app_version,capabilities=excluded.capabilities,last_seen_at=CURRENT_TIMESTAMP`).run(
      id, String(input.name || 'TV').slice(0, 100), String(input.manufacturer || '').slice(0, 100), String(input.model || '').slice(0, 100),
      String(input.platform || 'unknown').slice(0, 50), String(input.appVersion || '').slice(0, 30), JSON.stringify(input.capabilities || {})
    );
  db.prepare('DELETE FROM device_pairing_codes WHERE device_id=? OR expires_at<?').run(id, nowSeconds());
  db.prepare('INSERT INTO device_pairing_codes(code_hash,device_id,secret_hash,expires_at) VALUES(?,?,?,?)').run(hash(code), id, hash(pairingSecret), nowSeconds() + 600);
  return { deviceId: id, code, pairingSecret, expiresInSeconds: 600 };
}

export function approvePairing(code: string, userId: number) {
  if (!/^\d{6}$/.test(code)) return false;
  const row = db.prepare('SELECT device_id deviceId FROM device_pairing_codes WHERE code_hash=? AND expires_at>=? AND attempts<10').get(hash(code), nowSeconds()) as any;
  if (!row) return false;
  db.transaction(() => {
    db.prepare('UPDATE playback_devices SET trusted=1,user_id=?,last_seen_at=CURRENT_TIMESTAMP WHERE id=?').run(userId,row.deviceId);
    db.prepare('UPDATE device_pairing_codes SET approved_at=CURRENT_TIMESTAMP WHERE code_hash=?').run(hash(code));
  })();
  return true;
}

export function claimPairing(deviceId: string, pairingSecret: string) {
  const row = db.prepare(`SELECT approved_at approvedAt FROM device_pairing_codes WHERE device_id=? AND secret_hash=? AND expires_at>=? AND claimed_at IS NULL`).get(deviceId, hash(pairingSecret), nowSeconds()) as any;
  if (!row) return { status: 'expired' as const };
  if (!row.approvedAt) return { status: 'waiting' as const };
  const token = crypto.randomBytes(40).toString('base64url');
  db.transaction(() => {
    db.prepare('INSERT INTO device_sessions(token_hash,device_id,expires_at) VALUES(?,?,?)').run(hash(token), deviceId, nowSeconds() + 365 * 86400);
    db.prepare('UPDATE device_pairing_codes SET claimed_at=CURRENT_TIMESTAMP WHERE device_id=?').run(deviceId);
  })();
  return { status: 'approved' as const, token };
}

export function requireDevice(req: Request, res: Response, next: NextFunction) {
  const token = String(req.headers.authorization || '').match(/^Device\s+(.+)$/i)?.[1] || '';
  if (!token) return res.status(401).json({ error: 'Apparaattoken ontbreekt.' });
  const device = db.prepare(`SELECT d.id,d.name,d.platform,d.user_id userId FROM device_sessions s JOIN playback_devices d ON d.id=s.device_id
    WHERE s.token_hash=? AND s.expires_at>=? AND d.trusted=1`).get(hash(token), nowSeconds()) as any;
  if (!device||!device.userId) return res.status(401).json({ error: 'Apparaattoken is ongeldig, verlopen of niet aan een profiel gekoppeld.' });
  req.playbackDevice = device;
  db.prepare('UPDATE playback_devices SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?').run(device.id);
  next();
}

export function listDevices() {
  return (db.prepare(`SELECT id,name,manufacturer,model,platform,app_version appVersion,capabilities,overrides,trusted,last_seen_at lastSeenAt,created_at createdAt
    FROM playback_devices ORDER BY COALESCE(last_seen_at,created_at) DESC`).all() as any[]).map(row => ({ ...row, trusted: Boolean(row.trusted), capabilities: safeJson(row.capabilities), overrides: safeJson(row.overrides) }));
}

export function deviceCapabilities(id: string) {
  const row = db.prepare('SELECT capabilities,overrides FROM playback_devices WHERE id=? AND trusted=1').get(id) as any;
  if (!row) return null;
  return { ...safeJson(row.capabilities), ...safeJson(row.overrides) } as DeviceCapabilities;
}

export function setDeviceOverrides(id: string, overrides: Record<string, unknown>) {
  const clean = JSON.stringify(overrides || {});
  if (clean.length > 50_000) throw new Error('Het capability-profiel is te groot.');
  return db.prepare('UPDATE playback_devices SET overrides=? WHERE id=?').run(clean, id).changes > 0;
}

export function forgetDevice(id: string) {
  return db.prepare('DELETE FROM playback_devices WHERE id=?').run(id).changes > 0;
}

export function queueDeviceCommand(deviceId: string, command: string, payload: unknown = {}) {
  const allowed = ['play', 'pause', 'stop', 'seek', 'next', 'previous', 'volume', 'audio-track', 'subtitle-track', 'quality', 'disconnect', 'load'];
  if (!allowed.includes(command)) throw new Error('Onbekende apparaatopdracht.');
  const result = db.prepare('INSERT INTO device_commands(device_id,command,payload) VALUES(?,?,?)').run(deviceId, command, JSON.stringify(payload || {}));
  return Number(result.lastInsertRowid);
}

export function pendingDeviceCommands(deviceId: string) {
  return (db.prepare('SELECT id,command,payload,created_at createdAt FROM device_commands WHERE device_id=? AND acknowledged_at IS NULL ORDER BY id LIMIT 50').all(deviceId) as any[]).map(row => ({ ...row, payload: safeJson(row.payload) }));
}

export function acknowledgeDeviceCommand(deviceId: string, commandId: number) {
  return db.prepare('UPDATE device_commands SET acknowledged_at=CURRENT_TIMESTAMP WHERE id=? AND device_id=?').run(commandId, deviceId).changes > 0;
}

function safeJson(value: string) { try { return JSON.parse(value || '{}'); } catch { return {}; } }

export const deviceInternals = { hash };
