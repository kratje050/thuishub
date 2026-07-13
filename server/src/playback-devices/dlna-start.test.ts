import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-dlna-start-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');
fs.writeFileSync(path.join(root, '.migration-from-huiskamer.json'), '{}');

const database = await import('../db.js');
const sessions = await import('./sessions.js');
const tokens = await import('../playback-tokens.js');
const { startConfirmedDlnaPlayback } = await import('./dlna-start.js');

const sourceId = Number(database.db.prepare("INSERT INTO sources(name,path,kind) VALUES('DLNA-starttest','C:/DLNA-starttest','movies')").run().lastInsertRowid);
const mediaId = Number(database.db.prepare(`INSERT INTO media_items(source_id,kind,title,sort_title,file_path,duration)
  VALUES(?,'movie','DLNA-film','DLNA-film','C:/DLNA-starttest/film.mp4',120)`).run(sourceId).lastInsertRowid);

beforeEach(() => {
  database.db.exec('DELETE FROM playback_grants; DELETE FROM playback_sessions; DELETE FROM progress; DELETE FROM users;');
});
afterEach(() => vi.useRealTimers());
afterAll(() => { database.db.close(); fs.rmSync(root, { recursive: true, force: true }); });

function user() {
  return Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?, 'admin')")
    .run(`dlna-${Math.random()}`, 'test').lastInsertRowid);
}

function sourceSession(userId: number) {
  return sessions.createPlaybackSession({
    userId, mediaId, deviceId: 'bron-browser', protocol: 'local-browser', state: 'playing', duration: 120,
  });
}

function destinationSession(userId: number, sourceId?: string) {
  return sessions.createPlaybackSession({
    userId, mediaId, deviceId: 'dlna-test-tv', protocol: 'dlna-upnp', state: 'connecting',
    startPosition: 35, duration: 120, handoffFromSessionId: sourceId,
  });
}

function fakeController(states: Array<{ state: string; status?: string; speed?: string } | Error>) {
  let index = 0;
  return {
    play: vi.fn(async () => undefined),
    seek: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    getTransportInfo: vi.fn(async () => {
      const value = states[Math.min(index++, states.length - 1)];
      if (value instanceof Error) throw value;
      return { state: value?.state || '', status: value?.status || 'OK', speed: value?.speed || '1' };
    }),
  };
}

describe('bevestigde DLNA-start en atomaire handoff', () => {
  it('houdt bron en grants actief tijdens TRANSITIONING en finaliseert pas bij echte PLAYING', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T20:00:00Z'));
    const userId = user();
    const source = sourceSession(userId);
    const sourceGrant = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = destinationSession(userId, source.id);
    const destinationGrant = tokens.createPlaybackGrant({ sessionId: destination.id, resource: 'file' });
    const controller = fakeController([{ state: 'TRANSITIONING' }, { state: 'PLAYING' }]);

    const started = startConfirmedDlnaPlayback({
      controller,
      session: destination,
      uri: 'http://192.168.1.10:8788/api/playback/1/file',
      confirmation: { timeoutMs: 1_000, pollIntervalMs: 100 },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.play).toHaveBeenCalledTimes(1);
    expect(controller.seek).toHaveBeenCalledWith(35);
    expect(controller.getTransportInfo).toHaveBeenCalledTimes(1);
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(sessions.getPlaybackSession(destination.id)).toMatchObject({ state: 'connecting', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).not.toBeNull();

    await vi.advanceTimersByTimeAsync(100);
    const result = await started;

    expect(controller.getTransportInfo).toHaveBeenCalledTimes(2);
    expect(result.transport.state).toBe('PLAYING');
    expect(result.session).toMatchObject({ id: destination.id, state: 'playing', endedAt: null });
    expect(result.session.metadata.transferFromSessionId).toBeUndefined();
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'stopped', endReason: 'transferred' });
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).toBeNull();
    expect(tokens.verifyPlaybackToken(destinationGrant, mediaId, 'file', destination.id)).not.toBeNull();
  });

  it('rolt bij STOPPED alleen de wachtende bestemming terug en behoudt de bron en brongrant', async () => {
    const userId = user();
    const source = sourceSession(userId);
    const sourceGrant = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = destinationSession(userId, source.id);
    const destinationGrant = tokens.createPlaybackGrant({ sessionId: destination.id, resource: 'file' });
    const controller = fakeController([{ state: 'STOPPED' }]);

    await expect(startConfirmedDlnaPlayback({ controller, session: destination, uri: 'http://192.168.1.10/media' }))
      .rejects.toMatchObject({ code: 'DLNA_PLAYBACK_STOPPED' });

    expect(sessions.getPlaybackSession(destination.id)).toMatchObject({ state: 'stopped', endReason: 'receiver-stopped' });
    expect(tokens.verifyPlaybackToken(destinationGrant, mediaId, 'file', destination.id)).toBeNull();
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).not.toBeNull();
    expect(sessions.getActivePlaybackSession(userId)?.id).toBe(source.id);
  });

  it('behandelt een transportfout als receiver-error zonder de bron in te trekken', async () => {
    const userId = user();
    const source = sourceSession(userId);
    const sourceGrant = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = destinationSession(userId, source.id);
    const destinationGrant = tokens.createPlaybackGrant({ sessionId: destination.id, resource: 'file' });
    const controller = fakeController([{ state: 'TRANSITIONING', status: 'ERROR_OCCURRED' }]);

    await expect(startConfirmedDlnaPlayback({ controller, session: destination, uri: 'http://192.168.1.10/media' }))
      .rejects.toMatchObject({ code: 'DLNA_PLAYBACK_STATUS_ERROR' });

    expect(sessions.getPlaybackSession(destination.id)).toMatchObject({ state: 'stopped', endReason: 'receiver-error' });
    expect(tokens.verifyPlaybackToken(destinationGrant, mediaId, 'file', destination.id)).toBeNull();
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).not.toBeNull();
  });

  it('begrenst statuspolling en rolt een timeout terug zonder de bron te stoppen', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T20:00:00Z'));
    const userId = user();
    const source = sourceSession(userId);
    const sourceGrant = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = destinationSession(userId, source.id);
    const destinationGrant = tokens.createPlaybackGrant({ sessionId: destination.id, resource: 'file' });
    const controller = fakeController([{ state: 'TRANSITIONING' }]);

    const started = startConfirmedDlnaPlayback({
      controller,
      session: destination,
      uri: 'http://192.168.1.10/media',
      confirmation: { timeoutMs: 60, pollIntervalMs: 20 },
    });
    const rejected = expect(started).rejects.toMatchObject({ code: 'DLNA_PLAYBACK_CONFIRMATION_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(60);
    await rejected;

    expect(controller.getTransportInfo.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sessions.getPlaybackSession(destination.id)).toMatchObject({ state: 'stopped', endReason: 'receiver-timeout' });
    expect(tokens.verifyPlaybackToken(destinationGrant, mediaId, 'file', destination.id)).toBeNull();
    expect(sessions.getPlaybackSession(source.id)).toMatchObject({ state: 'playing', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).not.toBeNull();
  });

  it('stopt ook een eerste mislukte DLNA-sessie en trekt haar grants in', async () => {
    const userId = user();
    const destination = destinationSession(userId);
    const destinationGrant = tokens.createPlaybackGrant({ sessionId: destination.id, resource: 'file' });
    const controller = fakeController([new Error('SOAP-status niet bereikbaar')]);

    await expect(startConfirmedDlnaPlayback({ controller, session: destination, uri: 'http://192.168.1.10/media' }))
      .rejects.toMatchObject({ code: 'DLNA_PLAYBACK_STATUS_ERROR' });

    expect(controller.stop).toHaveBeenCalledTimes(1);
    expect(sessions.getPlaybackSession(destination.id)).toMatchObject({ state: 'stopped', endReason: 'receiver-error' });
    expect(tokens.verifyPlaybackToken(destinationGrant, mediaId, 'file', destination.id)).toBeNull();
  });
});
