import dgram from 'node:dgram';
import os from 'node:os';
import { APP_VERSION } from '../constants.js';
import { getSetting } from '../db.js';
import { assignedPrivateInterface, isPrivateIpv4, lanStreamingStatus, sameIpv4Subnet } from '../network.js';
import { log } from '../logger.js';
import { mdnsQueryRequestsService } from './mdns-diagnostics.js';

const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;
const SERVICE = '_thuishub._tcp.local';
let socket: dgram.Socket | null = null;
let bindingSocket: dgram.Socket | null = null;

function name(value: string) {
  return Buffer.concat([...value.replace(/\.$/, '').split('.').map(label => {
    const bytes = Buffer.from(label.slice(0, 63), 'utf8');
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  }), Buffer.from([0])]);
}

function record(recordName: string, type: number, klass: number, ttl: number, data: Buffer) {
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(klass, 2);
  header.writeUInt32BE(ttl, 4);
  header.writeUInt16BE(data.length, 8);
  return Buffer.concat([name(recordName), header, data]);
}

function txt(values: string[]) {
  return Buffer.concat(values.map(value => {
    const data = Buffer.from(value.slice(0, 255), 'utf8');
    return Buffer.concat([Buffer.from([data.length]), data]);
  }));
}

function ipv4Bytes(address: string) { return Buffer.from(address.split('.').map(Number)); }

export function isMdnsClientAllowed(remoteAddress: string, selectedAddress: string, netmask: string) {
  return sameIpv4Subnet(remoteAddress, selectedAddress, netmask);
}

export function createThuisHubMdnsAnnouncement(address: string, port: number, serverName: string) {
  if (!isPrivateIpv4(address)) throw new Error('mDNS-advertentie vereist een priv\u00e9 IPv4-adres.');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('mDNS-advertentie vereist een geldige TCP-poort.');
  const safeServerName = serverName.replace(/[.\\/\u0000-\u001f]/g, ' ').trim().slice(0, 40) || 'ThuisHub';
  const instance = `${safeServerName} (${os.hostname().slice(0, 24)}).${SERVICE}`;
  const host = `${os.hostname().replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 50) || 'thuishub'}.local`;
  const srv = Buffer.alloc(6);
  srv.writeUInt16BE(0, 0); srv.writeUInt16BE(0, 2); srv.writeUInt16BE(port, 4);
  const answers = [
    record(SERVICE, 12, 1, 120, name(instance)),
    record(instance, 33, 0x8001, 120, Buffer.concat([srv, name(host)])),
    record(instance, 16, 0x8001, 120, txt([`version=${APP_VERSION}`, 'path=/api/health', 'pairing=6-digit', 'protocol=http'])),
    record(host, 1, 0x8001, 120, ipv4Bytes(address)),
  ];
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(answers.length, 6);
  return Buffer.concat([header, ...answers]);
}

export function startThuisHubMdnsAdvertisement() {
  if (socket || bindingSocket || getSetting('automaticDeviceDiscovery', 'true') !== 'true' || getSetting('localStreamingEnabled', 'false') !== 'true') return;
  if (!lanStreamingStatus().listening) return;
  const address = getSetting('localStreamingAddress', '');
  const port = Number(getSetting('localStreamingPort', '8788'));
  const selectedInterface = assignedPrivateInterface(address);
  if (!isPrivateIpv4(address) || !selectedInterface || !Number.isInteger(port) || port < 1 || port > 65_535) return;
  const announcement = createThuisHubMdnsAnnouncement(address, port, getSetting('serverName', 'ThuisHub'));
  const active = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  bindingSocket = active;
  active.on('error', error => {
    if (socket === active) socket = null;
    if (bindingSocket === active) bindingSocket = null;
    log('WARNING', 'tv-discovery', 'mDNS-advertentie is niet beschikbaar.', { error: error.message, address });
    try { active.close(); } catch {}
  });
  active.on('message', (message, remote) => {
    if (!isMdnsClientAllowed(remote.address, address, selectedInterface.netmask)) return;
    if (!mdnsQueryRequestsService(message, SERVICE)) return;
    active.send(announcement, remote.port, remote.address, () => undefined);
  });
  active.bind(MDNS_PORT, address, () => {
    if (bindingSocket !== active) {
      try { active.close(); } catch {}
      return;
    }
    try {
      active.addMembership(MDNS_ADDRESS, address);
      active.setMulticastInterface(address);
      active.setMulticastTTL(255);
      active.send(announcement, MDNS_PORT, MDNS_ADDRESS, () => undefined);
      socket = active;
      bindingSocket = null;
      log('INFO', 'tv-discovery', 'ThuisHub-server is via mDNS vindbaar voor tv-apps.', { address, port, service: SERVICE });
    } catch (error) {
      log('WARNING', 'tv-discovery', 'mDNS-advertentie kon niet starten.', { error: error instanceof Error ? error.message : String(error), address });
      bindingSocket = null;
      active.close();
    }
  });
}

export async function stopThuisHubMdnsAdvertisement() {
  const activeSockets = [...new Set([socket, bindingSocket].filter((entry): entry is dgram.Socket => Boolean(entry)))];
  socket = null;
  bindingSocket = null;
  await Promise.all(activeSockets.map(current => new Promise<void>(resolve => {
    try { current.close(() => resolve()); } catch { resolve(); }
  })));
}

export const mdnsAdvertiserInternals = { name, record, txt, serviceWire: name(SERVICE) };
