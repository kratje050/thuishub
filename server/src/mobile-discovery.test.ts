import { describe, expect, it } from 'vitest';
import {
  createMobileDiscoveryResponse,
  isMobileDiscoveryRequest,
  THUISHUB_DISCOVERY_REQUEST,
} from './mobile-discovery.js';

describe('snelle mobiele ThuisHub-detectie', () => {
  it('geeft uitsluitend het beperkte lokale serveradres terug', () => {
    const response = JSON.parse(createMobileDiscoveryResponse('192.168.1.44', 8788).toString('utf8'));
    expect(response).toMatchObject({ app: 'thuishub', status: 'ok', url: 'http://192.168.1.44:8788' });
    expect(response.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('beantwoordt alleen het exacte verzoek vanaf hetzelfde privé-subnet', () => {
    const request = Buffer.from(THUISHUB_DISCOVERY_REQUEST);
    expect(isMobileDiscoveryRequest(request, '192.168.1.90', '192.168.1.44', '255.255.255.0')).toBe(true);
    expect(isMobileDiscoveryRequest(Buffer.from('ander-verzoek'), '192.168.1.90', '192.168.1.44', '255.255.255.0')).toBe(false);
    expect(isMobileDiscoveryRequest(request, '192.168.2.90', '192.168.1.44', '255.255.255.0')).toBe(false);
    expect(isMobileDiscoveryRequest(request, '8.8.8.8', '192.168.1.44', '255.255.255.0')).toBe(false);
  });

  it('weigert publieke serveradressen en ongeldige poorten', () => {
    expect(() => createMobileDiscoveryResponse('8.8.8.8', 8788)).toThrow(/privé/i);
    expect(() => createMobileDiscoveryResponse('192.168.1.44', 0)).toThrow(/poort/i);
  });
});
