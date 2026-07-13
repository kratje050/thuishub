import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyData, pathInternals, resolveAppPaths } from './paths.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-migration-')); roots.push(root); return root; };

describe('Huiskamer-gegevensmigratie', () => {
  it('start veilig zonder bestaande gegevens en voert de controle maar eenmaal uit', () => {
    const appData = temp();
    const paths = resolveAppPaths({ APPDATA: appData, THUIS_HUB_ROOT_DIR: path.join(appData, 'ThuisHub'), THUIS_HUB_DATA_DIR: path.join(appData, 'ThuisHub', 'data') });
    expect(migrateLegacyData(paths).status).toBe('no-source');
    expect(migrateLegacyData(paths).status).toBe('already-completed');
    expect(fs.existsSync(paths.migrationMarker)).toBe(true);
  });

  it('kopieert bestaande gegevens, controleert SQLite en behoudt het origineel', () => {
    const appData = temp();
    const paths = resolveAppPaths({ APPDATA: appData, THUIS_HUB_ROOT_DIR: path.join(appData, 'ThuisHub'), THUIS_HUB_DATA_DIR: path.join(appData, 'ThuisHub', 'data') });
    fs.mkdirSync(paths.legacyDataDir, { recursive: true });
    const legacy = path.join(paths.legacyDataDir, 'huiskamer.db');
    const database = new Database(legacy);
    database.exec('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES (\'serverName\', \'Bestaande bibliotheek\')');
    database.close();
    fs.writeFileSync(path.join(paths.legacyDataDir, 'profiel.json'), '{"bewaard":true}');

    const result = migrateLegacyData(paths);
    expect(result.status).toBe('completed');
    expect(fs.existsSync(legacy)).toBe(true);
    expect(pathInternals.quickCheck(paths.databaseFile)).toBe(true);
    expect(fs.existsSync(path.join(paths.dataDir, 'profiel.json'))).toBe(true);
    expect(fs.readdirSync(paths.backupsDir).some(name => name.startsWith('Huiskamer-voor-migratie-'))).toBe(true);
  });
});
