import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-playback-sessions-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');
fs.writeFileSync(path.join(root, '.migration-from-huiskamer.json'), '{}');

const database = await import('../db.js');
const sessions = await import('./sessions.js');
const tokens = await import('../playback-tokens.js');

const userId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES('session-test','test','admin')").run().lastInsertRowid);
const otherUserId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES('session-test-other','test','viewer')").run().lastInsertRowid);
const sourceId = Number(database.db.prepare("INSERT INTO sources(name,path,kind) VALUES('Sessietest','C:/Sessietest','movies')").run().lastInsertRowid);
const mediaId = Number(database.db.prepare(`INSERT INTO media_items(source_id,kind,title,sort_title,file_path,duration)
  VALUES(?,'movie','Sessiefilm','Sessiefilm','C:/Sessietest/film.mp4',100)`).run(sourceId).lastInsertRowid);

function create(state: 'connecting' | 'playing' | 'paused' = 'playing') {
  return sessions.createPlaybackSession({ userId, mediaId, deviceId: 'tv-woonkamer', protocol: 'thuishub-tv-app', state, startPosition: 10, duration: 100 });
}

beforeEach(() => {
  database.db.exec('DELETE FROM playback_grants; DELETE FROM playback_sessions; DELETE FROM progress;');
});

afterEach(() => vi.useRealTimers());
afterAll(() => { database.db.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('server-side afspeelsessies', () => {
  it('beschermt updates met een oplopende revision', () => {
    const original = create();
    const updated = sessions.updatePlaybackSession({ id: original.id, revision: original.revision, position: 25, duration: 100, state: 'paused' });
    expect(updated).toMatchObject({ revision: 1, position: 25, state: 'paused' });
    try {
      sessions.updatePlaybackSession({ id: original.id, revision: original.revision, position: 5 });
      throw new Error('Een verouderde revision werd ten onrechte geaccepteerd.');
    } catch (error: any) {
      expect(error.code).toBe('STALE_PLAYBACK_SESSION');
      expect(error.status).toBe(409);
    }
    expect(sessions.getPlaybackSession(original.id)?.position).toBe(25);
  });

  it('finaliseert voortgang en trekt alle grants in bij stoppen', () => {
    const session = create();
    const token = tokens.createPlaybackGrant({ sessionId: session.id, resource: 'file' }, 300);
    expect(tokens.verifyPlaybackToken(token, mediaId, 'file', session.id)).toMatchObject({ sessionId: session.id });
    const stopped = sessions.stopPlaybackSession({ id: session.id, revision: session.revision, position: 95, duration: 100, reason: 'receiver-stopped' });
    expect(stopped).toMatchObject({ state: 'stopped', endReason: 'receiver-stopped', revision: 1 });
    expect(stopped.endedAt).toBeTruthy();
    expect(tokens.verifyPlaybackToken(token, mediaId, 'file', session.id)).toBeNull();
    expect(database.db.prepare('SELECT position,duration,completed FROM progress WHERE user_id=? AND media_id=?').get(userId, mediaId)).toMatchObject({ position: 95, duration: 100, completed: 1 });
    expect(sessions.getActivePlaybackSession(userId)).toBeNull();
  });

  it('bindt een grant aan precies een sessie, media-item en resource', () => {
    const session = create();
    const token = tokens.createPlaybackGrant({ sessionId: session.id, resource: 'hls', options: { copyVideo: true } });
    expect(tokens.verifyPlaybackToken(token, mediaId, 'hls', session.id)).toMatchObject({ mediaId, resource: 'hls', sessionId: session.id });
    expect(tokens.verifyPlaybackToken(token, mediaId, 'file', session.id)).toBeNull();
    expect(tokens.verifyPlaybackToken(token, mediaId + 1, 'hls', session.id)).toBeNull();
    expect(tokens.verifyPlaybackToken(token, mediaId, 'hls', crypto.randomUUID())).toBeNull();
  });

  it('vernieuwt een actieve grant en trekt de vorige onmiddellijk in', () => {
    const session = create();
    const original = tokens.createPlaybackGrant({ sessionId: session.id, resource: 'file' });
    const renewed = tokens.renewPlaybackGrant(original, session.id, userId, 300);
    expect(renewed).not.toBe(original);
    expect(tokens.verifyPlaybackToken(original, mediaId, 'file', session.id)).toBeNull();
    expect(tokens.verifyPlaybackToken(renewed, mediaId, 'file', session.id)).toMatchObject({ sessionId: session.id });
    expect(database.db.prepare('SELECT COUNT(*) count FROM playback_grants WHERE session_id=? AND revoked_at IS NOT NULL').get(session.id)).toMatchObject({ count: 1 });
  });

  it('kan één grant expliciet en idempotent intrekken', () => {
    const session = create();
    const token = tokens.createPlaybackGrant({ sessionId: session.id, resource: 'subtitle' });
    expect(tokens.revokePlaybackGrant(token)).toBe(true);
    expect(tokens.revokePlaybackGrant(token)).toBe(false);
    expect(tokens.verifyPlaybackToken(token, mediaId, 'subtitle', session.id)).toBeNull();
  });

  it('weigert een verlopen grant', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T20:00:00Z'));
    const session = create();
    const token = tokens.createPlaybackGrant({ sessionId: session.id, resource: 'file' }, 30);
    vi.setSystemTime(new Date('2026-07-13T20:00:31Z'));
    expect(tokens.verifyPlaybackToken(token, mediaId, 'file', session.id)).toBeNull();
    expect(() => tokens.renewPlaybackGrant(token, session.id, userId)).toThrow('ongeldig, verlopen of ingetrokken');
  });

  it('weigert vernieuwing namens een andere sessie of gebruiker', () => {
    const session = create();
    const token = tokens.createPlaybackGrant({ sessionId: session.id, resource: 'file' });
    const otherSessionForUser = sessions.createPlaybackSession({
      userId, mediaId, deviceId: 'tv-andere-kamer', protocol: 'thuishub-tv-app', state: 'connecting',
      handoffFromSessionId: session.id,
    });
    const otherUsersSession = sessions.createPlaybackSession({
      userId: otherUserId, mediaId, deviceId: 'tv-andere-gebruiker', protocol: 'thuishub-tv-app', state: 'playing',
    });

    expect(() => tokens.renewPlaybackGrant(token, otherSessionForUser.id, userId)).toThrow('ongeldig, verlopen of ingetrokken');
    expect(() => tokens.renewPlaybackGrant(token, session.id, userId + 1)).toThrow('ongeldig, verlopen of ingetrokken');
    expect(() => tokens.renewPlaybackGrant(token, otherUsersSession.id, otherUserId)).toThrow('ongeldig, verlopen of ingetrokken');
    expect(tokens.verifyPlaybackToken(token, mediaId, 'file', session.id)).not.toBeNull();
  });

  it('verlengt een gebruikte sessiegrant glijdend en trekt hem bij stoppen direct in', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T21:00:00Z'));
    const session = create();
    const token = tokens.createPlaybackGrant({ sessionId: session.id, resource: 'file' }, 30);
    expect(tokens.verifyPlaybackToken(token, mediaId, 'file', session.id)).not.toBeNull();
    vi.setSystemTime(new Date('2026-07-13T21:00:31Z'));
    expect(tokens.verifyPlaybackToken(token, mediaId, 'file', session.id)).not.toBeNull();
    sessions.stopPlaybackSession({ id: session.id, userId, reason: 'disconnect' });
    expect(tokens.verifyPlaybackToken(token, mediaId, 'file', session.id)).toBeNull();
  });

  it('maakt per gebruiker maar één actieve sessie en beëindigt de vorige veilig', () => {
    const first = create();
    const firstToken = tokens.createPlaybackGrant({ sessionId: first.id, resource: 'file' });
    const second = sessions.createPlaybackSession({ userId, mediaId, deviceId: first.deviceId, protocol: first.protocol, state: 'paused', startPosition: 30, duration: 100 });
    expect(sessions.getPlaybackSession(first.id)).toMatchObject({ state: 'stopped', endReason: 'superseded' });
    expect(tokens.verifyPlaybackToken(firstToken, mediaId, 'file', first.id)).toBeNull();
    expect(sessions.getActivePlaybackSession(userId)?.id).toBe(second.id);
  });

  it('houdt bij een apparaatwissel de bron en grants actief totdat de bestemming bevestigt', () => {
    const source = create();
    const sourceToken = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = sessions.createPlaybackSession({
      userId, mediaId, deviceId: 'tv-slaapkamer', protocol: 'thuishub-tv-app', state: 'connecting',
      handoffFromSessionId: source.id,
    });

    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).not.toBeNull();
    expect(destination.metadata.transferFromSessionId).toBe(source.id);
    expect(Number(destination.metadata.transferDeadlineAt)).toBeGreaterThan(Date.now());
    sessions.updatePlaybackSession({ id: source.id, userId, revision: source.revision, position: 20 });
    expect(sessions.getActivePlaybackSession(userId)?.id).toBe(destination.id);

    const metadataUpdate = sessions.updatePlaybackSession({ id: destination.id, userId, revision: destination.revision, metadata: { volume: 0.5, transferFromSessionId: 'forged' } });
    expect(metadataUpdate.metadata).toMatchObject({ volume: 0.5, transferFromSessionId: source.id });
  });

  it('staat een overdracht op hetzelfde apparaat alleen na een expliciete opt-in toe', () => {
    const source = create();
    const sourceToken = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });

    expect(() => sessions.createPlaybackSession({
      userId, mediaId, deviceId: source.deviceId, protocol: source.protocol, state: 'connecting',
      handoffFromSessionId: source.id,
    })).toThrowError(expect.objectContaining({ code: 'PLAYBACK_TRANSFER_SOURCE_UNAVAILABLE', status: 409 }));
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).not.toBeNull();

    const destination = sessions.createPlaybackSession({
      userId, mediaId, deviceId: source.deviceId, protocol: source.protocol, state: 'connecting',
      handoffFromSessionId: source.id, allowSameDeviceHandoff: true,
    });

    expect(destination).toMatchObject({ deviceId: source.deviceId, state: 'connecting', endedAt: null });
    expect(destination.metadata.transferFromSessionId).toBe(source.id);
    expect(sessions.listActivePlaybackSessions(userId).map(item => item.id)).toEqual([destination.id, source.id]);
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).not.toBeNull();
  });

  it('rolt een expliciete overdracht op hetzelfde apparaat terug zonder de bron of bron-grant te stoppen', () => {
    const source = create();
    const sourceToken = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = sessions.createPlaybackSession({
      userId, mediaId, deviceId: source.deviceId, protocol: source.protocol, state: 'connecting',
      handoffFromSessionId: source.id, allowSameDeviceHandoff: true,
    });
    const destinationToken = tokens.createPlaybackGrant({ sessionId: destination.id, resource: 'file' });

    const rolledBack = sessions.rollbackPlaybackHandoff(destination.id, userId, 'transfer-cancelled');

    expect(rolledBack).toMatchObject({ id: destination.id, state: 'stopped', endReason: 'transfer-cancelled' });
    expect(tokens.verifyPlaybackToken(destinationToken, mediaId, 'file', destination.id)).toBeNull();
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).not.toBeNull();
    expect(sessions.getActivePlaybackSession(userId)?.id).toBe(source.id);
  });

  it('finaliseert een bevestigde overdracht op hetzelfde apparaat atomair en trekt pas dan de bron-grant in', () => {
    const source = create();
    const sourceToken = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = sessions.createPlaybackSession({
      userId, mediaId, deviceId: source.deviceId, protocol: source.protocol, state: 'connecting',
      handoffFromSessionId: source.id, allowSameDeviceHandoff: true,
    });
    const destinationToken = tokens.createPlaybackGrant({ sessionId: destination.id, resource: 'file' });
    const playing = sessions.updatePlaybackSession({
      id: destination.id, userId, revision: destination.revision, state: 'playing', position: 10, duration: 100,
    });

    const finalized = sessions.finalizePlaybackHandoff(playing.id, userId);

    expect(finalized).toMatchObject({ id: destination.id, state: 'playing', endedAt: null });
    expect(finalized?.metadata.transferFromSessionId).toBeUndefined();
    expect(finalized?.metadata.transferDeadlineAt).toBeUndefined();
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'stopped', endReason: 'transferred' });
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).toBeNull();
    expect(tokens.verifyPlaybackToken(destinationToken, mediaId, 'file', destination.id)).not.toBeNull();
    expect(sessions.getActivePlaybackSession(userId)?.id).toBe(destination.id);
  });

  it('vervangt herhaalde wachtende overdrachten zonder de oorspronkelijke bron te stoppen', () => {
    const source = create();
    const sourceToken = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const firstDestination = sessions.createPlaybackSession({
      userId, mediaId, deviceId: 'tv-slaapkamer', protocol: 'thuishub-tv-app',
      handoffFromSessionId: source.id,
    });
    const firstDestinationToken = tokens.createPlaybackGrant({ sessionId: firstDestination.id, resource: 'file' });
    const secondDestination = sessions.createPlaybackSession({
      userId, mediaId, deviceId: 'tv-zolder', protocol: 'thuishub-tv-app',
      handoffFromSessionId: source.id,
    });

    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).not.toBeNull();
    expect(sessions.getPlaybackSession(firstDestination.id)).toMatchObject({ state: 'stopped', endReason: 'transfer-replaced' });
    expect(tokens.verifyPlaybackToken(firstDestinationToken, mediaId, 'file', firstDestination.id)).toBeNull();
    expect(secondDestination.metadata.transferFromSessionId).toBe(source.id);
    expect(sessions.listActivePlaybackSessions(userId).map(item => item.id)).toEqual([secondDestination.id, source.id]);
  });
});
