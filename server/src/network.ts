import os from 'node:os';
import type { Express, Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import { getSetting } from './db.js';
import { log } from './logger.js';

export function isPrivateIpv4(value: string) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

export function assignedPrivateAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((entry): entry is os.NetworkInterfaceInfo => Boolean(entry && entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address))).map(entry => entry.address);
}

export function restrictLanListener(req: Request, res: Response, next: NextFunction) {
  const port = Number(getSetting('localStreamingPort', '8788'));
  if (req.socket.localPort !== port) return next();
  const allowed = ['/api/health', '/api/playback/', '/api/device/', '/api/devices/pair/', '/cast/', '/brand/', '/manifest.webmanifest'];
  if (allowed.some(prefix => req.path === prefix || req.path.startsWith(prefix))) return next();
  res.status(403).json({ error: 'De lokale streamingpoort geeft uitsluitend beperkte afspeeltoegang.' });
}

export function startLanStreamingServer(app: Express): Server | null {
  if (getSetting('localStreamingEnabled', 'false') !== 'true') return null;
  const address = getSetting('localStreamingAddress', '');
  const port = Number(getSetting('localStreamingPort', '8788'));
  if (!isPrivateIpv4(address) || !assignedPrivateAddresses().includes(address)) {
    log('ERROR', 'streaming', 'Lokale streaming niet gestart: gekozen privé-LAN-adres is niet op deze pc aanwezig.', { address, port });
    return null;
  }
  const server = app.listen(port, address, () => log('INFO', 'streaming', 'Beperkte lokale streamingpoort gestart.', { address, port }));
  server.on('error', error => log('ERROR', 'streaming', 'Lokale streamingpoort kon niet starten.', { address, port, error: error.message }));
  return server;
}
