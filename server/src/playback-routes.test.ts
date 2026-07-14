import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-playback-routes-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');
fs.writeFileSync(path.join(root, '.migration-from-huiskamer.json'), '{}');

const mediaFile = path.join(root, 'range-test.mp4');
fs.writeFileSync(mediaFile, Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'));
const database = await import('./db.js');
const tokens = await import('./playback-tokens.js');
const sessions = await import('./playback-devices/sessions.js');
const { playbackRouter, playbackRouteInternals } = await import('./routes/playback.js');
const { dlnaMpegTsArgs, transcodeInternals } = await import('./transcode.js');

const userId = Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES('route-test','test','admin')").run().lastInsertRowid);
const sourceId = Number(database.db.prepare("INSERT INTO sources(name,path,kind) VALUES('Routetest','C:/Routetest','movies')").run().lastInsertRowid);
const mediaId = Number(database.db.prepare(`INSERT INTO media_items(source_id,kind,title,sort_title,file_path,duration)
  VALUES(?,'movie','Rangefilm','Rangefilm',?,100)`).run(sourceId, mediaFile).lastInsertRowid);
const app = express();
app.use('/api/playback', playbackRouter);

beforeEach(() => database.db.exec('DELETE FROM playback_grants; DELETE FROM playback_sessions; DELETE FROM progress;'));
afterAll(() => { database.db.close(); fs.rmSync(root, { recursive: true, force: true }); });

function sessionToken() {
  const session = sessions.createPlaybackSession({ userId, mediaId, deviceId: 'route-tv', protocol: 'dlna-upnp', state: 'playing', duration: 100 });
  return { session, token: tokens.createPlaybackGrant({ sessionId: session.id, resource: 'file' }) };
}

function dlnaToken() {
  const session = sessions.createPlaybackSession({ userId, mediaId, deviceId: 'route-tv', protocol: 'dlna-upnp', state: 'playing', duration: 100 });
  return { session, token: tokens.createPlaybackGrant({ sessionId: session.id, resource: 'dlna', options: { copyVideo: false, copyAudio: false, targetWidth: 1920 } }) };
}

describe('beveiligde playbackroutes', () => {
  it('levert correcte en gelijktijdige HTTP ranges', async () => {
    const { token } = sessionToken();
    const ranges = ['bytes=0-3', 'bytes=4-7', 'bytes=-4'];
    const responses = await Promise.all(ranges.map(range => request(app).get(`/api/playback/${mediaId}/file?token=${encodeURIComponent(token)}`).set('Range', range)));
    expect(responses.map(response => response.status)).toEqual([206, 206, 206]);
    expect(responses.map(response => Buffer.from(response.body).toString())).toEqual(['0123', '4567', 'wxyz']);
    expect(responses[0].headers).toMatchObject({ 'accept-ranges': 'bytes', 'content-range': `bytes 0-3/${fs.statSync(mediaFile).size}`, 'content-length': '4' });
  });

  it('geeft bij HEAD dezelfde rangeheaders maar geen body', async () => {
    const { token } = sessionToken();
    const response = await request(app).head(`/api/playback/${mediaId}/file?token=${encodeURIComponent(token)}`).set('Range', 'bytes=2-5');
    expect(response.status).toBe(206);
    expect(response.headers).toMatchObject({ 'content-length': '4', 'content-range': `bytes 2-5/${fs.statSync(mediaFile).size}`, 'cache-control': 'private,no-store', 'referrer-policy': 'no-referrer' });
    expect(response.text).toBeUndefined();
  });

  it('beantwoordt een goedgekeurde CORS/PNA-preflight en weigert een vreemde origin', async () => {
    const allowed = await request(app).options(`/api/playback/${mediaId}/file`).set('Origin', 'https://receiver.googleusercontent.com').set('Access-Control-Request-Private-Network', 'true');
    expect(allowed.status).toBe(204);
    expect(allowed.headers).toMatchObject({
      'access-control-allow-origin': 'https://receiver.googleusercontent.com',
      'access-control-allow-private-network': 'true',
      'access-control-allow-methods': 'GET,HEAD,OPTIONS',
    });
    const denied = await request(app).options(`/api/playback/${mediaId}/file`).set('Origin', 'https://example.invalid');
    expect(denied.status).toBe(403);
  });

  it('staat de exacte Google Default Media Receiver-origin toe voor preflight en media', async () => {
    const { token } = sessionToken();
    const origin = 'https://www.gstatic.com';
    const preflight = await request(app).options(`/api/playback/${mediaId}/file`).set('Origin', origin);
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    const media = await request(app).get(`/api/playback/${mediaId}/file?token=${encodeURIComponent(token)}`).set('Origin', origin);
    expect(media.status).toBe(200);
    expect(media.headers['access-control-allow-origin']).toBe(origin);
  });

  it('weigert de URL direct nadat de server-side sessie is gestopt', async () => {
    const { session, token } = sessionToken();
    expect((await request(app).get(`/api/playback/${mediaId}/file?token=${encodeURIComponent(token)}`)).status).toBe(200);
    sessions.stopPlaybackSession({ id: session.id, revision: session.revision, position: 50, duration: 100 });
    expect((await request(app).get(`/api/playback/${mediaId}/file?token=${encodeURIComponent(token)}`)).status).toBe(401);
  });

  it('biedt de Samsung-compatibele DLNA-stream met tijdseek- en MPEG-TS-headers aan', async () => {
    const { token } = dlnaToken();
    const response = await request(app).head(`/api/playback/${mediaId}/dlna?token=${encodeURIComponent(token)}`)
      .set('TimeSeekRange.dlna.org', 'npt=00:00:12.500-');
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'content-type': 'video/mpeg',
      'transfermode.dlna.org': 'Streaming',
      'timeseekrange.dlna.org': 'npt=12.500-100.000/100.000',
    });
    expect(response.headers['contentfeatures.dlna.org']).toContain('DLNA.ORG_OP=10');
    expect(playbackRouteInternals.dlnaTimeSeekSeconds('npt=75.25-')).toBe(75.25);
    expect(playbackRouteInternals.dlnaTimeSeekSeconds('ongeldig')).toBe(0);
  });

  it('maakt een begrensde H.264/AAC-stereo MPEG-TS-opdracht voor DLNA', () => {
    const args = dlnaMpegTsArgs(mediaFile, 'bt709', { targetWidth: 1920, targetBitrateMbps: 12 }, 12.5);
    expect(args).toEqual(expect.arrayContaining(['-ss', '12.500', '-c:a', 'aac', '-ac', '2', '-f', 'mpegts', 'pipe:1']));
    expect(args.join(' ')).toContain('-mpegts_flags +resend_headers');
  });

  it('maakt snel een zelfstandig eerste HLS-segment voor NVIDIA en andere encoders', () => {
    expect(transcodeInternals.HLS_FIRST_SEGMENT_SECONDS).toBe(1);
    expect(transcodeInternals.HLS_SEGMENT_SECONDS).toBe(3);
    expect(transcodeInternals.hlsKeyframeArgs('h264_nvenc')).toEqual([
      '-forced-idr', '1', '-force_key_frames', 'expr:gte(t,n_forced*1)',
    ]);
    expect(transcodeInternals.hlsKeyframeArgs('libx264')).toEqual([
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
    ]);
    expect(transcodeInternals.inputSeekArgs(8 * 60 + 3)).toEqual(['-ss', '483.000']);
  });
});
