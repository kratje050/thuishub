import dgram from 'node:dgram';
import { assignedPrivateInterface, isPrivateIpv4, sameIpv4Subnet } from '../network.js';

function normalizedDnsName(value: string) {
  return value.replace(/\.$/, '').toLowerCase();
}

function dnsName(name: string) {
  const labels = name.replace(/\.$/, '').split('.');
  return Buffer.concat([...labels.map(label => {
    const value = Buffer.from(label, 'utf8');
    if (value.length > 63) throw new Error('mDNS-label is te lang.');
    return Buffer.concat([Buffer.from([value.length]), value]);
  }), Buffer.from([0])]);
}

function readDnsName(packet: Buffer, startOffset: number) {
  let offset = startOffset;
  let nextOffset = startOffset;
  let jumped = false;
  let decodedBytes = 0;
  const labels: string[] = [];
  const visited = new Set<number>();
  while (true) {
    if (offset >= packet.length || visited.has(offset)) throw new Error('Ongeldige gecomprimeerde DNS-naam.');
    visited.add(offset);
    const length = packet[offset];
    if (length === 0) {
      if (!jumped) nextOffset = offset + 1;
      break;
    }
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= packet.length) throw new Error('Afgebroken DNS-pointer.');
      const pointer = (length & 0x3f) << 8 | packet[offset + 1];
      if (pointer >= packet.length) throw new Error('DNS-pointer valt buiten het pakket.');
      if (!jumped) nextOffset = offset + 2;
      jumped = true;
      offset = pointer;
      continue;
    }
    if ((length & 0xc0) !== 0 || length > 63 || offset + 1 + length > packet.length) throw new Error('Ongeldig DNS-label.');
    decodedBytes += length + 1;
    if (decodedBytes > 255 || labels.length >= 127) throw new Error('DNS-naam is te lang.');
    labels.push(packet.subarray(offset + 1, offset + 1 + length).toString('utf8'));
    offset += 1 + length;
    if (!jumped) nextOffset = offset;
  }
  return { name: normalizedDnsName(labels.join('.')), nextOffset };
}

function dnsHeaderCounts(packet: Buffer) {
  if (packet.length < 12 || packet.length > 65_507) throw new Error('Ongeldig DNS-pakket.');
  const counts = {
    questions: packet.readUInt16BE(4),
    answers: packet.readUInt16BE(6),
    authorities: packet.readUInt16BE(8),
    additionals: packet.readUInt16BE(10),
  };
  if (counts.questions > 64 || counts.answers + counts.authorities + counts.additionals > 512) throw new Error('DNS-pakket bevat te veel records.');
  return counts;
}

export function mdnsQueryRequestsService(packet: Buffer, service: string) {
  try {
    const counts = dnsHeaderCounts(packet);
    const flags = packet.readUInt16BE(2);
    if ((flags & 0x8000) !== 0 || (flags & 0x7800) !== 0 || counts.questions < 1) return false;
    const expected = normalizedDnsName(service);
    let offset = 12;
    for (let index = 0; index < counts.questions; index += 1) {
      const question = readDnsName(packet, offset);
      offset = question.nextOffset;
      if (offset + 4 > packet.length) return false;
      const type = packet.readUInt16BE(offset);
      const klass = packet.readUInt16BE(offset + 2) & 0x7fff;
      offset += 4;
      if (question.name === expected && klass === 1 && (type === 12 || type === 255)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function mdnsResponseContainsService(packet: Buffer, service: string) {
  try {
    const counts = dnsHeaderCounts(packet);
    const flags = packet.readUInt16BE(2);
    if ((flags & 0x8000) === 0 || (flags & 0x7800) !== 0 || (flags & 0x000f) !== 0) return false;
    const expected = normalizedDnsName(service);
    let offset = 12;
    for (let index = 0; index < counts.questions; index += 1) {
      const question = readDnsName(packet, offset);
      offset = question.nextOffset + 4;
      if (offset > packet.length) return false;
    }
    const recordCount = counts.answers + counts.authorities + counts.additionals;
    for (let index = 0; index < recordCount; index += 1) {
      const owner = readDnsName(packet, offset);
      offset = owner.nextOffset;
      if (offset + 10 > packet.length) return false;
      const type = packet.readUInt16BE(offset);
      const klass = packet.readUInt16BE(offset + 2) & 0x7fff;
      const length = packet.readUInt16BE(offset + 8);
      const dataOffset = offset + 10;
      const dataEnd = dataOffset + length;
      if (dataEnd > packet.length) return false;
      if (owner.name === expected && type === 12 && klass === 1 && length > 0) {
        const target = readDnsName(packet, dataOffset).name;
        if (target !== expected && target.endsWith(`.${expected}`)) return true;
      }
      offset = dataEnd;
    }
    return false;
  } catch {
    return false;
  }
}

export function createMdnsPtrQuery(service: string) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(Math.floor(Math.random() * 0xffff), 0);
  header.writeUInt16BE(1, 4);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(12, 0); // PTR
  question.writeUInt16BE(0x8001, 2); // IN + unicast-response bit
  return Buffer.concat([header, dnsName(service), question]);
}

export async function probeMdnsService(service: string, address: string, timeoutMs = 1200) {
  const selectedInterface = assignedPrivateInterface(address);
  if (!isPrivateIpv4(address) || !selectedInterface) {
    return { service, visible: false, responses: 0, error: 'Geen actieve priv\u00e9-LAN-interface geselecteerd.' };
  }
  return await new Promise<{ service: string; visible: boolean; responses: number; error?: string }>(resolve => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const senders = new Set<string>();
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve({ service, visible: senders.size > 0, responses: senders.size, ...(error ? { error } : {}) });
    };
    timer = setTimeout(() => finish(), Math.min(5000, Math.max(200, timeoutMs)));
    socket.on('message', (message, remote) => {
      if (sameIpv4Subnet(remote.address, address, selectedInterface.netmask) && mdnsResponseContainsService(message, service)) {
        senders.add(remote.address);
      }
    });
    socket.once('error', error => finish(error.message));
    socket.bind(0, address, () => {
      try { socket.setMulticastInterface(address); } catch (error) { return finish(error instanceof Error ? error.message : String(error)); }
      socket.send(createMdnsPtrQuery(service), 5353, '224.0.0.251', error => { if (error) finish(error.message); });
    });
  });
}

export const mdnsDiagnosticsInternals = { dnsName, readDnsName, dnsHeaderCounts };
