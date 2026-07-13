import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { ensureLocalOwner } from '../auth.js';
import { acknowledgeDeviceCommand, authenticateDeviceToken, markDeviceOnline, pendingDeviceCommands, queueDeviceCommand } from '../devices.js';
import { isLanClientAllowed } from '../network.js';
import { getActivePlaybackSession, getPlaybackSession, stopPlaybackSession, updatePlaybackSession, type PlaybackSession } from './sessions.js';
import { abortPlaybackTransfer, finalizePlaybackTransfer, isPendingPlaybackTransfer, onPlaybackTransferRollback } from './transfers.js';

type LiveSocket = WebSocket & { isAlive?: boolean; deviceId?: string; userId?: number; authenticated?: boolean };
const deviceServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const controllerServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const deviceSockets = new Map<string, LiveSocket>();
const attachedServers = new WeakSet<Server>();
let heartbeat: NodeJS.Timeout | null = null;

function rejectUpgrade(socket: Duplex, status = 403, message = 'Forbidden') {
  try { socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } finally { socket.destroy(); }
}

function send(socket: WebSocket, value: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function safeMessage(data: WebSocket.RawData) {
  try {
    const value = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function normalizedHost(value: string | undefined) {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
}

function controllerOriginAllowed(request: IncomingMessage) {
  const rawOrigin = String(request.headers.origin || '');
  const rawHost = String(request.headers.host || '');
  if (!rawOrigin || rawOrigin.length > 2_048 || !rawHost || rawHost.length > 512) return false;
  try {
    const origin = new URL(rawOrigin);
    const authority = new URL(`http://${rawHost}`);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') return false;
    const hostname = normalizedHost(origin.hostname);
    const authorityHostname = normalizedHost(authority.hostname);
    const localAddress = normalizedHost(request.socket.localAddress);
    const originPort = Number(origin.port || (origin.protocol === 'https:' ? 443 : 80));
    const authorityPort = Number(authority.port || (origin.protocol === 'https:' ? 443 : 80));
    if (hostname !== authorityHostname || originPort !== authorityPort) return false;
    const directManagementHost = ['localhost', '127.0.0.1', '::1'].includes(hostname) || Boolean(localAddress && hostname === localAddress);
    if (directManagementHost) {
      return origin.protocol === 'http:' && originPort === Number(request.socket.localPort);
    }

    // Tailscale Serve houdt de publieke HTTPS-origin in Host/Origin terwijl
    // de reverse proxy lokaal op de managementlistener uitkomt.
    return origin.protocol === 'https:' && originPort === 443 && hostname.endsWith('.ts.net') && hostname.length > '.ts.net'.length;
  } catch { return false; }
}

function sessionSnapshot(session: PlaybackSession | null) {
  return session ? { ...session, metadata: session.metadata } : null;
}

function attachDeviceSocket(socket: LiveSocket) {
  socket.isAlive = true;
  const authTimer = setTimeout(() => { if (!socket.authenticated) socket.close(4401, 'Authenticatie vereist'); }, 5_000);
  authTimer.unref();
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', async raw => {
    const message = safeMessage(raw);
    if (!message) return socket.close(4400, 'Ongeldig bericht');
    if (!socket.authenticated) {
      if (message.type !== 'authenticate') return socket.close(4401, 'Authenticatie vereist');
      const device = authenticateDeviceToken(String(message.token || ''));
      if (!device || (message.deviceId && String(message.deviceId) !== device.id)) return socket.close(4401, 'Ongeldig apparaattoken');
      clearTimeout(authTimer);
      socket.authenticated = true;
      socket.deviceId = device.id;
      socket.userId = device.userId;
      const previous = deviceSockets.get(device.id);
      if (previous && previous !== socket) previous.close(4000, 'Nieuwere verbinding actief');
      deviceSockets.set(device.id, socket);
      markDeviceOnline(device.id);
      send(socket, { type: 'authenticated', deviceId: device.id, heartbeatSeconds: 25 });
      for (const command of pendingDeviceCommands(device.id)) send(socket, { type: 'command', ...command });
      return;
    }
    markDeviceOnline(socket.deviceId!);
    if (message.type === 'ack') {
      acknowledgeDeviceCommand(socket.deviceId!, Number(message.commandId || message.id));
      return;
    }
    if (message.type === 'progress') {
      const session = getPlaybackSession(String(message.sessionId || ''), socket.userId);
      if (!session || session.deviceId !== socket.deviceId || session.endedAt) return;
      try {
        const terminalState = String(message.state);
        if (terminalState === 'stopped' || terminalState === 'error') {
          if (isPendingPlaybackTransfer(session)) {
            const rolledBack = await abortPlaybackTransfer(session, terminalState === 'error' ? 'receiver-error' : 'receiver-stopped');
            broadcastPlaybackSession(rolledBack.activeSession);
            return;
          }
          const stopped = stopPlaybackSession({ id: session.id, userId: session.userId, revision: session.revision, position: Math.max(0, Number(message.position) || 0), duration: Math.max(0, Number(message.duration) || session.duration), reason: terminalState === 'error' ? 'receiver-error' : 'receiver-stopped' });
          broadcastPlaybackSession(stopped);
          return;
        }
        const state = ['playing','paused','buffering'].includes(String(message.state)) ? String(message.state) as 'playing'|'paused'|'buffering' : session.state;
        let updated = updatePlaybackSession({ id: session.id, userId: session.userId, revision: session.revision, state, position: Math.max(0, Number(message.position) || 0), duration: Math.max(0, Number(message.duration) || session.duration) });
        if(state==='playing')updated=await finalizePlaybackTransfer(updated);
        broadcastPlaybackSession(updated);
      } catch { /* Een nieuwere serverrevisie wint; de app ontvangt die bij het volgende commando. */ }
    }
  });
  socket.on('close', () => { clearTimeout(authTimer); if (socket.deviceId && deviceSockets.get(socket.deviceId) === socket) deviceSockets.delete(socket.deviceId); });
}

function attachControllerSocket(socket: LiveSocket) {
  socket.isAlive = true;
  socket.userId = ensureLocalOwner().id;
  socket.on('pong', () => { socket.isAlive = true; });
  send(socket, { type: 'session', session: sessionSnapshot(getActivePlaybackSession(socket.userId)) });
  socket.on('message', raw => {
    const message = safeMessage(raw);
    if (message?.type === 'ping') send(socket, { type: 'pong', at: new Date().toISOString() });
  });
}

function startHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const server of [deviceServer, controllerServer]) for (const socket of server.clients as Set<LiveSocket>) {
      if (socket.isAlive === false) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, 25_000);
  heartbeat.unref();
}

export function attachPlaybackWebSockets(server: Server, options: { lan: boolean }) {
  if (attachedServers.has(server)) return;
  attachedServers.add(server);
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = '';
    try { pathname = new URL(request.url || '/', 'http://thuishub.local').pathname; } catch { return rejectUpgrade(socket, 400, 'Bad Request'); }
    if (pathname === '/api/device/ws') {
      if (options.lan && !isLanClientAllowed(request.socket.remoteAddress)) return rejectUpgrade(socket);
      return deviceServer.handleUpgrade(request, socket, head, ws => { attachDeviceSocket(ws as LiveSocket); deviceServer.emit('connection', ws, request); });
    }
    if (pathname === '/api/playback-sessions/ws' && !options.lan) {
      if (!controllerOriginAllowed(request)) return rejectUpgrade(socket);
      return controllerServer.handleUpgrade(request, socket, head, ws => { attachControllerSocket(ws as LiveSocket); controllerServer.emit('connection', ws, request); });
    }
    rejectUpgrade(socket, 404, 'Not Found');
  });
  startHeartbeat();
}

export function dispatchDeviceCommand(deviceId: string, command: string, payload: unknown = {}) {
  const id = queueDeviceCommand(deviceId, command, payload);
  const socket = deviceSockets.get(deviceId);
  if (socket) send(socket, { type: 'command', id, command, payload, createdAt: new Date().toISOString() });
  return id;
}

export function broadcastPlaybackSession(session: PlaybackSession | null) {
  const canonical = session ? getActivePlaybackSession(session.userId) || session : null;
  for (const socket of controllerServer.clients as Set<LiveSocket>) {
    if (!canonical || socket.userId === canonical.userId) send(socket, { type: 'session', session: sessionSnapshot(canonical) });
  }
}

// Timeout rollbacks originate outside a request/socket handler. Forward the
// restored source session so controllers see it reappear immediately.
onPlaybackTransferRollback(activeSession => broadcastPlaybackSession(activeSession));

export function closePlaybackWebSockets() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  for (const server of [deviceServer, controllerServer]) for (const socket of server.clients) socket.close(1001, 'Server wordt afgesloten');
}

export const playbackWebSocketInternals = { safeMessage, rejectUpgrade, controllerOriginAllowed, deviceSockets };
