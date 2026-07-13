import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, type User } from './db.js';

declare global {
  namespace Express {
    interface Request { user?: User }
  }
}

const COOKIE = 'thuishub_session';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function parseCookies(header = ''): Record<string, string> {
  return Object.fromEntries(header.split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(x => x.length === 2));
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hasUsers(): boolean {
  return (db.prepare('SELECT COUNT(*) count FROM users').get() as { count: number }).count > 0;
}

export async function createUser(username: string, password: string, role: 'admin' | 'user' = 'user') {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = db.prepare('INSERT INTO users(username, password_hash, role) VALUES(?, ?, ?)').run(username.trim(), passwordHash, role);
  return { id: Number(result.lastInsertRowid), username: username.trim(), role } satisfies User;
}

export async function verifyUser(username: string, password: string): Promise<User | null> {
  const row = db.prepare('SELECT id, username, password_hash, role, max_content_rating maxContentRating, can_download canDownload FROM users WHERE username = ?').get(username.trim()) as (User & { password_hash: string }) | undefined;
  if (!row || !(await bcrypt.compare(password, row.password_hash))) return null;
  return { id: row.id, username: row.username, role: row.role, maxContentRating: row.maxContentRating, canDownload: Boolean(row.canDownload) };
}

export function startSession(res: Response, user: User) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?, ?, ?)').run(hashToken(token), user.id, Date.now() + MAX_AGE);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: MAX_AGE, path: '/' });
}

export function endSession(req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db.prepare(`SELECT u.id, u.username, u.role, u.max_content_rating maxContentRating, u.can_download canDownload FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(hashToken(token), Date.now()) as User | undefined;
    if (row) req.user = row;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Log eerst in.' });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Log eerst in.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Alleen een beheerder mag dit doen.' });
  next();
}
