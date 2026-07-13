import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-services-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');

const backup = await import('./backup.js');
const database = await import('./db.js');
const { loggerInternals } = await import('./logger.js');
const { tailscaleStatus } = await import('./tailscale.js');
const updates = await import('./updates.js');

afterAll(() => { database.db.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('back-up en herstel', () => {
  it('maakt en verifieert een handmatige en automatische database-snapshot', async () => {
    const manual = await backup.createBackup('manual');
    const automatic = await backup.createBackup('daily');
    expect(backup.verifyBackup(manual.name).ok).toBe(true);
    expect(backup.verifyBackup(automatic.name).ok).toBe(true);
    expect(database.databaseIntegrity().ok).toBe(true);
  });

  it('plant herstel pas na controle en maakt eerst een noodback-up', async () => {
    const source = await backup.createBackup('manual');
    const result = await backup.scheduleRestore(source.name);
    expect(result.restartRequired).toBe(true);
    expect(fs.existsSync(path.join(root, '.restore-pending.json'))).toBe(true);
  });
});

describe('logboeken', () => {
  it('roteert bestanden en verbergt geheimen', () => {
    const file = path.join(root, 'rotate.log');
    fs.writeFileSync(file, '123456');
    loggerInternals.rotate(file, 3);
    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(loggerInternals.redact({ password: 'geheim', authorization: 'Bearer token' })).toEqual({ password: '[VERBORGEN]', authorization: '[VERBORGEN]' });
  });
});

describe('Tailscale-status', () => {
  it('meldt dat Tailscale niet is geïnstalleerd', async () => {
    const status = await tailscaleStatus(async () => { throw new Error('not found'); });
    expect(status.installed).toBe(false);
  });

  it('onderscheidt niet verbonden en actieve Serve', async () => {
    const disconnected = await tailscaleStatus(async (_file, args) => args[0] === 'where.exe' ? { stdout: 'tailscale.exe' } : args[0] === 'status' ? { stdout: JSON.stringify({ BackendState: 'NeedsLogin', Self: { Online: false } }) } : { stdout: '{}' });
    expect(disconnected.connected).toBe(false);
    const active = await tailscaleStatus(async (_file, args) => args[0] === 'where.exe' ? { stdout: 'tailscale.exe' } : args[0] === 'status' ? { stdout: JSON.stringify({ BackendState: 'Running', Self: { Online: true, DNSName: 'pc.tailnet.ts.net.' }, Peer: { one: { Active: true, CurAddr: '100.1.1.1:123' } } }) } : { stdout: JSON.stringify({ Web: { 'pc.tailnet.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8787' } } } } }) });
    expect(active).toMatchObject({ installed: true, connected: true, serveActive: true, connection: 'direct', httpsUrl: 'https://pc.tailnet.ts.net' });
  });
});

describe('updates', () => {
  it('vergelijkt versies en verwerkt offline updatecontrole', async () => {
    expect(updates.updateInternals.compareVersions('1.2.0', '1.1.0')).toBe(1);
    database.setSetting('updateManifestUrl', 'https://updates.example/latest.json');
    const result = await updates.checkForUpdates(async () => { throw new Error('offline'); });
    expect(result.offline).toBe(true);
  });

  it('weigert een update met een foutieve SHA-256-hash', async () => {
    await expect(updates.downloadUpdate({ version: '1.2.0', channel: 'stable', assetName: 'ThuisHub-Setup-1.2.0.exe', downloadUrl: 'https://github.com/kratje050/thuishub/releases/download/v1.2.0/ThuisHub-Setup-1.2.0.exe', sha256: '0'.repeat(64), releaseNotes: 'test' }, async () => new Response('bestand', { status: 200 }))).rejects.toThrow('integriteitscontrole');
  });
});
