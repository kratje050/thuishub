import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-devices-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');
fs.writeFileSync(path.join(root, '.migration-from-huiskamer.json'), '{}');

const database = await import('./db.js');
const devices = await import('./devices.js');
const { BROWSER_CAPABILITIES } = await import('./playback.js');
const ownerId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES('device-owner','test','admin')").run().lastInsertRowid);

function insertDevice(id: string, userId: number | null) {
  database.db.prepare(`INSERT INTO playback_devices(id,name,platform,capabilities,trusted,user_id,requires_pairing)
    VALUES(?,'Oude tv','android-tv','{}',1,?,1)`).run(id, userId);
}

afterAll(() => { database.db.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('opnieuw koppelen van apparaten', () => {
  it('laat een verweesd oud TV-record gecontroleerd opnieuw koppelen en trekt oude tokens in', () => {
    insertDevice('orphan-tv-01', null);
    database.db.prepare(`INSERT INTO device_sessions(token_hash,device_id,expires_at) VALUES('oud-token','orphan-tv-01',9999999999)`).run();
    const result = devices.requestPairing({ id: 'orphan-tv-01', name: 'Oude tv', platform: 'android-tv', capabilities: BROWSER_CAPABILITIES });
    expect(result).toMatchObject({ deviceId: 'orphan-tv-01', expiresInSeconds: 600 });
    expect(result.code).toMatch(/^\d{6}$/);
    expect(database.db.prepare('SELECT trusted,user_id userId FROM playback_devices WHERE id=?').get('orphan-tv-01')).toEqual({ trusted: 0, userId: null });
    expect(database.db.prepare('SELECT COUNT(*) count FROM device_sessions WHERE device_id=?').get('orphan-tv-01')).toEqual({ count: 0 });
  });

  it('weigert opnieuw koppelen wanneer het apparaat al een eigenaar heeft', () => {
    insertDevice('owned-tv-001', ownerId);
    expect(() => devices.requestPairing({ id: 'owned-tv-001', name: 'Mijn tv', platform: 'android-tv', capabilities: BROWSER_CAPABILITIES }))
      .toThrow('al gekoppeld');
  });

  it('normaliseert onbetrouwbare capabilities naar een begrensd bekend profiel', () => {
    const oversized = Array.from({ length: 200 }, (_, index) => ` CODEC-${index} `);
    const result = devices.requestPairing({
      id: 'bounded-tv-001', name: 'Begrensde tv', platform: 'android-tv',
      capabilities: {
        maxWidth: Number.MAX_VALUE, maxHeight: -10, maxFrameRate: 9_999, maxBitrateMbps: Infinity,
        containers: oversized, videoCodecs: [' H264 ', 'H264', '<script>'], maxBitDepth: 100,
        hdrFormats: ['HDR10', 'onbekend'], dolbyVisionProfiles: [5, 5, 999, '7'],
        audioCodecs: [' AAC ', { nested: true }], maxAudioChannels: 999, passthrough: 'ja', atmos: true,
        trueHd: false, eac3: true, dts: false, subtitleFormats: ['WEBVTT', 'html'], arc: 'invalid',
        videoProfiles: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`codec-${index}`, oversized])),
        videoLevels: { h264: 9_999, bad: 'hoog' }, unknownNested: { payload: 'x'.repeat(100_000) },
      } as any,
    });
    const stored = database.db.prepare('SELECT capabilities FROM playback_devices WHERE id=?').get(result.deviceId) as { capabilities: string };
    const capabilities = JSON.parse(stored.capabilities);

    expect(capabilities).toMatchObject({
      maxWidth: 16_384, maxHeight: 240, maxFrameRate: 240, maxBitrateMbps: 12,
      videoCodecs: ['h264'], maxBitDepth: 16, hdrFormats: ['hdr10'], dolbyVisionProfiles: [5],
      audioCodecs: ['aac'], maxAudioChannels: 32, passthrough: false, atmos: true, eac3: true,
      subtitleFormats: ['webvtt'], arc: 'unknown', videoLevels: { h264: 1_000 },
    });
    expect(capabilities.containers).toHaveLength(32);
    expect(Object.keys(capabilities.videoProfiles)).toHaveLength(16);
    expect(capabilities).not.toHaveProperty('unknownNested');
    expect(stored.capabilities.length).toBeLessThan(10_000);
  });

  it('begrenst alle pairing-identiteitsvelden voordat sleutels en rijen worden gemaakt', () => {
    const huge = 'X'.repeat(900_000);
    const result = devices.requestPairing({
      id: 'identity-tv-001',
      name: `  Woonkamer\u0000${huge}`,
      manufacturer: huge,
      model: huge,
      platform: `ANDROID-TV\u0007${huge}`,
      appVersion: huge,
      protocolId: `native:${huge}`,
      address: huge,
      capabilities: BROWSER_CAPABILITIES,
    });
    const stored = database.db.prepare(`SELECT name,manufacturer,model,platform,app_version appVersion,protocol_id protocolId,address,physical_key physicalKey
      FROM playback_devices WHERE id=?`).get(result.deviceId) as Record<string, string>;
    expect(stored.name).toHaveLength(100);
    expect(stored.manufacturer).toHaveLength(100);
    expect(stored.model).toHaveLength(100);
    expect(stored.platform).toHaveLength(50);
    expect(stored.platform).toBe(stored.platform.toLowerCase());
    expect(stored.appVersion).toHaveLength(30);
    expect(stored.protocolId).toHaveLength(200);
    expect(stored.address).toHaveLength(64);
    expect(stored.physicalKey.length).toBeLessThan(300);
    expect(Object.values(stored).join('').length).toBeLessThan(1_000);
  });

  it('ruimt verlopen ongeclaimde codes op en draait een niet-geclaimde goedkeuring terug', () => {
    const pairing = devices.requestPairing({ id: 'expired-tv-01', name: 'Verlopen tv', platform: 'tizen', capabilities: BROWSER_CAPABILITIES });
    expect(devices.approvePairing(pairing.code, ownerId)).toBe(true);
    database.db.prepare('UPDATE device_pairing_codes SET expires_at=1 WHERE device_id=?').run(pairing.deviceId);

    expect(devices.deviceInternals.cleanupExpiredPairings()).toMatchObject({ reset: 1, removed: 1 });
    expect(database.db.prepare('SELECT trusted,user_id userId FROM playback_devices WHERE id=?').get(pairing.deviceId)).toEqual({ trusted: 0, userId: null });
    expect(database.db.prepare('SELECT COUNT(*) count FROM device_pairing_codes WHERE device_id=?').get(pairing.deviceId)).toEqual({ count: 0 });
  });
});
