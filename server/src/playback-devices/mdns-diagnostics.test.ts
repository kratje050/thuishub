import { describe, expect, it } from 'vitest';
import { createThuisHubMdnsAnnouncement } from './mdns-advertiser.js';
import {
  createMdnsPtrQuery,
  mdnsDiagnosticsInternals,
  mdnsQueryRequestsService,
  mdnsResponseContainsService,
} from './mdns-diagnostics.js';

describe('mDNS-diagnostiek', () => {
  it('maakt een PTR-query met unicast-responsebit zonder apparaat-IP-scanner', () => {
    const query = createMdnsPtrQuery('_googlecast._tcp.local');
    expect(query.readUInt16BE(4)).toBe(1);
    expect(query.subarray(-4).readUInt16BE(0)).toBe(12);
    expect(query.subarray(-2).readUInt16BE(0)).toBe(0x8001);
    expect(mdnsDiagnosticsInternals.dnsName('_googlecast._tcp.local').includes(Buffer.from('_googlecast'))).toBe(true);
  });

  it('accepteert alleen een echte DNS-respons met een PTR-record voor de gevraagde service', () => {
    const announcement = createThuisHubMdnsAnnouncement('192.168.1.10', 8788, 'Test');
    expect(mdnsResponseContainsService(announcement, '_thuishub._tcp.local')).toBe(true);
    expect(mdnsResponseContainsService(announcement, '_googlecast._tcp.local')).toBe(false);
    expect(mdnsResponseContainsService(createMdnsPtrQuery('_thuishub._tcp.local'), '_thuishub._tcp.local')).toBe(false);
    expect(mdnsResponseContainsService(Buffer.from('_thuishub._tcp.local'), '_thuishub._tcp.local')).toBe(false);

    const malformedPointer = Buffer.alloc(24);
    malformedPointer.writeUInt16BE(0x8400, 2);
    malformedPointer.writeUInt16BE(1, 6);
    malformedPointer[12] = 0xc0;
    malformedPointer[13] = 0xff;
    expect(mdnsResponseContainsService(malformedPointer, '_thuishub._tcp.local')).toBe(false);
  });

  it('herkent uitsluitend een geldige PTR/ANY-query voor de eigen service', () => {
    expect(mdnsQueryRequestsService(createMdnsPtrQuery('_thuishub._tcp.local'), '_thuishub._tcp.local')).toBe(true);
    expect(mdnsQueryRequestsService(createMdnsPtrQuery('_googlecast._tcp.local'), '_thuishub._tcp.local')).toBe(false);
    expect(mdnsQueryRequestsService(createThuisHubMdnsAnnouncement('192.168.1.10', 8788, 'Test'), '_thuishub._tcp.local')).toBe(false);
  });
});
