import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_VERSION } from './constants.js';

export type AppPaths = ReturnType<typeof resolveAppPaths>;

export function resolveAppPaths(env: NodeJS.ProcessEnv = process.env) {
  const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const dataDir = path.resolve(env.THUIS_HUB_DATA_DIR || env.HUISKAMER_DATA_DIR || 'data');
  const appRoot = env.THUIS_HUB_ROOT_DIR
    ? path.resolve(env.THUIS_HUB_ROOT_DIR)
    : path.basename(dataDir).toLowerCase() === 'data' ? path.dirname(dataDir) : path.join(appData, 'ThuisHub');
  return {
    appRoot,
    dataDir,
    databaseFile: path.join(dataDir, 'thuishub.db'),
    legacyDatabaseInTarget: path.join(dataDir, 'huiskamer.db'),
    logsDir: path.resolve(env.THUIS_HUB_LOG_DIR || path.join(appRoot, 'logs')),
    backupsDir: path.resolve(env.THUIS_HUB_BACKUP_DIR || path.join(appRoot, 'backups')),
    exportsDir: path.join(appRoot, 'exports'),
    updatesDir: path.join(localAppData, 'ThuisHub', 'updates'),
    migrationMarker: path.join(appRoot, '.migration-from-huiskamer.json'),
    pendingRestoreMarker: path.join(appRoot, '.restore-pending.json'),
    legacyRoot: path.join(appData, 'Huiskamer'),
    legacyDataDir: path.join(appData, 'Huiskamer', 'data'),
  };
}

export const appPaths = resolveAppPaths();

function appendMigrationLog(paths: AppPaths, message: string, details: Record<string, unknown> = {}) {
  fs.mkdirSync(paths.logsDir, { recursive: true });
  fs.appendFileSync(path.join(paths.logsDir, 'migration.log'), `${JSON.stringify({ timestamp: new Date().toISOString(), level: 'INFO', category: 'migration', message, details })}\n`);
}

function quickCheck(databaseFile: string) {
  const database = new Database(databaseFile, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma('quick_check') as { quick_check: string }[];
    return result.every(row => row.quick_check === 'ok');
  } finally {
    database.close();
  }
}

function safeDatabaseSnapshot(source: string, destination: string) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(destination, { force: true });
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
}

export function migrateLegacyData(paths: AppPaths = appPaths) {
  fs.mkdirSync(paths.appRoot, { recursive: true });
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.backupsDir, { recursive: true });

  if (fs.existsSync(paths.migrationMarker)) return { status: 'already-completed' as const };
  if (fs.existsSync(paths.databaseFile)) {
    fs.writeFileSync(paths.migrationMarker, JSON.stringify({ version: APP_VERSION, status: 'existing-target', completedAt: new Date().toISOString() }, null, 2));
    return { status: 'existing-target' as const };
  }

  const sourceDatabase = fs.existsSync(path.join(paths.legacyDataDir, 'huiskamer.db'))
    ? path.join(paths.legacyDataDir, 'huiskamer.db')
    : fs.existsSync(paths.legacyDatabaseInTarget) ? paths.legacyDatabaseInTarget : '';
  if (!sourceDatabase) {
    appendMigrationLog(paths, 'Geen bestaande Huiskamer-gegevens gevonden; een nieuwe ThuisHub-database wordt gemaakt.');
    fs.writeFileSync(paths.migrationMarker, JSON.stringify({ version: APP_VERSION, status: 'no-source', completedAt: new Date().toISOString() }, null, 2));
    return { status: 'no-source' as const };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sourceBackup = path.join(paths.backupsDir, `Huiskamer-voor-migratie-${stamp}.db`);
  try {
    appendMigrationLog(paths, 'Migratie van Huiskamer naar ThuisHub gestart.', { source: paths.legacyDataDir, destination: paths.dataDir });
    safeDatabaseSnapshot(sourceDatabase, sourceBackup);
    if (!quickCheck(sourceBackup)) throw new Error('De veiligheidskopie van de oude database is niet leesbaar.');

    if (path.resolve(paths.legacyDataDir) !== path.resolve(paths.dataDir) && fs.existsSync(paths.legacyDataDir)) {
      fs.cpSync(paths.legacyDataDir, paths.dataDir, {
        recursive: true,
        force: false,
        filter: source => !['huiskamer.pid', 'server.log', 'server-error.log'].includes(path.basename(source)),
      });
    }
    fs.copyFileSync(sourceBackup, paths.databaseFile);
    if (!quickCheck(paths.databaseFile)) throw new Error('De gemigreerde database heeft de integriteitscontrole niet doorstaan.');

    const marker = { version: APP_VERSION, status: 'completed', completedAt: new Date().toISOString(), source: paths.legacyDataDir, backup: sourceBackup };
    fs.writeFileSync(paths.migrationMarker, JSON.stringify(marker, null, 2));
    appendMigrationLog(paths, 'Migratie voltooid en database gecontroleerd.', marker);
    return { status: 'completed' as const, backup: sourceBackup };
  } catch (error) {
    fs.rmSync(paths.databaseFile, { force: true });
    appendMigrationLog(paths, 'Migratie gestopt; oude gegevens zijn ongewijzigd gebleven.', { error: error instanceof Error ? error.message : String(error) });
    throw new Error('De bestaande gegevens konden niet veilig worden gemigreerd. De oude Huiskamer-map is niet gewijzigd.');
  }
}

export function applyPendingRestore(paths: AppPaths = appPaths) {
  if (!fs.existsSync(paths.pendingRestoreMarker)) return false;
  const marker = JSON.parse(fs.readFileSync(paths.pendingRestoreMarker, 'utf8')) as { databaseFile: string; requestedAt: string };
  const pending = path.resolve(marker.databaseFile);
  if (!pending.startsWith(path.resolve(paths.appRoot) + path.sep) || !fs.existsSync(pending) || !quickCheck(pending)) {
    appendMigrationLog(paths, 'Geplande databaseherstelactie geweigerd: het herstelbestand is ongeldig.');
    fs.rmSync(paths.pendingRestoreMarker, { force: true });
    return false;
  }
  if (fs.existsSync(paths.databaseFile)) {
    const emergency = path.join(paths.backupsDir, `ThuisHub-noodkopie-voor-herstel-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    safeDatabaseSnapshot(paths.databaseFile, emergency);
  }
  fs.copyFileSync(pending, paths.databaseFile);
  fs.rmSync(pending, { force: true });
  fs.rmSync(paths.pendingRestoreMarker, { force: true });
  appendMigrationLog(paths, 'Geplande databaseherstelactie succesvol toegepast.', { requestedAt: marker.requestedAt });
  return true;
}

export const pathInternals = { quickCheck, safeDatabaseSnapshot };
