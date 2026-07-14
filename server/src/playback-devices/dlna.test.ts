import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DlnaController,
  assertSafeDlnaUrl,
  createDlnaDiscoveryProvider,
  discoverDlnaDevices,
  parseDlnaDeviceDescription,
  parseSsdpNotification,
  parseSsdpResponse,
  type DlnaDevice,
  type SsdpResponse,
} from './providers/dlna.js';
import { runDlnaDiscoveryDiagnostics } from './diagnostics.js';

const subnet = { interfaceAddress: '192.168.1.10', interfaceNetmask: '255.255.255.0' };

const rendererXml = (extra = '') => `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <URLBase>http://192.168.1.40:9197/</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>Woonkamer TV</friendlyName>
    <manufacturer>Voorbeeld</manufacturer>
    <modelName>Renderer One</modelName>
    <modelNumber>R1</modelNumber>
    <UDN>uuid:renderer-1234</UDN>
    <presentationURL>/device</presentationURL>
    <serviceList>
      <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/upnp/avtransport</controlURL></service>
      <service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/upnp/rendering</controlURL></service>
      <service><serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType><controlURL>/upnp/connection</controlURL></service>
      ${extra}
    </serviceList>
  </device>
</root>`;

const response = (overrides: Partial<SsdpResponse> = {}): SsdpResponse => ({
  sourceAddress: '192.168.1.40',
  location: 'http://192.168.1.40:9197/description.xml',
  searchTarget: 'urn:schemas-upnp-org:device:MediaRenderer:1',
  usn: 'uuid:renderer-1234::urn:schemas-upnp-org:device:MediaRenderer:1',
  ...overrides,
});

describe('veilige DLNA-discovery', () => {
  it('ontdekt alleen een MediaRenderer en dedupliceert meerdere SSDP-antwoorden', async () => {
    const fetcher = vi.fn(async () => new Response(rendererXml(), { status: 200, headers: { 'content-type': 'text/xml' } })) as unknown as typeof fetch;
    const devices = await discoverDlnaDevices({
      address: '192.168.1.10',
      netmask: subnet.interfaceNetmask,
      ssdpSearch: async () => [response(), response({ searchTarget: 'urn:schemas-upnp-org:service:AVTransport:1' })],
      fetcher,
      now: () => new Date('2026-07-13T20:00:00.000Z'),
    });
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      name: 'Woonkamer TV', protocol: 'dlna-upnp', udn: 'uuid:renderer-1234', address: '192.168.1.40',
      capabilities: { volume: true, connectionManager: true }, lastSeen: '2026-07-13T20:00:00.000Z',
    });
    expect(devices[0].services.avTransport.controlUrl).toBe('http://192.168.1.40:9197/upnp/avtransport');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('weigert publieke, localhost- en bronafwijkende device-description URL\'s', async () => {
    const fetcher = vi.fn(async () => new Response(rendererXml())) as unknown as typeof fetch;
    const errors: string[] = [];
    const devices = await discoverDlnaDevices({
      address: '192.168.1.10',
      netmask: subnet.interfaceNetmask,
      ssdpSearch: async () => [
        response({ location: 'http://8.8.8.8/device.xml' }),
        response({ location: 'http://localhost/device.xml' }),
        response({ location: 'http://192.168.1.41/device.xml' }),
      ],
      fetcher,
      onError: error => errors.push(error.message),
    });
    expect(devices).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(errors).toHaveLength(3);
  });

  it('weigert een verder wel priv\u00e9 SSDP-apparaat buiten het geselecteerde /24-subnet', async () => {
    const fetcher = vi.fn(async () => new Response(rendererXml())) as unknown as typeof fetch;
    const errors: string[] = [];
    const devices = await discoverDlnaDevices({
      address: subnet.interfaceAddress,
      netmask: subnet.interfaceNetmask,
      ssdpSearch: async () => [response({
        sourceAddress: '192.168.2.40',
        location: 'http://192.168.2.40/device.xml',
      })],
      fetcher,
      onError: error => errors.push(error.message),
    });
    expect(devices).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(errors).toEqual([expect.stringMatching(/subnet/i)]);
  });

  it('rapporteert alleen multicastbewijs na een veilig same-subnet SSDP-antwoord', async () => {
    const noEvidence = await createDlnaDiscoveryProvider({
      netmask: subnet.interfaceNetmask,
      ssdpSearch: async () => [],
    }).discover(subnet.interfaceAddress);
    expect(noEvidence.multicastAvailable).toBeUndefined();

    const withEvidence = await createDlnaDiscoveryProvider({
      netmask: subnet.interfaceNetmask,
      ssdpSearch: async () => [response()],
      fetcher: (async () => new Response('<ongeldige-xml')) as typeof fetch,
    }).discover(subnet.interfaceAddress);
    expect(withEvidence.devices).toEqual([]);
    expect(withEvidence.multicastAvailable).toBe(true);

    const foreignPrivate = await createDlnaDiscoveryProvider({
      netmask: subnet.interfaceNetmask,
      ssdpSearch: async () => [response({ sourceAddress: '192.168.2.40', location: 'http://192.168.2.40/device.xml' })],
    }).discover(subnet.interfaceAddress);
    expect(foreignPrivate.multicastAvailable).toBeUndefined();
  });

  it('weigert XXE, DOCTYPE en een apparaat dat geen MediaRenderer is', async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>&xxe;</friendlyName></device></root>`;
    await expect(parseDlnaDeviceDescription(xxe, { descriptionUrl: response().location, sourceAddress: '192.168.1.40', ...subnet })).rejects.toThrow(/DOCTYPE|ENTITY/);
    const mediaServer = rendererXml().replace('device:MediaRenderer:1', 'device:MediaServer:1');
    await expect(parseDlnaDeviceDescription(mediaServer, { descriptionUrl: response().location, sourceAddress: '192.168.1.40', ...subnet })).rejects.toThrow(/geen MediaRenderer/);
  });

  it('decodeert uitsluitend ingebouwde XML-entiteiten in apparaatnamen', async () => {
    const device = await parseDlnaDeviceDescription(rendererXml().replace('Woonkamer TV', '65&amp;quot; QLED').replace('&amp;quot;', '&quot;'), {
      descriptionUrl: response().location,
      sourceAddress: '192.168.1.40',
      ...subnet,
    });
    expect(device.name).toBe('65" QLED');
  });

  it('kent het Samsung QE65QEF1AUXXN-profiel toe aan de DLNA-renderer', async () => {
    const xml = rendererXml()
      .replace('<manufacturer>Voorbeeld</manufacturer>', '<manufacturer>Samsung Electronics</manufacturer>')
      .replace('<modelName>Renderer One</modelName>', '<modelName>QE65QEF1AUXXN</modelName>');
    const device = await parseDlnaDeviceDescription(xml, { descriptionUrl: response().location, sourceAddress: '192.168.1.40', ...subnet });
    expect(device.capabilities).toMatchObject({ platform: 'tizen', maxWidth: 3840, maxAudioChannels: 6, eac3: true, connectionManager: true });
  });

  it('parseert alleen geldige SSDP MediaRenderer/service-antwoorden', () => {
    const valid = `HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.40/device.xml\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\nUSN: uuid:renderer-1234::urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n`;
    expect(parseSsdpResponse(valid, '192.168.1.40')).toMatchObject({ location: 'http://192.168.1.40/device.xml' });
    expect(parseSsdpResponse(valid, '8.8.8.8')).toBeNull();
    expect(parseSsdpResponse(valid.replaceAll('MediaRenderer', 'InternetGatewayDevice'), '192.168.1.40')).toBeNull();
    expect(parseSsdpResponse(valid, '192.168.1.40', { address: subnet.interfaceAddress, netmask: subnet.interfaceNetmask })).not.toBeNull();
    expect(parseSsdpResponse(valid, '192.168.2.40', { address: subnet.interfaceAddress, netmask: subnet.interfaceNetmask })).toBeNull();
  });

  it('herkent SSDP alive/byebye en negeert router-notificaties', () => {
    const notify = (nts: string, type = 'urn:schemas-upnp-org:device:MediaRenderer:1') => `NOTIFY * HTTP/1.1\r\nNT: ${type}\r\nNTS: ${nts}\r\nUSN: uuid:renderer-1234::${type}\r\nLOCATION: http://192.168.1.40/device.xml\r\n\r\n`;
    expect(parseSsdpNotification(notify('ssdp:alive'), '192.168.1.40')).toMatchObject({ kind: 'alive', usn: expect.stringContaining('renderer-1234') });
    expect(parseSsdpNotification(notify('ssdp:byebye'), '192.168.1.40')).toMatchObject({ kind: 'byebye' });
    expect(parseSsdpNotification(notify('ssdp:alive', 'urn:schemas-upnp-org:device:InternetGatewayDevice:1'), '192.168.1.1')).toBeNull();
    expect(parseSsdpNotification(notify('ssdp:alive'), '192.168.2.40', { address: subnet.interfaceAddress, netmask: subnet.interfaceNetmask })).toBeNull();
  });

  it('weigert redirects ook wanneer de bestemming lokaal lijkt', async () => {
    await expect((await import('./providers/dlna.js')).dlnaInternals.fetchLocalText('http://192.168.1.40/device.xml', {
      expectedSourceAddress: '192.168.1.40',
      fetcher: (async () => new Response('', { status: 302, headers: { location: 'http://192.168.1.40/other.xml' } })) as typeof fetch,
    })).rejects.toThrow(/Redirect/);
  });
});

describe('DLNA-controller', () => {
  it('voert SetURI, Play, Pause, Stop, Seek, positie en volume via begrensde SOAP uit', async () => {
    const device = await parseDlnaDeviceDescription(rendererXml(), {
      descriptionUrl: response().location,
      sourceAddress: '192.168.1.40',
      ...subnet,
    });
    const calls: Array<{ action: string; body: string }> = [];
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const action = headers.SOAPAction || '';
      calls.push({ action, body: String(init?.body || '') });
      if (action.includes('#GetPositionInfo')) return new Response(`<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><Track>2</Track><TrackDuration>01:02:03</TrackDuration><RelTime>00:01:05</RelTime><TrackURI>http://192.168.1.10:8788/api/playback/1/file</TrackURI></u:GetPositionInfoResponse></s:Body></s:Envelope>`);
      if (action.includes('#GetProtocolInfo')) return new Response(`<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:GetProtocolInfoResponse xmlns:u="urn:schemas-upnp-org:service:ConnectionManager:1"><Source></Source><Sink>http-get:*:video/mp4:*,http-get:*:video/mpeg:*</Sink></u:GetProtocolInfoResponse></s:Body></s:Envelope>`);
      return new Response(`<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/></s:Envelope>`);
    }) as typeof fetch;
    const controller = new DlnaController(device, { fetcher });
    await controller.play('http://192.168.1.10:8788/api/playback/1/file?token=verborgen');
    await controller.pause();
    await controller.stop();
    await controller.seek(65);
    const position = await controller.getPosition();
    const protocols = await controller.getProtocolInfo();
    expect(await controller.setVolume(0.42)).toBe(42);

    expect(calls.map(call => call.action)).toEqual(expect.arrayContaining([
      expect.stringContaining('#SetAVTransportURI'), expect.stringContaining('#Play'), expect.stringContaining('#Pause'),
      expect.stringContaining('#Stop'), expect.stringContaining('#Seek'), expect.stringContaining('#GetPositionInfo'), expect.stringContaining('#GetProtocolInfo'), expect.stringContaining('#SetVolume'),
    ]));
    expect(calls.find(call => call.action.includes('#Seek'))?.body).toContain('<Target>00:01:05</Target>');
    expect(calls.find(call => call.action.includes('#SetVolume'))?.body).toContain('<DesiredVolume>42</DesiredVolume>');
    expect(position).toMatchObject({ positionSeconds: 65, durationSeconds: 3_723, track: 2 });
    expect(protocols.sink).toContain('video/mp4');
    const count = calls.length;
    await expect(controller.setTransportUri('http://127.0.0.1:8787/api/playback/1/file')).rejects.toThrow(/privé|localhost/);
    expect(calls).toHaveLength(count);
  });

  it('probeert SetAVTransportURI bij Samsung HTTP 500 eenmalig opnieuw zonder metadata', async () => {
    const device = await parseDlnaDeviceDescription(rendererXml().replace('<manufacturer>Voorbeeld</manufacturer>', '<manufacturer>Samsung Electronics</manufacturer>'), {
      descriptionUrl: response().location,
      sourceAddress: '192.168.1.40',
      ...subnet,
    });
    const calls: Array<{ action: string; body: string }> = [];
    let setAttempts = 0;
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const action = headers.SOAPAction || '';
      calls.push({ action, body: String(init?.body || '') });
      if (action.includes('#SetAVTransportURI') && setAttempts++ === 0) {
        return new Response('<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>714</errorCode><errorDescription>Illegal MIME-type</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>', { status: 500 });
      }
      return new Response('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/></s:Envelope>');
    }) as typeof fetch;
    const controller = new DlnaController(device, { fetcher });

    await controller.play({
      uri: 'http://192.168.1.10:8788/api/playback/1/dlna?token=verborgen',
      metadata: '<DIDL-Lite><item><res protocolInfo="http-get:*:video/mpeg:*">film</res></item></DIDL-Lite>',
    });

    const setCalls = calls.filter(call => call.action.includes('#SetAVTransportURI'));
    expect(setCalls).toHaveLength(2);
    expect(setCalls[0].body).toContain('&lt;DIDL-Lite&gt;');
    expect(setCalls[1].body).toContain('<CurrentURIMetaData></CurrentURIMetaData>');
    expect(calls.at(-1)?.action).toContain('#Play');
  });

  it('toont de begrensde UPnP-foutcode wanneer ook een lege SetURI wordt geweigerd', async () => {
    const device = await parseDlnaDeviceDescription(rendererXml(), {
      descriptionUrl: response().location,
      sourceAddress: '192.168.1.40',
      ...subnet,
    });
    const fetcher = (async () => new Response(
      '<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>716</errorCode><errorDescription>Resource not found</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>',
      { status: 500 },
    )) as typeof fetch;
    await expect(new DlnaController(device, { fetcher }).setTransportUri('http://192.168.1.10:8788/api/playback/1/dlna'))
      .rejects.toThrow(/500.*UPnP 716.*Resource not found/i);
  });

  it('weigert een onveilig control endpoint opnieuw op het moment van bedienen', async () => {
    const device: DlnaDevice = {
      id: 'dlna-test', name: 'Test', protocol: 'dlna-upnp', deviceType: 'television', manufacturer: '', model: '', modelNumber: '',
      address: '192.168.1.40', port: 80, online: true, lastSeen: new Date().toISOString(), icon: 'tv', requiresPairing: false,
      udn: 'uuid:test-device', protocolId: 'uuid:test-device', protocolIds: ['uuid:test-device'], descriptionUrl: 'http://192.168.1.40/device.xml',
      ...subnet,
      capabilities: {
        platform: 'dlna', maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30, maxBitrateMbps: 20, containers: ['mp4'], videoCodecs: ['h264'],
        maxBitDepth: 8, hdrFormats: ['sdr'], dolbyVisionProfiles: [], audioCodecs: ['aac'], maxAudioChannels: 2, passthrough: false,
        atmos: false, trueHd: false, eac3: false, dts: false, subtitleFormats: ['none'], play: true, pause: true, stop: true,
        seek: true, position: true, volume: false, connectionManager: false,
      },
      services: { avTransport: {
        serviceType: 'urn:schemas-upnp-org:service:AVTransport:1', controlUrl: 'http://8.8.8.8/control',
        interfaceAddress: subnet.interfaceAddress, interfaceNetmask: subnet.interfaceNetmask,
      } },
    };
    await expect(new DlnaController(device, { fetcher: vi.fn() as unknown as typeof fetch }).play()).rejects.toThrow(/privé/);
  });

  it('weigert bediening wanneer een opgeslagen apparaat buiten de gebonden interface valt', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const services: DlnaDevice['services'] = {
      avTransport: {
        serviceType: 'urn:schemas-upnp-org:service:AVTransport:1',
        controlUrl: 'http://192.168.2.40/control',
        interfaceAddress: subnet.interfaceAddress,
        interfaceNetmask: subnet.interfaceNetmask,
      },
    };
    await expect(new DlnaController({ address: '192.168.2.40', services }, { fetcher }).play()).rejects.toThrow(/subnet/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('discoverydiagnostiek en scripts', () => {
  it('voert geen netwerkprobes uit voor een publiek adres', async () => {
    const discover = vi.fn();
    const tcpProbe = vi.fn();
    const result = await runDlnaDiscoveryDiagnostics({ address: '8.8.8.8', discover, tcpProbe });
    expect(result).toMatchObject({ interface: { private: false }, ssdp: { status: 'not-run' } });
    expect(discover).not.toHaveBeenCalled();
    expect(tcpProbe).not.toHaveBeenCalled();
  });

  it('houdt firewallregels beperkt en het diagnosescript alleen-lezen', () => {
    const configure = fs.readFileSync(path.resolve('scripts/configure-private-streaming.ps1'), 'utf8');
    const diagnose = fs.readFileSync(path.resolve('scripts/diagnose-tv-discovery.ps1'), 'utf8');
    expect(configure).toContain('-LocalAddress $Address');
    expect(configure).toContain('-RemoteAddress LocalSubnet');
    expect(configure).toContain('-Profile Private');
    expect(configure).toMatch(/Protocol = 'UDP'; LocalPort = 1900/);
    expect(configure).toMatch(/Protocol = 'UDP'; LocalPort = 5353/);
    expect(configure).toMatch(/Protocol = 'UDP'; LocalPort = 8789/);
    expect(configure).not.toMatch(/-Profile\s+(?:Public|Any)/i);
    expect(configure).not.toMatch(/-RemoteAddress\s+(?:Any|\*)/i);
    expect(diagnose).not.toMatch(/(?:New|Set|Remove)-NetFirewallRule/i);
    expect(diagnose).toMatch(/Discovery \(Mobile\).*'8789'/);
    expect(diagnose).not.toMatch(/(?:portforward|funnel)\s+(?:enable|on)/i);
  });
});

describe('URL-resolutie', () => {
  it('staat een lokale hostnaam alleen toe wanneer alle adressen privé zijn en de SSDP-bron overeenkomt', async () => {
    const lookup = async () => [{ address: '192.168.1.40', family: 4 }];
    const pinned = await assertSafeDlnaUrl('http://tv.local/device.xml', '192.168.1.40', lookup);
    expect(pinned.hostname).toBe('192.168.1.40');
    await expect(assertSafeDlnaUrl('http://tv.local/device.xml', '192.168.1.41', lookup)).rejects.toThrow(/SSDP-antwoord/);
    await expect(assertSafeDlnaUrl('http://tv.local/device.xml', '192.168.1.40', async () => [{ address: '8.8.8.8', family: 4 }])).rejects.toThrow(/privé/);
  });

  it('bindt bron, LOCATION en hostnaamresolutie aan het geselecteerde subnet', async () => {
    const scope = { address: subnet.interfaceAddress, netmask: subnet.interfaceNetmask };
    const sameSubnet = await assertSafeDlnaUrl(
      'http://tv.local/device.xml',
      '192.168.1.40',
      async () => [{ address: '192.168.1.40', family: 4 }],
      scope,
    );
    expect(sameSubnet.hostname).toBe('192.168.1.40');
    await expect(assertSafeDlnaUrl(
      'http://192.168.2.40/device.xml',
      '192.168.2.40',
      undefined,
      scope,
    )).rejects.toThrow(/subnet/i);
  });
});
