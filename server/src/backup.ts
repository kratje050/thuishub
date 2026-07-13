import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { APP_NAME, APP_VERSION } from './constants.js';
import { db, getSetting, setSetting } from './db.js';
import { log } from './logger.js';
import { appPaths } from './paths.js';

export type BackupReason = 'manual' | 'daily' | 'weekly' | 'emergency';

function backupDirectory() {
  const configured = getSetting('backupLocation', appPaths.backupsDir).trim();
  const directory = path.resolve(configured || appPaths.backupsDir);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function backupName(date = new Date()) {
  const stamp = date.toISOString().replace('T', '-').replace(/[:]/g, '').replace(/\.\d{3}Z$/, '');
  return `${APP_NAME}-backup-${stamp}.zip`;
}

function inspectDatabase(file: string) {
  const database = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const details = (database.pragma('integrity_check') as { integrity_check: string }[]).map(row => row.integrity_check);
    return { ok: details.every(value => value === 'ok'), details };
  } finally {
    database.close();
  }
}

export async function createBackup(reason: BackupReason = 'manual') {
  const directory = backupDirectory();
  const name = backupName();
  const output = path.join(directory, name);
  const snapshot = path.join(appPaths.appRoot, `.backup-snapshot-${process.pid}-${Date.now()}.db`);
  try {
    await db.backup(snapshot);
    const integrity = inspectDatabase(snapshot);
    if (!integrity.ok) throw new Error('De database-snapshot is niet door de integriteitscontrole gekomen.');
    const zip = new AdmZip();
    zip.addLocalFile(snapshot, 'data', 'thuishub.db');
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ app: APP_NAME, version: APP_VERSION, createdAt: new Date().toISOString(), reason, mediaFilesIncluded: false }, null, 2)));
    if (fs.existsSync(appPaths.migrationMarker)) zip.addLocalFile(appPaths.migrationMarker, 'metadata', 'data-migration.json');
    zip.writeZip(output);
    setSetting('lastBackupAt', new Date().toISOString());
    setSetting('lastBackupFile', output);
    pruneBackups();
    log('INFO', 'backups', 'Back-up succesvol gemaakt.', { reason, file: output, bytes: fs.statSync(output).size });
    return backupInfo(output);
  } catch (error) {
    log('ERROR', 'backups', 'Back-up maken mislukt.', { reason, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    fs.rmSync(snapshot, { force: true });
  }
}

function backupInfo(file: string) {
  const stat = fs.statSync(file);
  return { name: path.basename(file), path: file, bytes: stat.size, createdAt: stat.mtime.toISOString() };
}

export function listBackups() {
  const directory = backupDirectory();
  return fs.readdirSync(directory).filter(name => /^ThuisHub-backup-.*\.zip$/i.test(name)).map(name => backupInfo(path.join(directory, name))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resolveBackup(name: string) {
  const safeName = path.basename(name);
  const file = path.join(backupDirectory(), safeName);
  if (safeName !== name || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw Object.assign(new Error('Back-up niet gevonden.'), { status: 404 });
  return file;
}

export function verifyBackup(fileOrName: string) {
  const file = path.isAbsolute(fileOrName) ? fileOrName : resolveBackup(fileOrName);
  const zip = new AdmZip(file);
  const manifestEntry = zip.getEntry('manifest.json');
  const databaseEntry = zip.getEntry('data/thuishub.db');
  if (!manifestEntry || !databaseEntry) return { ok: false, error: 'Manifest of database ontbreekt.' };
  const temporary = path.join(appPaths.appRoot, `.verify-${process.pid}-${Date.now()}.db`);
  try {
    fs.writeFileSync(temporary, databaseEntry.getData());
    const integrity = inspectDatabase(temporary);
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    return { ok: integrity.ok && manifest.app === APP_NAME, integrity, manifest };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export async function scheduleRestore(name: string) {
  const file = resolveBackup(name);
  const verification = verifyBackup(file);
  if (!verification.ok) throw Object.assign(new Error('Deze back-up is beschadigd en kan niet worden teruggezet.'), { status: 400 });
  await createBackup('emergency');
  const zip = new AdmZip(file);
  const pending = path.join(appPaths.appRoot, `.restore-${Date.now()}.db`);
  fs.writeFileSync(pending, zip.getEntry('data/thuishub.db')!.getData());
  fs.writeFileSync(appPaths.pendingRestoreMarker, JSON.stringify({ databaseFile: pending, sourceBackup: file, requestedAt: new Date().toISOString() }, null, 2));
  log('WARNING', 'database', 'Databaseherstel gepland; wordt toegepast bij de volgende start.', { backup: file });
  return { restartRequired: true, message: 'De back-up is gecontroleerd. Herstart ThuisHub om het herstel veilig toe te passen.' };
}

export async function exportDatabase() {
  fs.mkdirSync(appPaths.exportsDir, { recursive: true });
  const file = path.join(appPaths.exportsDir, `ThuisHub-database-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await db.backup(file);
  return file;
}

export function pruneBackups() {
  const retention = Math.min(100, Math.max(1, Number(getSetting('backupRetention', '14')) || 14));
  for (const backup of listBackups().slice(retention)) fs.rmSync(backup.path, { force: true });
}

let scheduler: NodeJS.Timeout | null = null;
export function startBackupScheduler() {
  if (scheduler) return;
  const check = async () => {
    const mode = getSetting('automaticBackups', 'daily');
    if (mode === 'off') return;
    const last = Date.parse(getSetting('lastBackupAt', '1970-01-01')) || 0;
    const interval = mode === 'weekly' ? 7 * 86400000 : 86400000;
    if (Date.now() - last >= interval) await createBackup(mode as 'daily' | 'weekly').catch(() => {});
  };
  void check();
  scheduler = setInterval(() => void check(), 60 * 60 * 1000);
  scheduler.unref();
}

export const backupInternals = { backupName, inspectDatabase };

