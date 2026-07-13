import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-playback-transfers-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');
fs.writeFileSync(path.join(root, '.migration-from-huiskamer.json'), '{}');

const database = await import('../db.js');
const sessions = await import('./sessions.js');
const tokens = await import('../playback-tokens.js');
const transfers = await import('./transfers.js');

const userId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES('transfer-test','test','admin')").run().lastInsertRowid);
const sourceId = Number(database.db.prepare("INSERT INTO sources(name,path,kind) VALUES('Transfertest','C:/Transfertest','movies')").run().lastInsertRowid);
const mediaId = Number(database.db.prepare(`INSERT INTO media_items(source_id,kind,title,sort_title,file_path,duration)
  VALUES(?,'movie','Transferfilm','Transferfilm','C:/Transfertest/film.mp4',100)`).run(sourceId).lastInsertRowid);

beforeEach(() => {
  database.db.exec('DELETE FROM playback_grants; DELETE FROM playback_sessions; DELETE FROM progress;');
});
afterEach(() => vi.useRealTimers());
afterAll(() => { database.db.close(); fs.rmSync(root, { recursive: true, force: true }); });

function sourceSession() {
  return sessions.createPlaybackSession({ userId, mediaId, deviceId: 'oude-browser', protocol: 'local-browser', state: 'playing' });
}

function pendingDestination(source: { id: string }, state: 'connecting' | 'playing' = 'connecting') {
  return sessions.createPlaybackSession({
    userId, mediaId, deviceId: 'nieuwe-browser', protocol: 'local-browser', state,
    metadata: { quality: 'auto' }, handoffFromSessionId: source.id,
  });
}

describe('atomaire afspeeloverdracht', () => {
  it('finaliseert een nog verbindende bestemming niet voortijdig', async () => {
    const source = sourceSession();
    const destination = pendingDestination(source);

    const unchanged = await transfers.finalizePlaybackTransfer(destination);
    expect(unchanged).toMatchObject({ id: destination.id, state: 'connecting' });
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(sessions.getPlaybackSession(destination.id)?.metadata.transferFromSessionId).toBe(source.id);
  });

  it('stopt en revokeert de bron pas nadat de nieuwe ontvanger playing bevestigt', async () => {
    const source = sourceSession();
    const sourceToken = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = pendingDestination(source, 'playing');
    const destinationToken = tokens.createPlaybackGrant({ sessionId: destination.id, resource: 'file' });

    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).not.toBeNull();

    const finalized = await transfers.finalizePlaybackTransfer(destination);
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'stopped', endReason: 'transferred' });
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).toBeNull();
    expect(tokens.verifyPlaybackToken(destinationToken, mediaId, 'file', destination.id)).not.toBeNull();
    expect(finalized.metadata).toEqual({ quality: 'auto' });
    expect(sessions.getActivePlaybackSession(userId)?.id).toBe(destination.id);
  });

  it('rolt een mislukte bestemming terug terwijl bron en brongrant actief blijven', async () => {
    const source = sourceSession();
    const sourceToken = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = pendingDestination(source);
    const destinationToken = tokens.createPlaybackGrant({ sessionId: destination.id, resource: 'file' });

    const result = await transfers.abortPlaybackTransfer(destination, 'receiver-error');
    expect(result.session).toMatchObject({ state: 'stopped', endReason: 'receiver-error' });
    expect(result.activeSession?.id).toBe(source.id);
    expect(tokens.verifyPlaybackToken(destinationToken, mediaId, 'file', destination.id)).toBeNull();
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).not.toBeNull();
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
  });

  it('laat een wachtende bestemming de centrale voortgang niet overschrijven en bewaart die ook niet bij rollback', async () => {
    const source = sourceSession();
    const advancedSource = sessions.updatePlaybackSession({ id: source.id, userId, revision: source.revision, position: 48, duration: 100 });
    const destination = pendingDestination(advancedSource);
    const reportingDestination = sessions.updatePlaybackSession({ id: destination.id, userId, revision: destination.revision, state: 'buffering', position: 4, duration: 100 });

    expect(database.db.prepare('SELECT position,duration FROM progress WHERE user_id=? AND media_id=?').get(userId, mediaId))
      .toMatchObject({ position: 48, duration: 100 });

    await transfers.abortPlaybackTransfer(reportingDestination, 'receiver-error');
    expect(database.db.prepare('SELECT position,duration FROM progress WHERE user_id=? AND media_id=?').get(userId, mediaId))
      .toMatchObject({ position: 48, duration: 100 });
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
  });

  it('finaliseert dezelfde media zonder centrale voortgang terug te draaien', async () => {
    const source = sourceSession();
    const advancedSource = sessions.updatePlaybackSession({ id: source.id, userId, revision: source.revision, position: 48, duration: 100 });
    const destination = pendingDestination(advancedSource);
    const confirmedDestination = sessions.updatePlaybackSession({ id: destination.id, userId, revision: destination.revision, state: 'playing', position: 5, duration: 100 });

    await transfers.finalizePlaybackTransfer(confirmedDestination);

    expect(database.db.prepare('SELECT position,duration,completed FROM progress WHERE user_id=? AND media_id=?').get(userId, mediaId))
      .toMatchObject({ position: 48, duration: 100, completed: 0 });
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'stopped', endReason: 'transferred' });
  });

  it('neemt bij finaliseren de verder gevorderde bestemming over', async () => {
    const source = sourceSession();
    const advancedSource = sessions.updatePlaybackSession({ id: source.id, userId, revision: source.revision, position: 20, duration: 100 });
    const destination = pendingDestination(advancedSource);
    const confirmedDestination = sessions.updatePlaybackSession({ id: destination.id, userId, revision: destination.revision, state: 'playing', position: 27, duration: 100 });

    await transfers.finalizePlaybackTransfer(confirmedDestination);

    expect(database.db.prepare('SELECT position,duration FROM progress WHERE user_id=? AND media_id=?').get(userId, mediaId))
      .toMatchObject({ position: 27, duration: 100 });
  });

  it('weigert afstandsbediening behalve stoppen zolang de bestemming nog wacht', () => {
    const source = sourceSession();
    const sourceToken = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = pendingDestination(source);

    for (const action of ['play', 'pause', 'seek', 'volume', 'audio-track', 'subtitle-track', 'next', 'previous', 'quality', 'patch']) {
      try {
        transfers.assertPlaybackTransferControllerActionAllowed(destination, action);
        throw new Error(`${action} werd ten onrechte toegestaan tijdens de overdracht.`);
      } catch (error: any) {
        expect(error).toMatchObject({ status: 409, code: 'PLAYBACK_TRANSFER_PENDING' });
      }
    }

    for (const action of ['stop', 'error', 'disconnect']) {
      expect(() => transfers.assertPlaybackTransferControllerActionAllowed(destination, action)).not.toThrow();
    }

    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).not.toBeNull();
    expect(sessions.getPlaybackSession(destination.id)).toMatchObject({ state: 'connecting', endedAt: null });
  });

  it('rolt een niet-bevestigde overdracht na de deadline automatisch terug', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T20:00:00Z'));
    const source = sourceSession();
    const sourceToken = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = pendingDestination(source);
    const destinationToken = tokens.createPlaybackGrant({ sessionId: destination.id, resource: 'file' });
    transfers.armPlaybackTransferTimeout(destination);

    await vi.advanceTimersByTimeAsync(sessions.PLAYBACK_TRANSFER_TIMEOUT_MS + 1);

    expect(sessions.getPlaybackSession(destination.id)).toMatchObject({ state: 'stopped', endReason: 'transfer-timeout' });
    expect(tokens.verifyPlaybackToken(destinationToken, mediaId, 'file', destination.id)).toBeNull();
    expect(tokens.verifyPlaybackToken(sourceToken, mediaId, 'file', source.id)).not.toBeNull();
    expect(sessions.getActivePlaybackSession(userId)?.id).toBe(source.id);
  });

  it('houdt bij een herhaalde overdracht dezelfde oorspronkelijke bron aan', () => {
    const source = sourceSession();
    const firstDestination = pendingDestination(source);
    expect(transfers.resolvePlaybackHandoffSource(userId, firstDestination.deviceId)?.id).toBe(source.id);
    expect(transfers.resolvePlaybackHandoffSource(userId, 'derde-browser')?.id).toBe(source.id);
    expect(transfers.resolvePlaybackHandoffSource(userId, source.deviceId)).toBeNull();
  });
});
