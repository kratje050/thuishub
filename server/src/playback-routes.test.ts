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
const { playbackRouter } = await import('./routes/playback.js');

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
});
