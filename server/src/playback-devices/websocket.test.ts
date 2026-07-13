import fs from 'node:fs';
import http, { type IncomingMessage, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-websocket-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');
fs.writeFileSync(path.join(root, '.migration-from-huiskamer.json'), '{}');

const database = await import('../db.js');
const sockets = await import('./websocket.js');
let server: Server;
let port = 0;

function requestFixture(origin: string | undefined, host: string, localAddress: string, localPort: number) {
  return {
    headers: { origin, host },
    socket: { localAddress, localPort },
  } as unknown as IncomingMessage;
}

function connect(pathname: string, origin: string) {
  return new Promise<{ opened: boolean; status?: number }>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${pathname}`, { headers: { Origin: origin } });
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket-test duurde te lang.')); }, 3_000);
    socket.once('open', () => {
      clearTimeout(timeout);
      socket.close();
      resolve({ opened: true });
    });
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout);
      response.resume();
      resolve({ opened: false, status: response.statusCode });
    });
    socket.once('error', error => {
      if ((error as Error).message.includes('Unexpected server response')) return;
      clearTimeout(timeout);
      reject(error);
    });
  });
}

beforeAll(async () => {
  server = http.createServer();
  sockets.attachPlaybackWebSockets(server, { lan: false });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  sockets.closePlaybackWebSockets();
  await new Promise<void>(resolve => server.close(() => resolve()));
  database.db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('controller-WebSocket origincontrole', () => {
  it('accepteert alleen dezelfde loopback- of echte management-origin', () => {
    const allowed = sockets.playbackWebSocketInternals.controllerOriginAllowed;
    expect(allowed(requestFixture('http://localhost:8787', 'localhost:8787', '127.0.0.1', 8787))).toBe(true);
    expect(allowed(requestFixture('http://127.0.0.1:8787', '127.0.0.1:8787', '127.0.0.1', 8787))).toBe(true);
    expect(allowed(requestFixture('http://[::1]:8787', '[::1]:8787', '::1', 8787))).toBe(true);
    expect(allowed(requestFixture('http://192.168.1.20:8787', '192.168.1.20:8787', '192.168.1.20', 8787))).toBe(true);
    expect(allowed(requestFixture('https://pc.tailnet-name.ts.net', 'pc.tailnet-name.ts.net', '127.0.0.1', 8787))).toBe(true);
  });

  it('weigert ontbrekende, vreemde, verkeerde-poort- en DNS-rebinding-origins', () => {
    const allowed = sockets.playbackWebSocketInternals.controllerOriginAllowed;
    expect(allowed(requestFixture(undefined, 'localhost:8787', '127.0.0.1', 8787))).toBe(false);
    expect(allowed(requestFixture('https://evil.example', 'localhost:8787', '127.0.0.1', 8787))).toBe(false);
    expect(allowed(requestFixture('http://localhost:9999', 'localhost:9999', '127.0.0.1', 8787))).toBe(false);
    expect(allowed(requestFixture('https://evil.example', 'evil.example', '127.0.0.1', 8787))).toBe(false);
    expect(allowed(requestFixture('http://pc.tailnet-name.ts.net', 'pc.tailnet-name.ts.net', '127.0.0.1', 8787))).toBe(false);
  });

  it('weigert een vreemde controller-origin vóór de upgrade maar behoudt device-token-WebSockets', async () => {
    await expect(connect('/api/playback-sessions/ws', 'https://evil.example')).resolves.toEqual({ opened: false, status: 403 });
    await expect(connect('/api/device/ws', 'https://tv-app.invalid')).resolves.toEqual({ opened: true });
  });
});
