import { describe, expect, it } from 'vitest';
import { createThuisHubMdnsAnnouncement, isMdnsClientAllowed } from './mdns-advertiser.js';

describe('ThuisHub mDNS-advertentie', () => {
  it('bevat PTR, SRV, TXT en gekozen priv\u00e9-adres', () => {
    const packet = createThuisHubMdnsAnnouncement('192.168.1.44', 8788, 'ThuisHub test');
    expect(packet.readUInt16BE(2)).toBe(0x8400);
    expect(packet.readUInt16BE(6)).toBe(4);
    expect(packet.includes(Buffer.from('_thuishub'))).toBe(true);
    expect(packet.includes(Buffer.from([192, 168, 1, 44]))).toBe(true);
    expect(packet.includes(Buffer.from([0x22, 0x54]))).toBe(true); // 8788
  });

  it('beantwoordt alleen clients op hetzelfde geselecteerde subnet', () => {
    expect(isMdnsClientAllowed('192.168.1.90', '192.168.1.44', '255.255.255.0')).toBe(true);
    expect(isMdnsClientAllowed('192.168.2.90', '192.168.1.44', '255.255.255.0')).toBe(false);
    expect(isMdnsClientAllowed('10.0.0.90', '192.168.1.44', '255.255.255.0')).toBe(false);
  });
});
