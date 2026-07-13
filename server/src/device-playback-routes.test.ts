import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-device-playback-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');
fs.writeFileSync(path.join(root, '.migration-from-huiskamer.json'), '{}');

vi.mock('./network.js', async () => {
  const actual = await vi.importActual<typeof import('./network.js')>('./network.js');
  return { ...actual, lanPlaybackBaseUrl: () => 'http://192.168.50.10:8788' };
});

const database = await import('./db.js');
const devices = await import('./devices.js');
const sessions = await import('./playback-devices/sessions.js');
const tokens = await import('./playback-tokens.js');
const { apiRouter } = await import('./routes/api.js');

const sourceId = Number(database.db.prepare("INSERT INTO sources(name,path,kind) VALUES('TV-routebron','C:/TV-routebron','movies')").run().lastInsertRowid);
const mediaId = Number(database.db.prepare(`INSERT INTO media_items(
  source_id,kind,title,sort_title,file_path,size,duration,container,video_codec,audio_codec,width,height,bit_depth,frame_rate,content_rating
) VALUES(?,'movie','Sessiefilm','Sessiefilm','C:/TV-routebron/sessiefilm.mp4',1000,120,'mp4','h264','aac',1920,1080,8,24,'12')`).run(sourceId).lastInsertRowid);

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const userId = Number(req.get('X-Test-User'));
  if (Number.isInteger(userId) && userId > 0) {
    req.user = database.db.prepare(`SELECT id,username,role,max_content_rating maxContentRating,
      can_download canDownload FROM users WHERE id=?`).get(userId) as any;
  }
  next();
});
app.use('/api', apiRouter);
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(Number(error?.status) || 500).json({ error: error?.message || 'Testfout', code: error?.code });
});

const capabilities = {
  maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60, maxBitrateMbps: 25,
  containers: ['mp4'], videoCodecs: ['h264'], maxBitDepth: 8, hdrFormats: ['sdr'], dolbyVisionProfiles: [],
  audioCodecs: ['aac'], maxAudioChannels: 2, passthrough: false, atmos: false, trueHd: false, eac3: false,
  dts: false, subtitleFormats: ['srt'], play: true, pause: true, stop: true, seek: true, position: true,
};

function pairForUser(userId: number, name: string, platform = 'android-tv') {
  const pairing = devices.requestPairing({ id: `${platform}-${name}`, name: `${name} tv`, platform, capabilities });
  expect(devices.approvePairing(pairing.code, userId)).toBe(true);
  const claim = devices.claimPairing(pairing.deviceId, pairing.pairingSecret);
  if (claim.status !== 'approved') throw new Error('Testapparaat kon niet worden gekoppeld.');
  return { userId, deviceId: pairing.deviceId, token: claim.token };
}

function pairedDevice(username: string, maxRating: string, platform = 'android-tv') {
  const userId = Number(database.db.prepare('INSERT INTO users(username,password_hash,role,max_content_rating) VALUES(?,?,?,?)')
    .run(username, 'test-hash', 'user', maxRating).lastInsertRowid);
  return pairForUser(userId, username, platform);
}

beforeEach(() => database.db.exec('DELETE FROM device_commands; DELETE FROM playback_grants; DELETE FROM playback_sessions; DELETE FROM device_sessions; DELETE FROM device_pairing_codes; DELETE FROM playback_devices; DELETE FROM progress; DELETE FROM users;'));
afterAll(() => { database.db.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('apparaatgestuurde centrale afspeelsessies', () => {
  it('maakt voor de gekoppelde tv een sessiegebonden grant zonder een load-opdracht naar zichzelf te sturen', async () => {
    const paired = pairedDevice('woonkamer', '16');
    const response = await request(app).post(`/api/device/media/${mediaId}/session`)
      .set('Authorization', `Device ${paired.token}`)
      .send({ quality: 'auto', deviceId: 'een-ander-apparaat' });

    expect(response.status).toBe(201);
    expect(response.body.session).toMatchObject({ userId: paired.userId, mediaId, deviceId: paired.deviceId, state: 'connecting' });
    expect(response.body.urls.playback).toMatch(/^http:\/\/192\.168\.50\.10:8788\/api\/playback\//);
    expect(database.db.prepare('SELECT COUNT(*) count FROM device_commands WHERE device_id=?').get(paired.deviceId)).toMatchObject({ count: 0 });

    const playbackUrl = new URL(response.body.urls.playback);
    const grant = playbackUrl.searchParams.get('token') || '';
    const resource = playbackUrl.pathname.includes('/file') ? 'file' : 'hls';
    expect(tokens.verifyPlaybackToken(grant, mediaId, resource, response.body.session.id)).toMatchObject({
      sessionId: response.body.session.id,
      userId: paired.userId,
      deviceId: paired.deviceId,
    });

    const otherTv = pairForUser(paired.userId, 'woonkamer-tweede', 'tizen');
    const foreignProgress = await request(app).put(`/api/device/media/${mediaId}/progress`)
      .set('Authorization', `Device ${otherTv.token}`)
      .send({ sessionId: response.body.session.id, position: 10, duration: 120, state: 'playing' });
    expect(foreignProgress.status).toBe(409);
    expect(sessions.getPlaybackSession(response.body.session.id, paired.userId)?.endedAt).toBeNull();
    expect(tokens.verifyPlaybackToken(grant, mediaId, resource, response.body.session.id)).not.toBeNull();
  });

  it('weigert media boven de profielclassificatie voordat een sessie of grant ontstaat', async () => {
    const paired = pairedDevice('kinderkamer', '6', 'tizen');
    const response = await request(app).post(`/api/device/media/${mediaId}/session`)
      .set('Authorization', `Device ${paired.token}`)
      .send({ quality: 'auto' });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/profiel/i);
    expect(database.db.prepare('SELECT COUNT(*) count FROM playback_sessions').get()).toMatchObject({ count: 0 });
    expect(database.db.prepare('SELECT COUNT(*) count FROM playback_grants').get()).toMatchObject({ count: 0 });
  });

  it('finaliseert een overdracht pas nadat de native receiver playing bevestigt', async () => {
    const paired = pairedDevice('overdracht', '18');
    const source = sessions.createPlaybackSession({
      userId: paired.userId, mediaId, deviceId: 'local-browser', protocol: 'local-browser', state: 'playing', duration: 120,
    });
    sessions.updatePlaybackSession({ id: source.id, userId: paired.userId, revision: source.revision, position: 31, duration: 120 });
    const sourceGrant = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });

    const started = await request(app).post(`/api/device/media/${mediaId}/session`)
      .set('Authorization', `Device ${paired.token}`)
      .send({ quality: 'auto', startPosition: 23 });

    expect(started.status).toBe(201);
    expect(started.body.session.metadata.transferFromSessionId).toBe(source.id);
    expect(sessions.getPlaybackSession(source.id, paired.userId)?.endedAt).toBeNull();
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).not.toBeNull();

    const wrongConfirmationChannel = await request(app).post(`/api/playback-sessions/${started.body.session.id}/receiver-status`)
      .set('X-Test-User', String(paired.userId))
      .send({ revision: started.body.session.revision, state: 'playing', position: 23, duration: 120 });
    expect(wrongConfirmationChannel.status).toBe(422);
    expect(wrongConfirmationChannel.body.code).toBe('PLAYBACK_RECEIVER_STATUS_NOT_ALLOWED');

    const missingSessionId = await request(app).put(`/api/device/media/${mediaId}/progress`)
      .set('Authorization', `Device ${paired.token}`)
      .send({ position: 2, duration: 120, state: 'playing' });
    expect(missingSessionId.status).toBe(409);
    expect(missingSessionId.body.code).toBe('PLAYBACK_SESSION_ID_REQUIRED');
    expect(database.db.prepare('SELECT position FROM progress WHERE user_id=? AND media_id=?').get(paired.userId, mediaId)).toMatchObject({ position: 31 });

    const confirmed = await request(app).put(`/api/device/media/${mediaId}/progress`)
      .set('Authorization', `Device ${paired.token}`)
      .send({ sessionId: started.body.session.id, position: 23, duration: 120, state: 'playing' });

    expect(confirmed.status).toBe(200);
    expect(sessions.getPlaybackSession(started.body.session.id, paired.userId)).toMatchObject({ state: 'playing', endedAt: null });
    expect(sessions.getPlaybackSession(source.id, paired.userId)).toMatchObject({ state: 'stopped', endedAt: expect.any(String), endReason: 'transferred' });
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).toBeNull();
  });

  it('laat alleen expliciete Cast-receiverstatus een wachtende browseroverdracht bevestigen', async () => {
    const userId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role,max_content_rating) VALUES('cast-controller','test','admin','ALL')").run().lastInsertRowid);
    const source = sessions.createPlaybackSession({
      userId, mediaId, deviceId: 'local-browser', protocol: 'local-browser', state: 'playing', duration: 120,
    });
    const advancedSource = sessions.updatePlaybackSession({ id: source.id, userId, revision: source.revision, position: 48, duration: 120 });
    const sourceGrant = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });
    const destination = sessions.createPlaybackSession({
      userId, mediaId, deviceId: 'google-cast', protocol: 'google-cast', state: 'connecting',
      startPosition: 48, duration: 120, handoffFromSessionId: advancedSource.id,
    });

    const genericPatch = await request(app).patch(`/api/playback-sessions/${destination.id}`)
      .set('X-Test-User', String(userId))
      .send({ revision: destination.revision, state: 'playing', position: 4, duration: 120 });
    expect(genericPatch.status).toBe(409);
    expect(genericPatch.body.code).toBe('PLAYBACK_TRANSFER_PENDING');

    for (const action of ['play', 'pause', 'seek', 'volume', 'audio-track', 'subtitle-track', 'next', 'previous', 'quality']) {
      const blocked = await request(app).post(`/api/playback-sessions/${destination.id}/control`)
        .set('X-Test-User', String(userId))
        .send({ revision: destination.revision, action, quality: '1080p' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('PLAYBACK_TRANSFER_PENDING');
    }

    expect(sessions.getPlaybackSession(source.id, userId)).toMatchObject({ state: 'playing', endedAt: null });
    expect(sessions.getPlaybackSession(destination.id, userId)).toMatchObject({ state: 'connecting', endedAt: null, revision: destination.revision });
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).not.toBeNull();
    expect(database.db.prepare('SELECT position FROM progress WHERE user_id=? AND media_id=?').get(userId, mediaId)).toMatchObject({ position: 48 });

    const receiverStatus = await request(app).post(`/api/playback-sessions/${destination.id}/receiver-status`)
      .set('X-Test-User', String(userId))
      .send({ revision: destination.revision, state: 'playing', position: 4, duration: 120 });

    expect(receiverStatus.status).toBe(200);
    expect(receiverStatus.body.session).toMatchObject({ id: destination.id, state: 'playing', endedAt: null });
    expect(receiverStatus.body.session.metadata.transferFromSessionId).toBeUndefined();
    expect(sessions.getPlaybackSession(source.id, userId)).toMatchObject({ state: 'stopped', endReason: 'transferred' });
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).toBeNull();
    expect(database.db.prepare('SELECT position FROM progress WHERE user_id=? AND media_id=?').get(userId, mediaId)).toMatchObject({ position: 48 });
  });

  it('gebruikt expliciete receiverstatus ook voor een eerste Cast-start en terminale playerfout', async () => {
    const userId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role,max_content_rating) VALUES('cast-start','test','admin','ALL')").run().lastInsertRowid);
    const session = sessions.createPlaybackSession({
      userId, mediaId, deviceId: 'google-cast', protocol: 'google-cast', state: 'connecting', duration: 120,
    });
    const grant = tokens.createPlaybackGrant({ sessionId: session.id, resource: 'file' });

    const playing = await request(app).post(`/api/playback-sessions/${session.id}/receiver-status`)
      .set('X-Test-User', String(userId))
      .send({ revision: session.revision, state: 'playing', position: 9, duration: 120 });

    expect(playing.status).toBe(200);
    expect(playing.body.session).toMatchObject({ id: session.id, state: 'playing', position: 9, endedAt: null });
    expect(tokens.verifyPlaybackToken(grant, mediaId, 'file', session.id)).not.toBeNull();

    const failed = await request(app).post(`/api/playback-sessions/${session.id}/receiver-status`)
      .set('X-Test-User', String(userId))
      .send({ revision: playing.body.session.revision, state: 'error', position: 14, duration: 120 });

    expect(failed.status).toBe(200);
    expect(failed.body.session).toMatchObject({ id: session.id, state: 'stopped', endReason: 'receiver-error', position: 14 });
    expect(tokens.verifyPlaybackToken(grant, mediaId, 'file', session.id)).toBeNull();
    expect(database.db.prepare('SELECT position FROM progress WHERE user_id=? AND media_id=?').get(userId, mediaId)).toMatchObject({ position: 14 });
  });

  it('behandelt ook een generieke browserfout als terminaal en trekt grants in', async () => {
    const userId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role,max_content_rating) VALUES('browser-error','test','admin','ALL')").run().lastInsertRowid);
    const session = sessions.createPlaybackSession({
      userId, mediaId, deviceId: 'local-browser', protocol: 'local-browser', state: 'playing', duration: 120,
    });
    const grant = tokens.createPlaybackGrant({ sessionId: session.id, resource: 'file' });

    const failed = await request(app).patch(`/api/playback-sessions/${session.id}`)
      .set('X-Test-User', String(userId))
      .send({ revision: session.revision, state: 'error', position: 19, duration: 120 });

    expect(failed.status).toBe(200);
    expect(failed.body.session).toMatchObject({ id: session.id, state: 'stopped', endReason: 'receiver-error', position: 19 });
    expect(tokens.verifyPlaybackToken(grant, mediaId, 'file', session.id)).toBeNull();
  });

  it('legt browsercommando\'s centraal vast zodat de ontvangende browser ze kan uitvoeren', async () => {
    const userId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role,max_content_rating) VALUES('remote-browser','test','admin','ALL')").run().lastInsertRowid);
    const session = sessions.createPlaybackSession({
      userId, mediaId, deviceId: 'local-browser:receiver-001', protocol: 'local-browser', state: 'playing', duration: 120,
    });

    const paused = await request(app).post(`/api/playback-sessions/${session.id}/control`)
      .set('X-Test-User', String(userId))
      .send({ revision: session.revision, action: 'pause' });
    expect(paused.status).toBe(200);
    expect(paused.body.session).toMatchObject({ state: 'paused', metadata: { browserCommand: { command: 'pause', payload: {} } } });
    expect(paused.body.session.metadata.browserCommand.id).toBe(`${session.id}:${session.revision + 1}`);
    expect(paused.body.session.metadata.browserCommand.issuedAt).toEqual(expect.any(Number));

    const seeked = await request(app).post(`/api/playback-sessions/${session.id}/control`)
      .set('X-Test-User', String(userId))
      .send({ revision: paused.body.session.revision, action: 'seek', position: 47 });
    expect(seeked.status).toBe(200);
    expect(seeked.body.session).toMatchObject({ position: 47, metadata: { browserCommand: { command: 'seek', payload: { position: 47 } } } });
  });

  it('vervangt Cast-kwaliteit via de eigenaarbrowser en houdt de oude sessie actief tot echte PLAYING-bevestiging', async () => {
    const userId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role,max_content_rating) VALUES('cast-quality-remote','test','admin','ALL')").run().lastInsertRowid);
    const source = sessions.createPlaybackSession({
      userId, mediaId, deviceId: 'google-cast', protocol: 'google-cast', state: 'playing',
      startPosition: 37, duration: 120, metadata: { quality: 'auto', title: 'Sessiefilm' },
    });
    const sourceGrant = tokens.createPlaybackGrant({ sessionId: source.id, resource: 'file' });

    const replacement = await request(app).post(`/api/playback-sessions/${source.id}/control`)
      .set('X-Test-User', String(userId))
      .send({ revision: source.revision, action: 'quality', quality: '720p', controllerId: 'remote-browser' });

    expect(replacement.status).toBe(200);
    expect(replacement.body.session).toMatchObject({
      deviceId: source.deviceId,
      protocol: 'google-cast',
      mediaId,
      state: 'connecting',
      position: 37,
      metadata: {
        quality: '720p',
        transferFromSessionId: source.id,
        browserCommand: {
          command: 'replace-media',
          payload: {
            startPosition: 37,
            media: { id: mediaId, title: 'Sessiefilm' },
            urls: { playback: expect.stringMatching(/^http:\/\/192\.168\.50\.10:8788\/api\/playback\//) },
            decision: expect.objectContaining({}),
          },
        },
      },
    });
    expect(replacement.body.session.id).not.toBe(source.id);
    expect(replacement.body.session.metadata.browserCommand.id).toBe(`${replacement.body.session.id}:${replacement.body.session.revision}`);
    expect(replacement.body.session.metadata.browserCommand.issuedAt).toEqual(expect.any(Number));
    expect(sessions.getPlaybackSession(replacement.body.session.id, userId)?.revision).toBe(replacement.body.session.revision);
    expect(sessions.getPlaybackSession(source.id, userId)).toMatchObject({ state: 'playing', endedAt: null });
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).not.toBeNull();

    const rolledBack = await request(app).delete(`/api/playback-sessions/${replacement.body.session.id}`)
      .set('X-Test-User', String(userId));
    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body).toMatchObject({
      rolledBack: true,
      session: { id: replacement.body.session.id, state: 'stopped' },
      activeSession: { id: source.id, state: 'playing' },
    });
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).not.toBeNull();

    const confirmedReplacement = await request(app).post(`/api/playback-sessions/${source.id}/control`)
      .set('X-Test-User', String(userId))
      .send({ revision: source.revision, action: 'quality', quality: '1080p-balanced', controllerId: 'cast-owner-browser' });
    expect(confirmedReplacement.status).toBe(200);
    expect(confirmedReplacement.body.session.metadata.transferFromSessionId).toBe(source.id);

    const confirmed = await request(app).post(`/api/playback-sessions/${confirmedReplacement.body.session.id}/receiver-status`)
      .set('X-Test-User', String(userId))
      .send({ revision: confirmedReplacement.body.session.revision, state: 'playing', position: 38, duration: 120 });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.session).toMatchObject({ id: confirmedReplacement.body.session.id, state: 'playing', endedAt: null });
    expect(confirmed.body.session.metadata.transferFromSessionId).toBeUndefined();
    expect(confirmed.body.session.metadata.transferDeadlineAt).toBeUndefined();
    expect(sessions.getPlaybackSession(source.id, userId)).toMatchObject({ state: 'stopped', endReason: 'transferred' });
    expect(tokens.verifyPlaybackToken(sourceGrant, mediaId, 'file', source.id)).toBeNull();
  });

  it('sluit de sessie en trekt grants direct in wanneer de receiver een playerfout meldt', async () => {
    const paired = pairedDevice('slaapkamer', '18');
    const started = await request(app).post(`/api/device/media/${mediaId}/session`)
      .set('Authorization', `Device ${paired.token}`)
      .send({ quality: 'auto' });
    const sessionId = started.body.session.id;
    const playbackUrl = new URL(started.body.urls.playback);
    const grant = playbackUrl.searchParams.get('token') || '';
    const resource = playbackUrl.pathname.includes('/file') ? 'file' : 'hls';

    const failed = await request(app).put(`/api/device/media/${mediaId}/progress`)
      .set('Authorization', `Device ${paired.token}`)
      .send({ sessionId, position: 17, duration: 120, state: 'error' });

    expect(failed.status).toBe(200);
    expect(failed.body.stopped).toBe(true);
    expect(sessions.getPlaybackSession(sessionId, paired.userId)).toMatchObject({ state: 'stopped', endedAt: expect.any(String), endReason: 'receiver-error' });
    expect(tokens.verifyPlaybackToken(grant, mediaId, resource, sessionId)).toBeNull();
  });
});
