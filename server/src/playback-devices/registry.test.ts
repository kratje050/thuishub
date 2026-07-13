import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-registry-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
const database = await import('../db.js');
const { deduplicateDevices, onlineStateFor, physicalKeyFor, playbackDeviceRegistry } = await import('./registry.js');
afterAll(() => { database.db.close(); fs.rmSync(root, { recursive: true, force: true }); });

const capabilities = { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30, maxBitrateMbps: 12, containers: ['mp4'], videoCodecs: ['h264'], maxBitDepth: 8, hdrFormats: ['sdr'] as const, dolbyVisionProfiles: [], audioCodecs: ['aac'], maxAudioChannels: 2, passthrough: false, atmos: false, trueHd: false, eac3: false, dts: false, subtitleFormats: ['none'] as const };

describe('PlaybackDeviceRegistry', () => {
  it('gebruikt stabiele identiteit en bewaart een gevonden renderer', () => {
    const first = playbackDeviceRegistry.upsertDiscovered({ name: 'Woonkamer', protocol: 'dlna-upnp', protocolId: 'uuid:tv-1', udn: 'uuid:tv-1', deviceType: 'television', manufacturer: 'Samsung', model: 'QLED', address: '192.168.1.20', port: 1400, capabilities, icon: 'tv', requiresPairing: false });
    const second = playbackDeviceRegistry.upsertDiscovered({ name: 'Woonkamer hernoemd', protocol: 'dlna-upnp', protocolId: 'uuid:tv-1', udn: 'uuid:tv-1', deviceType: 'television', manufacturer: 'Samsung', model: 'QLED', address: '192.168.1.20', port: 1400, capabilities, icon: 'tv', requiresPairing: false });
    expect(first?.id).toBe(second?.id);
    expect(second).toMatchObject({ name: 'Woonkamer hernoemd', online: true, protocol: 'dlna-upnp' });
  });

  it('kiest bij duplicaten de eigen app boven Cast en DLNA', () => {
    const key = physicalKeyFor({ address: '192.168.1.30', manufacturer: 'Sony', model: 'TV' });
    const base = { id: '', name: 'TV', deviceType: 'television' as const, manufacturer: 'Sony', model: 'TV', online: true, onlineState: 'online' as const, capabilities, icon: 'tv' as const, requiresPairing: false, paired: false, trusted: false, physicalKey: key };
    const selected = deduplicateDevices([
      { ...base, id: 'dlna:12345678', protocol: 'dlna-upnp' },
      { ...base, id: 'cast:12345678', protocol: 'google-cast', icon: 'cast' },
      { ...base, id: 'app:12345678', protocol: 'thuishub-tv-app', paired: true, trusted: true },
    ]);
    expect(selected).toHaveLength(1);
    expect(selected[0].protocol).toBe('thuishub-tv-app');
  });

  it('herkent protocolspecifieke IDs op hetzelfde lokale tv-adres als één apparaat', () => {
    const base = { name: 'Woonkamer', deviceType: 'television' as const, manufacturer: 'Samsung', model: 'QLED', address: '192.168.1.44', online: true, onlineState: 'online' as const, capabilities, icon: 'tv' as const, requiresPairing: false, paired: false, trusted: false };
    const selected = deduplicateDevices([
      { ...base, id: 'dlna:12345678', protocol: 'dlna-upnp', protocolId: 'uuid:renderer-one', physicalKey: physicalKeyFor({ protocol: 'dlna-upnp', protocolId: 'uuid:renderer-one' }) },
      { ...base, id: 'app:12345678', protocol: 'thuishub-tv-app', protocolId: 'thuishub-player-one', physicalKey: physicalKeyFor({ protocol: 'thuishub-tv-app', protocolId: 'thuishub-player-one' }), paired: true, trusted: true },
    ]);
    expect(selected).toHaveLength(1);
    expect(selected[0].protocol).toBe('thuishub-tv-app');
  });

  it('voegt twee identieke modellen op verschillende adressen niet samen', () => {
    const base = { name: 'TV', deviceType: 'television' as const, manufacturer: 'Samsung', model: 'QLED', online: true, onlineState: 'online' as const, capabilities, icon: 'tv' as const, requiresPairing: false, paired: false, trusted: false, protocol: 'dlna-upnp' as const };
    const selected = deduplicateDevices([
      { ...base, id: 'dlna:11111111', address: '192.168.1.41' },
      { ...base, id: 'dlna:22222222', address: '192.168.1.42' },
    ]);
    expect(selected).toHaveLength(2);
  });

  it('wordt niet na één gemiste scan direct offline', () => {
    expect(onlineStateFor(new Date(Date.now() - 2 * 60_000).toISOString())).toBe('possibly-offline');
    expect(onlineStateFor(new Date(Date.now() - 11 * 60_000).toISOString())).toBe('offline');
  });

  it('behandelt SQLite CURRENT_TIMESTAMP als UTC bij de onlineberekening', () => {
    const now = Date.UTC(2026, 6, 13, 20, 1, 0);
    expect(onlineStateFor('2026-07-13 20:00:00', now)).toBe('online');
    expect(onlineStateFor('ongeldige tijd', now)).toBe('offline');
  });

  it('geeft een profielgebonden apparaat alleen aan de gekoppelde gebruiker terug', () => {
    const firstUser = Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES('tv-eigenaar','test','user')").run().lastInsertRowid);
    const secondUser = Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES('tv-andere-gebruiker','test','user')").run().lastInsertRowid);
    const device = playbackDeviceRegistry.upsertDiscovered({
      name: 'Privé-tv', protocol: 'thuishub-tv-app', protocolId: 'private-tv-1', deviceType: 'television',
      manufacturer: 'ThuisHub', model: 'TV-app', address: '192.168.1.60', capabilities, icon: 'tv',
      requiresPairing: true, trusted: true,
    });
    database.db.prepare('UPDATE playback_devices SET user_id=? WHERE id=?').run(firstUser, device!.id);

    expect(playbackDeviceRegistry.getForUser(device!.id, firstUser)?.id).toBe(device!.id);
    expect(playbackDeviceRegistry.getForUser(device!.id, secondUser)).toBeNull();
  });

  it('toont een nog ongekoppelde lokale tv-app in de kiezer maar laat hem nog niet afspelen', () => {
    const userId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES('tv-koppelaar','test','user')").run().lastInsertRowid);
    const device = playbackDeviceRegistry.upsertDiscovered({
      name: 'Nieuwe tv-app', protocol: 'thuishub-tv-app', protocolId: 'pairing-tv-unique', deviceType: 'television',
      manufacturer: 'ThuisHub', model: 'TV-app', address: '192.168.1.77', capabilities, icon: 'tv',
      requiresPairing: true, trusted: false,
    });
    expect(playbackDeviceRegistry.list(userId).some(entry => entry.id === device!.id && entry.requiresPairing && !entry.trusted)).toBe(true);
    expect(playbackDeviceRegistry.getForUser(device!.id, userId)).toBeNull();
  });
});
