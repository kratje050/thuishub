import os from 'node:os';
import type { Express, Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import { getSetting } from './db.js';
import { log } from './logger.js';
import { APP_PORT } from './constants.js';

let activeLanServer: Server | null = null;
let activeLanAddress = '';
let activeLanPort = 0;
let activeExternalServer: Server | null = null;
let activeExternalAddress = '';
let activeExternalPort = 0;
let externalApp: Express | null = null;

export function isPrivateIpv4(value: string) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

export function assignedPrivateAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((entry): entry is os.NetworkInterfaceInfo => Boolean(entry && entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address))).map(entry => entry.address);
}

function ipv4Number(value: string) {
  return value.split('.').reduce((total, part) => (total << 8) + Number(part), 0) >>> 0;
}

export function isValidIpv4Netmask(value: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const mask = ipv4Number(value);
  const hostBits = (~mask) >>> 0;
  return mask !== 0 && (hostBits & (hostBits + 1)) === 0;
}

export function sameIpv4Subnet(left: string, right: string, netmask: string) {
  if (!isPrivateIpv4(left) || !isPrivateIpv4(right) || !isValidIpv4Netmask(netmask)) return false;
  return (ipv4Number(left) & ipv4Number(netmask)) === (ipv4Number(right) & ipv4Number(netmask));
}

export function assignedPrivateInterface(address: string) {
  if (!isPrivateIpv4(address)) return undefined;
  return Object.values(os.networkInterfaces()).flat().find((entry): entry is os.NetworkInterfaceInfo => Boolean(
    entry && entry.family === 'IPv4' && !entry.internal && entry.address === address && isValidIpv4Netmask(entry.netmask),
  ));
}

export function isLanClientAllowed(remoteAddress: string | undefined, selectedAddress = getSetting('localStreamingAddress', '')) {
  const remote = String(remoteAddress || '').replace(/^::ffff:/, '');
  if (!isPrivateIpv4(remote) || !isPrivateIpv4(selectedAddress)) return false;
  const local = assignedPrivateInterface(selectedAddress);
  return Boolean(local && sameIpv4Subnet(remote, selectedAddress, local.netmask));
}

function allowedLanRequest(method: string, requestPath: string) {
  const routeRules: Array<[RegExp, string[]]> = [
    [/^\/api\/health$/, ['GET']],
    [/^\/api\/playback\/\d+\/(?:file(?:\.mp4)?|dlna(?:\.ts)?|download|subtitle|artwork|hls\/[a-zA-Z0-9._-]+)$/, ['GET', 'HEAD', 'OPTIONS']],
    [/^\/api\/devices\/pair\/(?:request|claim)$/, ['POST']],
    [/^\/api\/device\/commands$/, ['GET']],
    [/^\/api\/device\/commands\/\d+\/ack$/, ['POST']],
    [/^\/api\/device\/library$/, ['GET']],
    [/^\/api\/device\/media\/\d+\/artwork$/, ['GET', 'HEAD']],
    [/^\/api\/device\/media\/\d+\/session$/, ['POST']],
    [/^\/api\/device\/media\/\d+\/decision$/, ['POST']],
    [/^\/api\/device\/media\/\d+\/progress$/, ['PUT']],
    [/^\/api\/device\/discovery$/, ['GET']],
    [/^\/(?:cast|brand)\//, ['GET', 'HEAD']],
    [/^\/manifest\.webmanifest$/, ['GET', 'HEAD']],
  ];
  return routeRules.some(([pattern, methods]) => pattern.test(requestPath) && methods.includes(method.toUpperCase()));
}

// De routerpoort gebruikt dezelfde streng beperkte media/device-API als de
// LAN-poort. Beheer, instellingen, gebruikers en het dashboard vallen hier
// nadrukkelijk niet onder.
const allowedExternalRequest = allowedLanRequest;

function normalizedSocketAddress(value: string | undefined) {
  return String(value || '').replace(/^::ffff:/, '');
}

export function isLanListenerEndpoint(localAddress: string | undefined, localPort: number | undefined, address: string, port: number) {
  return normalizedSocketAddress(localAddress) === address && Number(localPort) === port;
}

export function isValidLanStreamingPort(value: unknown, managementPort = Number(process.env.PORT || APP_PORT)) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65_535 && port !== managementPort;
}

export function restrictLanListener(req: Request, res: Response, next: NextFunction) {
  // Base the trust boundary on the listener that is actually running. Settings
  // can change before the required restart and must never make this listener
  // fall through to the unrestricted management application.
  if (activeExternalServer?.listening && isLanListenerEndpoint(req.socket.localAddress, req.socket.localPort, activeExternalAddress, activeExternalPort)) {
    if (allowedExternalRequest(req.method, req.path)) return next();
    return res.status(403).json({ error: 'De externe poort geeft uitsluitend beperkte afspeel- en apparaat toegang.' });
  }
  if (!activeLanServer?.listening || !isLanListenerEndpoint(req.socket.localAddress, req.socket.localPort, activeLanAddress, activeLanPort)) return next();
  if (!isLanClientAllowed(req.socket.remoteAddress, activeLanAddress)) return res.status(403).json({ error: 'Deze streamingpoort is alleen bereikbaar vanaf hetzelfde priv\u00e9-thuisnetwerk.' });
  if (allowedLanRequest(req.method, req.path)) return next();
  res.status(403).json({ error: 'De lokale streamingpoort geeft uitsluitend beperkte afspeeltoegang.' });
}

export function externalStreamingStatus() {
  const address = getSetting('localStreamingAddress', '');
  const port = Number(getSetting('externalAccessPort', '8790'));
  return {
    enabled: getSetting('externalAccessMode', 'home') === 'router',
    address,
    port,
    listening: Boolean(activeExternalServer?.listening && activeExternalAddress === address && activeExternalPort === port),
  };
}

export function startExternalStreamingServer(app: Express): Server | null {
  externalApp = app;
  if (getSetting('externalAccessMode', 'home') !== 'router') return null;
  const address = getSetting('localStreamingAddress', '');
  const port = Number(getSetting('externalAccessPort', '8790'));
  if (!isValidLanStreamingPort(port) || !isPrivateIpv4(address) || !assignedPrivateAddresses().includes(address)) {
    log('ERROR', 'streaming', 'Externe streamingpoort kon niet starten: controleer het LAN-adres en de aparte externe poort.', { address, port });
    return null;
  }
  const server = app.listen(port, address, () => log('INFO', 'streaming', 'Beperkte externe streamingpoort gestart.', { address, port }));
  activeExternalServer = server; activeExternalAddress = address; activeExternalPort = port;
  const clear = () => { if (activeExternalServer === server) { activeExternalServer = null; activeExternalAddress = ''; activeExternalPort = 0; } };
  server.on('error', error => { clear(); log('ERROR', 'streaming', 'Externe streamingpoort kon niet luisteren.', { address, port, error: error.message }); });
  server.on('close', clear);
  return server;
}

export async function reconfigureExternalStreamingServer() {
  const desired = externalStreamingStatus();
  if (activeExternalServer?.listening && (!desired.enabled || activeExternalAddress !== desired.address || activeExternalPort !== desired.port)) {
    const server = activeExternalServer;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  if (!desired.enabled || activeExternalServer?.listening || !externalApp) return externalStreamingStatus();
  const server = startExternalStreamingServer(externalApp);
  if (!server) return externalStreamingStatus();
  await new Promise<void>(resolve => {
    if (server.listening) return resolve();
    server.once('listening', () => resolve());
    server.once('error', () => resolve());
  });
  return externalStreamingStatus();
}

export function lanStreamingStatus() {
  const configuredAddress = getSetting('localStreamingAddress', '');
  const configuredPort = Number(getSetting('localStreamingPort', '8788'));
  return {
    enabled: getSetting('localStreamingEnabled', 'false') === 'true',
    address: configuredAddress,
    port: configuredPort,
    addressPresent: isPrivateIpv4(configuredAddress) && assignedPrivateAddresses().includes(configuredAddress),
    listening: Boolean(activeLanServer?.listening && activeLanAddress === configuredAddress && activeLanPort === configuredPort),
  };
}

export function playbackBaseUrlForStatus(status: ReturnType<typeof lanStreamingStatus>) {
  if (!status.enabled || !status.addressPresent || !status.listening || !isPrivateIpv4(status.address)) return null;
  if (!Number.isInteger(status.port) || status.port < 1 || status.port > 65_535) return null;
  return `http://${status.address}:${status.port}`;
}

export function lanPlaybackBaseUrl() {
  return playbackBaseUrlForStatus(lanStreamingStatus());
}

export function startLanStreamingServer(app: Express): Server | null {
  if (getSetting('localStreamingEnabled', 'false') !== 'true') return null;
  const address = getSetting('localStreamingAddress', '');
  const port = Number(getSetting('localStreamingPort', '8788'));
  if (!isValidLanStreamingPort(port)) {
    log('ERROR', 'streaming', 'Lokale streaming niet gestart: de streamingpoort is ongeldig of gelijk aan de beheerpoort.', { address, port });
    return null;
  }
  if (!isPrivateIpv4(address) || !assignedPrivateAddresses().includes(address)) {
    log('ERROR', 'streaming', 'Lokale streaming niet gestart: gekozen privé-LAN-adres is niet op deze pc aanwezig.', { address, port });
    return null;
  }
  const server = app.listen(port, address, () => {
    log('INFO', 'streaming', 'Beperkte lokale streamingpoort gestart.', { address, port });
  });
  activeLanServer = server;
  activeLanAddress = address;
  activeLanPort = port;
  server.on('error', error => {
    if (activeLanServer === server) { activeLanServer = null; activeLanAddress = ''; activeLanPort = 0; }
    log('ERROR', 'streaming', 'Lokale streamingpoort kon niet starten.', { address, port, error: error.message });
  });
  server.on('close', () => {
    if (activeLanServer === server) { activeLanServer = null; activeLanAddress = ''; activeLanPort = 0; }
  });
  return server;
}

export const networkInternals = { allowedLanRequest, allowedExternalRequest, ipv4Number };
