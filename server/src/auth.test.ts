import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, describe, expect, it } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-auth-'));
process.env.APPDATA = path.join(root, 'appdata');
process.env.LOCALAPPDATA = path.join(root, 'localappdata');
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');

const database = await import('./db.js');
const auth = await import('./auth.js');

afterAll(() => {
  database.db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('wachtwoordloos lokaal profiel', () => {
  it('maakt bij een lege installatie automatisch één beheerder aan', () => {
    expect(auth.hasUsers()).toBe(false);
    const owner = auth.ensureLocalOwner();
    expect(owner).toMatchObject({ username: 'Beheerder', role: 'admin', canDownload: true });
    expect(database.db.prepare('SELECT COUNT(*) count FROM users').get()).toMatchObject({ count: 1 });
    expect(auth.ensureLocalOwner().id).toBe(owner.id);
  });

  it('geeft ieder verzoek direct toegang zonder cookie of sessie', () => {
    const req = { headers: {} } as Request;
    let continued = false;
    auth.optionalAuth(req, {} as Response, (() => { continued = true; }) as NextFunction);
    expect(continued).toBe(true);
    expect(req.user).toMatchObject({ role: 'admin' });
    expect(database.db.prepare('SELECT COUNT(*) count FROM sessions').get()).toMatchObject({ count: 0 });
  });
});
