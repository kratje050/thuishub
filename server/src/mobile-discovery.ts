import dgram from 'node:dgram';
import { APP_VERSION } from './constants.js';
import { getSetting } from './db.js';
import { log } from './logger.js';
import { assignedPrivateInterface, isPrivateIpv4, lanStreamingStatus, sameIpv4Subnet } from './network.js';

export const THUISHUB_DISCOVERY_PORT = 8789;
export const THUISHUB_DISCOVERY_REQUEST = 'THUISHUB_DISCOVER_V1';

let socket: dgram.Socket | null = null;
let bindingSocket: dgram.Socket | null = null;

export function isMobileDiscoveryRequest(message: Buffer, remoteAddress: string, selectedAddress: string, netmask: string) {
  return message.length === Buffer.byteLength(THUISHUB_DISCOVERY_REQUEST)
    && message.toString('utf8') === THUISHUB_DISCOVERY_REQUEST
    && sameIpv4Subnet(remoteAddress.replace(/^::ffff:/, ''), selectedAddress, netmask);
}

export function createMobileDiscoveryResponse(address: string, port: number) {
  if (!isPrivateIpv4(address)) throw new Error('Mobiele ontdekking vereist een privé IPv4-adres.');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Mobiele ontdekking vereist een geldige TCP-poort.');
  return Buffer.from(JSON.stringify({
    app: 'thuishub',
    status: 'ok',
    version: APP_VERSION,
    url: `http://${address}:${port}`,
  }), 'utf8');
}

export function startMobileDiscoveryResponder() {
  if (socket || bindingSocket || getSetting('automaticDeviceDiscovery', 'true') !== 'true' || getSetting('localStreamingEnabled', 'false') !== 'true') return;
  const status = lanStreamingStatus();
  if (!status.listening) return;
  const selectedInterface = assignedPrivateInterface(status.address);
  if (!selectedInterface) return;
  const response = createMobileDiscoveryResponse(status.address, status.port);
  const active = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  bindingSocket = active;
  active.on('error', error => {
    if (socket === active) socket = null;
    if (bindingSocket === active) bindingSocket = null;
    log('WARNING', 'tv-discovery', 'Snelle mobiele netwerkdetectie is niet beschikbaar.', { error: error.message, address: status.address });
    try { active.close(); } catch {}
  });
  active.on('message', (message, remote) => {
    if (!isMobileDiscoveryRequest(message, remote.address, status.address, selectedInterface.netmask)) return;
    active.send(response, remote.port, remote.address, () => undefined);
  });
  active.bind(THUISHUB_DISCOVERY_PORT, '0.0.0.0', () => {
    if (bindingSocket !== active) {
      try { active.close(); } catch {}
      return;
    }
    try {
      active.setBroadcast(true);
      socket = active;
      bindingSocket = null;
      log('INFO', 'tv-discovery', 'ThuisHub reageert op snelle mobiele netwerkdetectie.', {
        address: status.address,
        port: status.port,
        discoveryPort: THUISHUB_DISCOVERY_PORT,
      });
    } catch (error) {
      bindingSocket = null;
      log('WARNING', 'tv-discovery', 'Snelle mobiele netwerkdetectie kon niet starten.', {
        error: error instanceof Error ? error.message : String(error),
        address: status.address,
      });
      active.close();
    }
  });
}

export async function stopMobileDiscoveryResponder() {
  const activeSockets = [...new Set([socket, bindingSocket].filter((entry): entry is dgram.Socket => Boolean(entry)))];
  socket = null;
  bindingSocket = null;
  await Promise.all(activeSockets.map(current => new Promise<void>(resolve => {
    try { current.close(() => resolve()); } catch { resolve(); }
  })));
}
