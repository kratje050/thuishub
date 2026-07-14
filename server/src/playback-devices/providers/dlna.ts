import crypto from 'node:crypto';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import net from 'node:net';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { APP_VERSION } from '../../constants.js';
import { assignedPrivateInterface, isValidIpv4Netmask, sameIpv4Subnet } from '../../network.js';
import type { DeviceCapabilities } from '../../playback.js';
import type { PlaybackDiscoveryProvider } from '../discovery-service.js';
import { capabilityProfileFor } from '../profiles.js';

export const DLNA_SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:schemas-upnp-org:service:AVTransport:1',
  'urn:schemas-upnp-org:service:RenderingControl:1',
] as const;

const SSDP_HOST = '239.255.255.250';
const SSDP_PORT = 1900;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;

export type DlnaServiceEndpoint = {
  serviceType: string;
  controlUrl: string;
  interfaceAddress?: string;
  interfaceNetmask?: string;
};

export type DlnaNetworkScope = { address: string; netmask: string };

export type DlnaDevice = {
  id: string;
  name: string;
  protocol: 'dlna-upnp';
  deviceType: 'television';
  manufacturer: string;
  model: string;
  modelNumber: string;
  address: string;
  interfaceAddress?: string;
  interfaceNetmask?: string;
  port: number;
  online: true;
  lastSeen: string;
  capabilities: DeviceCapabilities & {
    play: true;
    pause: true;
    stop: true;
    seek: true;
    position: true;
    volume: boolean;
    connectionManager: boolean;
  };
  icon: 'tv';
  requiresPairing: false;
  udn: string;
  protocolId: string;
  protocolIds: string[];
  descriptionUrl: string;
  presentationUrl?: string;
  services: {
    avTransport: DlnaServiceEndpoint;
    renderingControl?: DlnaServiceEndpoint;
    connectionManager?: DlnaServiceEndpoint;
  };
};

export type SsdpResponse = {
  sourceAddress: string;
  location: string;
  searchTarget: string;
  usn: string;
  server?: string;
};

export type SsdpNotification = {
  kind: 'alive' | 'update' | 'byebye';
  sourceAddress: string;
  notificationType: string;
  usn: string;
  location?: string;
};

export type DnsLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export type SsdpSearch = (options: { address: string; netmask: string; timeoutMs: number; targets: readonly string[] }) => Promise<SsdpResponse[]>;

export type DiscoverDlnaOptions = {
  address: string;
  netmask?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  lookup?: DnsLookup;
  ssdpSearch?: SsdpSearch;
  now?: () => Date;
  onSsdpEvidence?: (response: SsdpResponse) => void;
  onError?: (error: Error, response?: SsdpResponse) => void;
};

type LocalFetchOptions = {
  fetcher?: typeof fetch;
  lookup?: DnsLookup;
  expectedSourceAddress?: string;
  networkScope?: DlnaNetworkScope;
  timeoutMs?: number;
  maxBytes?: number;
  method?: string;
  headers?: HeadersInit;
  body?: string;
};

const defaultLookup: DnsLookup = async hostname => {
  const entries = await dns.lookup(hostname, { all: true, verbatim: true });
  return entries.map(entry => ({ address: entry.address, family: entry.family }));
};

function cleanText(value: unknown, maxLength = 160) {
  const decoded = String(value ?? '')
    .replace(/&#(x?[0-9a-f]+);/gi, (_match, raw: string) => {
      const hex = raw[0]?.toLowerCase() === 'x';
      const point = Number.parseInt(hex ? raw.slice(1) : raw, hex ? 16 : 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&(amp|lt|gt|quot|apos);/gi, (_match, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity.toLowerCase()] || '');
  return decoded.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function isPrivateDlnaIpv4(value: string) {
  if (net.isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}

export function resolveDlnaNetworkScope(address: string, netmask?: string): DlnaNetworkScope {
  if (!isPrivateDlnaIpv4(address)) throw new Error('DLNA vereist een gekozen priv\u00e9 IPv4-interface.');
  const selectedNetmask = netmask || assignedPrivateInterface(address)?.netmask || '';
  if (!isValidIpv4Netmask(selectedNetmask)) throw new Error('De gekozen DLNA-interface is niet actief of heeft geen geldige IPv4-netmasker.');
  return { address, netmask: selectedNetmask };
}

export function isAddressInDlnaScope(address: string, scope: DlnaNetworkScope) {
  return isPrivateDlnaIpv4(address) && sameIpv4Subnet(address, scope.address, scope.netmask);
}

function normalizedHostname(value: string) {
  return value.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

export async function assertSafeDlnaUrl(
  input: string | URL,
  expectedSourceAddress?: string,
  lookup: DnsLookup = defaultLookup,
  networkScope?: DlnaNetworkScope,
) {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('DLNA-URL is ongeldig.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('DLNA-URL gebruikt geen HTTP of HTTPS.');
  if (url.username || url.password) throw new Error('DLNA-URL met gebruikersgegevens is geweigerd.');
  const hostname = normalizedHostname(url.hostname);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('DLNA-URL naar localhost is geweigerd.');
  if (expectedSourceAddress && !isPrivateDlnaIpv4(expectedSourceAddress)) throw new Error('SSDP-antwoord kwam niet van een privé-LAN-adres.');

  if (networkScope) {
    resolveDlnaNetworkScope(networkScope.address, networkScope.netmask);
    if (expectedSourceAddress && !isAddressInDlnaScope(expectedSourceAddress, networkScope)) {
      throw new Error('SSDP-antwoord kwam niet van hetzelfde IPv4-subnet als de gekozen interface.');
    }
  }

  const ipFamily = net.isIP(hostname);
  const resolved = ipFamily ? [{ address: hostname, family: ipFamily }] : await lookup(hostname);
  if (!resolved.length || resolved.some(entry => entry.family !== 4 || !isPrivateDlnaIpv4(entry.address))) {
    throw new Error('DLNA-URL verwijst niet uitsluitend naar een privé IPv4-adres.');
  }
  if (networkScope && resolved.some(entry => !isAddressInDlnaScope(entry.address, networkScope))) {
    throw new Error('DLNA-URL verwijst buiten het IPv4-subnet van de gekozen interface.');
  }
  if (expectedSourceAddress && !resolved.some(entry => entry.address === expectedSourceAddress)) {
    throw new Error('DLNA-URL verwijst niet naar het apparaat dat het SSDP-antwoord stuurde.');
  }
  // Pin a validated hostname to its private IPv4 address before the HTTP
  // request. This closes the DNS-rebinding window between validation and fetch.
  if (!ipFamily) url.hostname = expectedSourceAddress || resolved[0].address;
  return url;
}

async function readBoundedBody(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('DLNA-antwoord is groter dan toegestaan.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('DLNA-antwoord is groter dan toegestaan.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: false }).decode(combined);
}

async function fetchLocalText(input: string | URL, options: LocalFetchOptions = {}) {
  const url = await assertSafeDlnaUrl(input, options.expectedSourceAddress, options.lookup || defaultLookup, options.networkScope);
  const timeoutMs = Math.min(15_000, Math.max(250, options.timeoutMs ?? 4_000));
  const maxBytes = Math.min(2 * 1024 * 1024, Math.max(1_024, options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher || fetch)(url, {
      method: options.method || 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': `ThuisHub/${APP_VERSION}`, Accept: 'text/xml, application/xml, */*;q=0.1', ...(options.headers || {}) },
      body: options.body,
    });
    if (response.status >= 300 && response.status < 400) throw new Error('Redirect van een DLNA-apparaat is geweigerd.');
    const text = await readBoundedBody(response, maxBytes);
    if (!response.ok) {
      const code = cleanText(text.match(/<(?:\w+:)?errorCode>([^<]+)</i)?.[1], 32);
      const description = cleanText(text.match(/<(?:\w+:)?errorDescription>([^<]+)</i)?.[1], 160);
      const detail = [code && `UPnP ${code}`, description].filter(Boolean).join(': ');
      throw new DlnaHttpError(`DLNA-apparaat gaf HTTP-status ${response.status}${detail ? ` (${detail})` : ''}.`, response.status);
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('DLNA-verzoek is verlopen.');
    throw error;
  } finally { clearTimeout(timer); }
}

class DlnaHttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'DlnaHttpError';
  }
}

class DlnaSoapFaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DlnaSoapFaultError';
  }
}

function parseXml(xml: string) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('XML met DOCTYPE of ENTITY is geweigerd.');
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validation !== true) throw new Error('DLNA-apparaat gaf ongeldige XML.');
  return new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    processEntities: false,
    trimValues: true,
    parseTagValue: false,
  }).parse(xml) as Record<string, any>;
}

function values<T>(input: T | T[] | undefined): T[] {
  if (input === undefined || input === null) return [];
  return Array.isArray(input) ? input : [input];
}

function findMediaRenderer(input: any): any | null {
  for (const device of values(input)) {
    if (!device || typeof device !== 'object') continue;
    if (/^urn:schemas-upnp-org:device:MediaRenderer:\d+$/i.test(String(device.deviceType || ''))) return device;
    const embedded = findMediaRenderer(device.deviceList?.device);
    if (embedded) return embedded;
  }
  return null;
}

function serviceKind(serviceType: string) {
  if (/^urn:schemas-upnp-org:service:AVTransport:\d+$/i.test(serviceType)) return 'avTransport' as const;
  if (/^urn:schemas-upnp-org:service:RenderingControl:\d+$/i.test(serviceType)) return 'renderingControl' as const;
  if (/^urn:schemas-upnp-org:service:ConnectionManager:\d+$/i.test(serviceType)) return 'connectionManager' as const;
  return null;
}

export async function parseDlnaDeviceDescription(xml: string, context: {
  descriptionUrl: string;
  sourceAddress: string;
  interfaceAddress?: string;
  interfaceNetmask?: string;
  usn?: string;
  lookup?: DnsLookup;
  now?: () => Date;
}) {
  const networkScope = context.interfaceAddress && context.interfaceNetmask
    ? resolveDlnaNetworkScope(context.interfaceAddress, context.interfaceNetmask)
    : undefined;
  const parsed = parseXml(xml);
  const root = parsed.root;
  const renderer = findMediaRenderer(root?.device);
  if (!renderer) throw new Error('UPnP-apparaat is geen MediaRenderer.');
  const descriptionUrl = await assertSafeDlnaUrl(context.descriptionUrl, context.sourceAddress, context.lookup || defaultLookup, networkScope);
  const baseCandidate = cleanText(root?.URLBase, 2_048);
  const baseUrl = baseCandidate ? new URL(baseCandidate, descriptionUrl) : descriptionUrl;
  await assertSafeDlnaUrl(baseUrl, context.sourceAddress, context.lookup || defaultLookup, networkScope);

  const endpoints: Partial<DlnaDevice['services']> = {};
  for (const service of values<any>(renderer.serviceList?.service)) {
    const serviceType = cleanText(service?.serviceType, 200);
    const kind = serviceKind(serviceType);
    const controlPath = cleanText(service?.controlURL, 2_048);
    if (!kind || !controlPath) continue;
    const controlUrl = new URL(controlPath, baseUrl);
    await assertSafeDlnaUrl(controlUrl, context.sourceAddress, context.lookup || defaultLookup, networkScope);
    endpoints[kind] = {
      serviceType,
      controlUrl: controlUrl.toString(),
      ...(networkScope ? { interfaceAddress: networkScope.address, interfaceNetmask: networkScope.netmask } : {}),
    };
  }
  if (!endpoints.avTransport) throw new Error('MediaRenderer biedt geen veilige AVTransport-service.');

  const udn = cleanText(renderer.UDN || context.usn?.split('::')[0], 240);
  if (!/^uuid:[a-z0-9._:-]{4,220}$/i.test(udn)) throw new Error('MediaRenderer heeft geen geldige UDN.');
  let presentationUrl: string | undefined;
  const presentationPath = cleanText(renderer.presentationURL, 2_048);
  if (presentationPath) {
    try {
      const safePresentation = await assertSafeDlnaUrl(new URL(presentationPath, baseUrl), context.sourceAddress, context.lookup || defaultLookup, networkScope);
      presentationUrl = safePresentation.toString();
    } catch { /* Een optionele onveilige presentatiepagina wordt niet opgeslagen. */ }
  }

  const stableId = crypto.createHash('sha256').update(udn.toLowerCase()).digest('hex').slice(0, 32);
  const protocolIds = [...new Set([udn, cleanText(context.usn, 300)].filter(Boolean))];
  const manufacturer = cleanText(renderer.manufacturer, 100);
  const model = cleanText(renderer.modelName, 100);
  const detectedCapabilities = capabilityProfileFor({ protocol: 'dlna-upnp', manufacturer, model });
  const device: DlnaDevice = {
    id: `dlna-${stableId}`,
    name: cleanText(renderer.friendlyName, 100) || 'DLNA MediaRenderer',
    protocol: 'dlna-upnp',
    deviceType: 'television',
    manufacturer,
    model,
    modelNumber: cleanText(renderer.modelNumber, 100),
    address: context.sourceAddress,
    interfaceAddress: networkScope?.address,
    interfaceNetmask: networkScope?.netmask,
    port: Number(descriptionUrl.port || (descriptionUrl.protocol === 'https:' ? 443 : 80)),
    online: true,
    lastSeen: (context.now || (() => new Date()))().toISOString(),
    capabilities: {
      ...detectedCapabilities,
      play: true, pause: true, stop: true, seek: true, position: true,
      volume: Boolean(endpoints.renderingControl),
      connectionManager: Boolean(endpoints.connectionManager),
    },
    icon: 'tv',
    requiresPairing: false,
    udn,
    protocolId: udn,
    protocolIds,
    descriptionUrl: descriptionUrl.toString(),
    presentationUrl,
    services: endpoints as DlnaDevice['services'],
  };
  return device;
}

export function parseSsdpResponse(payload: Buffer | string, sourceAddress: string, networkScope?: DlnaNetworkScope): SsdpResponse | null {
  if (!isPrivateDlnaIpv4(sourceAddress)) return null;
  if (networkScope && !isAddressInDlnaScope(sourceAddress, networkScope)) return null;
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
  if (Buffer.byteLength(text, 'utf8') > 65_507) return null;
  const lines = text.split(/\r?\n/);
  if (!/^HTTP\/1\.[01]\s+200\b/i.test(lines.shift() || '')) return null;
  const headers = new Map<string, string>();
  for (const line of lines) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    if (!headers.has(key)) headers.set(key, line.slice(index + 1).trim());
  }
  const location = cleanText(headers.get('location'), 2_048);
  const searchTarget = cleanText(headers.get('st'), 300);
  const usn = cleanText(headers.get('usn'), 300);
  if (!location || !usn || !/(?:MediaRenderer|AVTransport|RenderingControl)/i.test(searchTarget)) return null;
  if (/(?:InternetGatewayDevice|WANIPConnection|WANPPPConnection)/i.test(`${searchTarget} ${usn}`)) return null;
  return { sourceAddress, location, searchTarget, usn, server: cleanText(headers.get('server'), 300) || undefined };
}

export function parseSsdpNotification(payload: Buffer | string, sourceAddress: string, networkScope?: DlnaNetworkScope): SsdpNotification | null {
  if (!isPrivateDlnaIpv4(sourceAddress)) return null;
  if (networkScope && !isAddressInDlnaScope(sourceAddress, networkScope)) return null;
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
  if (Buffer.byteLength(text, 'utf8') > 65_507) return null;
  const lines = text.split(/\r?\n/);
  if (!/^NOTIFY\s+\*\s+HTTP\/1\.[01]$/i.test((lines.shift() || '').trim())) return null;
  const headers = new Map<string, string>();
  for (const line of lines) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    if (!headers.has(key)) headers.set(key, line.slice(index + 1).trim());
  }
  const notificationType = cleanText(headers.get('nt'), 300);
  const nts = cleanText(headers.get('nts'), 40).toLowerCase();
  const usn = cleanText(headers.get('usn'), 300);
  if (!/(?:MediaRenderer|AVTransport|RenderingControl)/i.test(notificationType) || !usn) return null;
  if (/(?:InternetGatewayDevice|WANIPConnection|WANPPPConnection)/i.test(`${notificationType} ${usn}`)) return null;
  const kind = nts === 'ssdp:alive' ? 'alive' : nts === 'ssdp:update' ? 'update' : nts === 'ssdp:byebye' ? 'byebye' : null;
  if (!kind) return null;
  const location = cleanText(headers.get('location'), 2_048) || undefined;
  if (kind !== 'byebye' && !location) return null;
  return { kind, sourceAddress, notificationType, usn, location };
}

export type DlnaSsdpMonitorOptions = {
  address: string;
  netmask?: string;
  lookup?: DnsLookup;
  onAlive?: (notification: SsdpNotification) => void | Promise<void>;
  onByebye?: (notification: SsdpNotification) => void | Promise<void>;
  onError?: (error: Error) => void;
};

export class DlnaSsdpMonitor {
  private socket?: dgram.Socket;
  private readonly networkScope: DlnaNetworkScope;
  constructor(private readonly options: DlnaSsdpMonitorOptions) {
    this.networkScope = resolveDlnaNetworkScope(options.address, options.netmask);
  }

  start() {
    if (this.socket) return Promise.resolve();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('error', error => this.options.onError?.(error));
    socket.on('message', (message, remote) => {
      const notification = parseSsdpNotification(message, remote.address, this.networkScope);
      if (!notification) return;
      void (async () => {
        if (notification.kind !== 'byebye' && notification.location) {
          const safe = await assertSafeDlnaUrl(notification.location, notification.sourceAddress, this.options.lookup || defaultLookup, this.networkScope);
          notification.location = safe.toString();
        } else if (notification.kind === 'byebye') notification.location = undefined;
        if (notification.kind === 'byebye') await this.options.onByebye?.(notification);
        else await this.options.onAlive?.(notification);
      })().catch(error => this.options.onError?.(error instanceof Error ? error : new Error(String(error))));
    });
    return new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => { this.stop(); reject(error); };
      socket.once('error', fail);
      socket.bind(SSDP_PORT, this.options.address, () => {
        socket.off('error', fail);
        try {
          socket.addMembership(SSDP_HOST, this.options.address);
          socket.setMulticastInterface(this.options.address);
          resolve();
        } catch (error) { fail(error as Error); }
      });
    });
  }

  async stop() {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    try { socket.dropMembership(SSDP_HOST, this.options.address); } catch {}
    await new Promise<void>(resolve => {
      try { socket.close(() => resolve()); } catch { resolve(); }
    });
  }
}

export const searchSsdpMediaRenderers: SsdpSearch = ({ address, netmask, timeoutMs, targets }) => new Promise((resolve, reject) => {
  let networkScope: DlnaNetworkScope;
  try { networkScope = resolveDlnaNetworkScope(address, netmask); } catch (error) { return reject(error); }
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const responses = new Map<string, SsdpResponse>();
  let timer: NodeJS.Timeout | undefined;
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    try { socket.close(); } catch {}
    if (error) reject(error); else resolve([...responses.values()]);
  };
  socket.on('error', error => finish(error));
  socket.on('message', (message, remote) => {
    const parsed = parseSsdpResponse(message, remote.address, networkScope);
    if (parsed && responses.size < 256) responses.set(`${parsed.sourceAddress}\n${parsed.location}\n${parsed.usn}`, parsed);
  });
  socket.bind(0, address, () => {
    try { socket.setMulticastInterface(address); socket.setMulticastTTL(2); } catch (error) { return finish(error as Error); }
    for (const target of targets) {
      const message = Buffer.from([
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_HOST}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 1',
        `ST: ${target}`,
        '', '',
      ].join('\r\n'));
      socket.send(message, SSDP_PORT, SSDP_HOST, error => { if (error) finish(error); });
    }
    timer = setTimeout(() => finish(), Math.min(10_000, Math.max(250, timeoutMs)));
  });
});

async function mapWithLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R | undefined>) {
  const results: R[] = [];
  let index = 0;
  async function run() {
    while (index < items.length) {
      const item = items[index++];
      const result = await worker(item);
      if (result !== undefined) results.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function discoverDlnaDevices(options: DiscoverDlnaOptions): Promise<DlnaDevice[]> {
  const networkScope = resolveDlnaNetworkScope(options.address, options.netmask);
  const timeoutMs = Math.min(10_000, Math.max(250, options.timeoutMs ?? 2_000));
  const responses = await (options.ssdpSearch || searchSsdpMediaRenderers)({
    address: networkScope.address,
    netmask: networkScope.netmask,
    timeoutMs,
    targets: DLNA_SEARCH_TARGETS,
  });
  const uniqueResponses = [...new Map(responses.slice(0, 128).map(response => [`${response.sourceAddress}\n${response.location}`, response])).values()];
  const devices = await mapWithLimit(uniqueResponses, 4, async response => {
    try {
      if (!isAddressInDlnaScope(response.sourceAddress, networkScope)) {
        throw new Error('SSDP-antwoord kwam niet van hetzelfde IPv4-subnet als de gekozen interface.');
      }
      const location = await assertSafeDlnaUrl(response.location, response.sourceAddress, options.lookup || defaultLookup, networkScope);
      options.onSsdpEvidence?.(response);
      const xml = await fetchLocalText(location, {
        fetcher: options.fetcher,
        lookup: options.lookup,
        expectedSourceAddress: response.sourceAddress,
        networkScope,
        timeoutMs: Math.min(5_000, timeoutMs + 1_000),
      });
      return await parseDlnaDeviceDescription(xml, {
        descriptionUrl: location.toString(), sourceAddress: response.sourceAddress, usn: response.usn,
        interfaceAddress: networkScope.address, interfaceNetmask: networkScope.netmask,
        lookup: options.lookup, now: options.now,
      });
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)), response);
      return undefined;
    }
  });
  return [...new Map(devices.map(device => [device.id, device])).values()];
}

export function createDlnaDiscoveryProvider(options: Omit<DiscoverDlnaOptions, 'address'> = {}): PlaybackDiscoveryProvider {
  return {
    id: 'dlna-upnp',
    protocols: ['dlna-upnp'] as Array<'dlna-upnp'>,
    async discover(address: string) {
      const startedAt = new Date().toISOString();
      const errors: string[] = [];
      let validSsdpResponses = 0;
      const devices = await discoverDlnaDevices({
        ...options,
        address,
        onSsdpEvidence(response) {
          validSsdpResponses += 1;
          options.onSsdpEvidence?.(response);
        },
        onError(error, response) {
          errors.push(error.message);
          options.onError?.(error, response);
        },
      });
      return {
        provider: 'dlna-upnp',
        startedAt,
        finishedAt: new Date().toISOString(),
        multicastAvailable: validSsdpResponses > 0 ? true : undefined,
        error: errors[0],
        devices: devices.map(device => ({
          id: device.id,
          name: device.name,
          protocol: device.protocol,
          deviceType: device.deviceType,
          manufacturer: device.manufacturer,
          model: device.model,
          address: device.address,
          port: device.port,
          capabilities: device.capabilities,
          icon: device.icon,
          requiresPairing: device.requiresPairing,
          protocolId: device.udn,
          udn: device.udn,
          lastSeen: device.lastSeen,
          metadata: {
            modelNumber: device.modelNumber,
            interfaceAddress: device.interfaceAddress,
            interfaceNetmask: device.interfaceNetmask,
            descriptionUrl: device.descriptionUrl,
            presentationUrl: device.presentationUrl,
            services: device.services,
          },
        })),
      };
    },
  };
}

function escapeXml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

function durationText(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor(total % 3_600 / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function durationSeconds(value: unknown) {
  const match = String(value || '').match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) return 0;
  return Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
}

function findXmlValue(input: any, key: string): unknown {
  if (!input || typeof input !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  for (const value of Object.values(input)) {
    const found = findXmlValue(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

export type DlnaControllerOptions = {
  fetcher?: typeof fetch;
  lookup?: DnsLookup;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type DlnaControllerTarget = Pick<DlnaDevice, 'address' | 'services'> & Partial<Pick<DlnaDevice, 'interfaceAddress' | 'interfaceNetmask'>>;

export type DlnaTransportInfo = {
  state: string;
  status: string;
  speed: string;
};

export type DlnaPlaybackConfirmationOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export const DLNA_PLAYBACK_CONFIRMATION_TIMEOUT_MS = 8_000;
export const DLNA_PLAYBACK_CONFIRMATION_POLL_MS = 250;

export class DlnaPlaybackConfirmationError extends Error {
  constructor(
    message: string,
    public readonly code: 'DLNA_PLAYBACK_STOPPED' | 'DLNA_PLAYBACK_STATUS_ERROR' | 'DLNA_PLAYBACK_CONFIRMATION_TIMEOUT',
    public readonly transport?: DlnaTransportInfo,
  ) {
    super(message);
    this.name = 'DlnaPlaybackConfirmationError';
  }
}

function boundedMilliseconds(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
}

function sleep(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

async function beforeDeadline<T>(operation: () => Promise<T>, deadline: number, lastTransport?: DlnaTransportInfo) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new DlnaPlaybackConfirmationError(
      'De DLNA-tv bevestigde PLAYING niet binnen de toegestane tijd.',
      'DLNA_PLAYBACK_CONFIRMATION_TIMEOUT',
      lastTransport,
    );
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DlnaPlaybackConfirmationError(
          'De DLNA-tv bevestigde PLAYING niet binnen de toegestane tijd.',
          'DLNA_PLAYBACK_CONFIRMATION_TIMEOUT',
          lastTransport,
        )), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A successful SOAP Play response only acknowledges the command. It does not
 * prove that the renderer has started the media. Poll AVTransport until the
 * receiver itself reports PLAYING, with one deadline covering all polls.
 */
export async function waitForDlnaPlaying(
  controller: Pick<DlnaController, 'getTransportInfo'>,
  options: DlnaPlaybackConfirmationOptions = {},
) {
  const timeoutMs = boundedMilliseconds(options.timeoutMs, DLNA_PLAYBACK_CONFIRMATION_TIMEOUT_MS, 50, 30_000);
  const pollIntervalMs = boundedMilliseconds(options.pollIntervalMs, DLNA_PLAYBACK_CONFIRMATION_POLL_MS, 10, 2_000);
  const deadline = Date.now() + timeoutMs;
  let lastTransport: DlnaTransportInfo | undefined;

  while (Date.now() < deadline) {
    try {
      lastTransport = await beforeDeadline(() => controller.getTransportInfo(), deadline, lastTransport);
    } catch (error) {
      if (error instanceof DlnaPlaybackConfirmationError) throw error;
      throw new DlnaPlaybackConfirmationError(
        `De DLNA-tv kon zijn afspeelstatus niet bevestigen: ${error instanceof Error ? error.message : String(error)}`,
        'DLNA_PLAYBACK_STATUS_ERROR',
        lastTransport,
      );
    }

    const state = String(lastTransport.state || '').trim().toUpperCase();
    const status = String(lastTransport.status || '').trim().toUpperCase();
    if (state === 'PLAYING') return lastTransport;
    if (state === 'STOPPED' || state === 'NO_MEDIA_PRESENT') {
      throw new DlnaPlaybackConfirmationError(
        `De DLNA-tv meldde ${state} voordat het afspelen begon.`,
        'DLNA_PLAYBACK_STOPPED',
        lastTransport,
      );
    }
    if (state.includes('ERROR') || status.includes('ERROR')) {
      throw new DlnaPlaybackConfirmationError(
        'De DLNA-tv meldde een fout tijdens het starten.',
        'DLNA_PLAYBACK_STATUS_ERROR',
        lastTransport,
      );
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }

  throw new DlnaPlaybackConfirmationError(
    'De DLNA-tv bevestigde PLAYING niet binnen de toegestane tijd.',
    'DLNA_PLAYBACK_CONFIRMATION_TIMEOUT',
    lastTransport,
  );
}

export class DlnaController {
  constructor(public readonly device: DlnaControllerTarget, private readonly options: DlnaControllerOptions = {}) {
    if (!isPrivateDlnaIpv4(device.address)) throw new Error('DLNA-controller vereist een privé apparaatadres.');
  }

  private networkScope(service: DlnaServiceEndpoint) {
    const address = service.interfaceAddress || this.device.interfaceAddress;
    const netmask = service.interfaceNetmask || this.device.interfaceNetmask;
    if (!address || !netmask) throw new Error('DLNA-interfacebinding ontbreekt; detecteer dit apparaat opnieuw.');
    const scope = resolveDlnaNetworkScope(address, netmask);
    if (!isAddressInDlnaScope(this.device.address, scope)) throw new Error('DLNA-apparaat valt buiten het subnet van de gekozen interface.');
    return scope;
  }

  private async soap(service: DlnaServiceEndpoint | undefined, action: string, argumentsXml: string) {
    if (!service) throw new Error(`DLNA-apparaat ondersteunt ${action} niet.`);
    const requiredKind = action === 'SetVolume' ? 'renderingControl' : action === 'GetProtocolInfo' ? 'connectionManager' : 'avTransport';
    if (serviceKind(service.serviceType) !== requiredKind) throw new Error('Onjuist DLNA-servicetype is geweigerd.');
    const envelope = `<?xml version="1.0" encoding="utf-8"?>` +
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
      `<s:Body><u:${action} xmlns:u="${escapeXml(service.serviceType)}">${argumentsXml}</u:${action}></s:Body></s:Envelope>`;
    const response = await fetchLocalText(service.controlUrl, {
      fetcher: this.options.fetcher,
      lookup: this.options.lookup,
      expectedSourceAddress: this.device.address,
      networkScope: this.networkScope(service),
      timeoutMs: this.options.timeoutMs ?? 4_000,
      maxBytes: this.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${service.serviceType}#${action}"` },
      body: envelope,
    });
    if (response.trim()) parseXml(response);
    if (/<(?:\w+:)?Fault\b/i.test(response)) {
      const code = cleanText(response.match(/<(?:\w+:)?errorCode>([^<]+)</i)?.[1], 32);
      const description = cleanText(response.match(/<(?:\w+:)?errorDescription>([^<]+)</i)?.[1], 160);
      const detail = [code && `UPnP ${code}`, description].filter(Boolean).join(': ');
      throw new DlnaSoapFaultError(`DLNA-apparaat weigerde ${action}${detail ? ` (${detail})` : ''}.`);
    }
    return response;
  }

  async setTransportUri(uri: string, metadata = '') {
    const safeUri = await assertSafeDlnaUrl(
      uri,
      undefined,
      this.options.lookup || defaultLookup,
      this.networkScope(this.device.services.avTransport),
    );
    if (Buffer.byteLength(metadata, 'utf8') > 64 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(metadata)) throw new Error('Onveilige of te grote DLNA-metadata is geweigerd.');
    const send = (value: string) => this.soap(this.device.services.avTransport, 'SetAVTransportURI',
      `<InstanceID>0</InstanceID><CurrentURI>${escapeXml(safeUri.toString())}</CurrentURI><CurrentURIMetaData>${escapeXml(value)}</CurrentURIMetaData>`);
    try {
      await send(metadata);
    } catch (error) {
      // Samsung- en enkele oudere DLNA-renderers melden HTTP 500 wanneer ze
      // DIDL-Lite niet herkennen, terwijl dezelfde URI zonder metadata werkt.
      const mayRetryWithoutMetadata = Boolean(metadata) && (
        error instanceof DlnaSoapFaultError || error instanceof DlnaHttpError && error.status === 500
      );
      if (!mayRetryWithoutMetadata) throw error;
      await send('');
    }
  }

  async play(input?: string | { uri?: string; metadata?: string }) {
    const uri = typeof input === 'string' ? input : input?.uri;
    if (uri) await this.setTransportUri(uri, typeof input === 'object' ? input.metadata || '' : '');
    await this.soap(this.device.services.avTransport, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>');
  }

  async pause() { await this.soap(this.device.services.avTransport, 'Pause', '<InstanceID>0</InstanceID>'); }
  async stop() { await this.soap(this.device.services.avTransport, 'Stop', '<InstanceID>0</InstanceID>'); }

  async seek(positionSeconds: number) {
    await this.soap(this.device.services.avTransport, 'Seek',
      `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${durationText(positionSeconds)}</Target>`);
  }

  async getPosition() {
    const xml = await this.soap(this.device.services.avTransport, 'GetPositionInfo', '<InstanceID>0</InstanceID>');
    const parsed = xml ? parseXml(xml) : {};
    return {
      positionSeconds: durationSeconds(findXmlValue(parsed, 'RelTime')),
      durationSeconds: durationSeconds(findXmlValue(parsed, 'TrackDuration')),
      track: Number(findXmlValue(parsed, 'Track') || 0),
      uri: cleanText(findXmlValue(parsed, 'TrackURI'), 2_048),
    };
  }

  async getTransportInfo(): Promise<DlnaTransportInfo> {
    const xml = await this.soap(this.device.services.avTransport, 'GetTransportInfo', '<InstanceID>0</InstanceID>');
    const parsed = xml ? parseXml(xml) : {};
    return {
      state: cleanText(findXmlValue(parsed, 'CurrentTransportState'), 80),
      status: cleanText(findXmlValue(parsed, 'CurrentTransportStatus'), 80),
      speed: cleanText(findXmlValue(parsed, 'CurrentSpeed'), 20),
    };
  }

  async getProtocolInfo() {
    const xml = await this.soap(this.device.services.connectionManager, 'GetProtocolInfo', '');
    const parsed = xml ? parseXml(xml) : {};
    return {
      source: cleanText(findXmlValue(parsed, 'Source'), 16_384),
      sink: cleanText(findXmlValue(parsed, 'Sink'), 16_384),
    };
  }

  async setVolume(level: number) {
    if (!Number.isFinite(level)) throw new Error('Volume is ongeldig.');
    const percent = Math.max(0, Math.min(100, Math.round(level <= 1 ? level * 100 : level)));
    await this.soap(this.device.services.renderingControl, 'SetVolume',
      `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${percent}</DesiredVolume>`);
    return percent;
  }
}

export const dlnaInternals = {
  fetchLocalText,
  parseXml,
  durationText,
  durationSeconds,
};
