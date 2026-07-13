import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyTrustedDeviceOwners } from './device-owner-migration.js';

let databases: Database.Database[] = [];
function setup() {
  const database = new Database(':memory:');
  databases.push(database);
  database.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT NOT NULL);
    CREATE TABLE playback_devices(id TEXT PRIMARY KEY,trusted INTEGER NOT NULL,user_id INTEGER,requires_pairing INTEGER NOT NULL);`);
  return database;
}
afterEach(() => { for (const database of databases) database.close(); databases = []; });

describe('migratie van oude apparaateigenaren', () => {
  it('wijst een oude vertrouwde TV-app toe aan de enige beheerder', () => {
    const database = setup();
    database.exec(`INSERT INTO users VALUES(1,'admin'); INSERT INTO users VALUES(2,'user');
      INSERT INTO playback_devices VALUES('oude-tv',1,NULL,1);
      INSERT INTO playback_devices VALUES('globale-dlna',1,NULL,0);`);
    expect(migrateLegacyTrustedDeviceOwners(database as any)).toEqual({ ownerId: 1, assigned: 1 });
    expect(database.prepare('SELECT user_id userId FROM playback_devices WHERE id=?').get('oude-tv')).toEqual({ userId: 1 });
    expect(database.prepare('SELECT user_id userId FROM playback_devices WHERE id=?').get('globale-dlna')).toEqual({ userId: null });
  });

  it('laat records ongemoeid wanneer meerdere beheerders de eigenaar ambigu maken', () => {
    const database = setup();
    database.exec(`INSERT INTO users VALUES(1,'admin'); INSERT INTO users VALUES(2,'admin');
      INSERT INTO playback_devices VALUES('oude-tv',1,NULL,1);`);
    expect(migrateLegacyTrustedDeviceOwners(database as any)).toEqual({ ownerId: null, assigned: 0 });
    expect(database.prepare('SELECT user_id userId FROM playback_devices WHERE id=?').get('oude-tv')).toEqual({ userId: null });
  });
});
