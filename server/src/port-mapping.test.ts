import { describe, expect, it, vi } from 'vitest';
import { mapWithFallback, parseDefaultGateway, parseUpnpService } from './port-mapping.js';

const mapping = (protocol: 'upnp'|'nat-pmp') => ({ protocol, port:8790, address:'192.168.1.20', remove:vi.fn(async()=>undefined) });

describe('optionele externe routertoegang', () => {
  it('gebruikt UPnP wanneer de router dit aanbiedt', async () => {
    const result = await mapWithFallback(async()=>mapping('upnp'), async()=>mapping('nat-pmp'));
    expect(result.protocol).toBe('upnp');
  });

  it('valt terug op NAT-PMP wanneer UPnP niet beschikbaar is', async () => {
    const result = await mapWithFallback(async()=>{ throw new Error('geen IGD'); }, async()=>mapping('nat-pmp'));
    expect(result.protocol).toBe('nat-pmp');
  });

  it('meldt beide oorzaken wanneer geen routerprotocol beschikbaar is', async () => {
    await expect(mapWithFallback(async()=>{ throw new Error('geen IGD'); }, async()=>{ throw new Error('geen NAT-PMP'); })).rejects.toThrow(/UPnP mislukt.*NAT-PMP mislukt/);
  });

  it('leest alleen de WAN-service en een privé-standaardgateway', () => {
    const service = parseUpnpService('<root><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/upnp/control/wanip</controlURL></service></root>', 'http://192.168.1.1:5000/root.xml');
    expect(service.controlUrl).toBe('http://192.168.1.1:5000/upnp/control/wanip');
    expect(parseDefaultGateway('0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.20     25')).toBe('192.168.1.1');
  });
});
