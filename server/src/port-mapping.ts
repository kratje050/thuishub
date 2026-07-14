import dgram from 'node:dgram';
import { execFileSync } from 'node:child_process';
import { getSetting } from './db.js';
import { externalStreamingStatus, isPrivateIpv4 } from './network.js';
import { log } from './logger.js';

export type ExternalAccessMode = 'home' | 'router' | 'tailscale';
type Mapping = { protocol: 'upnp' | 'nat-pmp'; port: number; address: string; publicAddress?: string; remove: () => Promise<void> };
type MappingStatus = { mode: ExternalAccessMode; active: boolean; protocol: string; port: number; publicAddress: string; message: string; checkedAt: string };

let active: Mapping | null = null;
let renewalTimer: NodeJS.Timeout | null = null;
let status: MappingStatus = { mode: 'home', active: false, protocol: '', port: 0, publicAddress: '', message: 'Alleen bereikbaar binnen het thuisnetwerk.', checkedAt: new Date().toISOString() };

const xmlEscape = (value: string | number) => String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[character]!));

function ssdpLocation(timeoutMs = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => { socket.close(); reject(new Error('Geen UPnP IGD-router gevonden.')); }, timeoutMs);
    socket.on('message', message => {
      const match = message.toString('utf8').match(/^location:\s*(\S+)/im);
      if (!match) return;
      clearTimeout(timer); socket.close(); resolve(match[1]);
    });
    socket.on('error', error => { clearTimeout(timer); socket.close(); reject(error); });
    socket.bind(0, () => {
      const request = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n');
      socket.send(request, 1900, '239.255.255.250');
    });
  });
}

export function parseUpnpService(description: string, location: string) {
  for (const block of description.match(/<service>[\s\S]*?<\/service>/gi) || []) {
    const serviceType = block.match(/<serviceType>([^<]+)<\/serviceType>/i)?.[1]?.trim();
    const control = block.match(/<controlURL>([^<]+)<\/controlURL>/i)?.[1]?.trim();
    if (serviceType && control && /WAN(?:IP|PPP)Connection/i.test(serviceType)) return { serviceType, controlUrl: new URL(control, location).toString() };
  }
  throw new Error('De router publiceert geen ondersteunde WANIPConnection-service.');
}

async function soap(controlUrl: string, serviceType: string, action: string, values: Record<string,string|number>) {
  const fields = Object.entries(values).map(([key,value]) => `<${key}>${xmlEscape(value)}</${key}>`).join('');
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${serviceType}">${fields}</u:${action}></s:Body></s:Envelope>`;
  const response = await fetch(controlUrl, { method:'POST', headers:{ 'Content-Type':'text/xml; charset="utf-8"', SOAPAction:`"${serviceType}#${action}"` }, body, signal:AbortSignal.timeout(4000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`UPnP ${action} gaf HTTP ${response.status}.`);
  return text;
}

async function mapUpnp(address: string, port: number): Promise<Mapping> {
  const location = await ssdpLocation();
  const description = await (await fetch(location, { signal:AbortSignal.timeout(4000) })).text();
  const service = parseUpnpService(description, location);
  await soap(service.controlUrl, service.serviceType, 'AddPortMapping', {
    NewRemoteHost:'', NewExternalPort:port, NewProtocol:'TCP', NewInternalPort:port,
    NewInternalClient:address, NewEnabled:1, NewPortMappingDescription:'ThuisHub beperkte streaming', NewLeaseDuration:0,
  });
  let publicAddress = '';
  try { publicAddress = (await soap(service.controlUrl, service.serviceType, 'GetExternalIPAddress', {})).match(/<NewExternalIPAddress>([^<]+)</i)?.[1] || ''; } catch {}
  return { protocol:'upnp', port, address, publicAddress, remove:() => soap(service.controlUrl, service.serviceType, 'DeletePortMapping', { NewRemoteHost:'', NewExternalPort:port, NewProtocol:'TCP' }).then(() => undefined) };
}

export function parseDefaultGateway(output: string) {
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})\s+\d+$/);
    if (match && isPrivateIpv4(match[1])) return match[1];
  }
  return '';
}

function natPmpRequest(gateway: string, internalPort: number, externalPort: number, lifetime: number, timeoutMs = 1800): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const request = Buffer.alloc(12); request[1] = 2; request.writeUInt16BE(internalPort,4); request.writeUInt16BE(externalPort,6); request.writeUInt32BE(lifetime,8);
    const timer = setTimeout(() => { socket.close(); reject(new Error('NAT-PMP-router antwoordde niet.')); }, timeoutMs);
    socket.on('message', response => {
      if (response.length < 16 || response[1] !== 130) return;
      clearTimeout(timer); socket.close();
      const result = response.readUInt16BE(2); result === 0 ? resolve(response) : reject(new Error(`NAT-PMP foutcode ${result}.`));
    });
    socket.on('error', error => { clearTimeout(timer); socket.close(); reject(error); });
    socket.send(request, 5351, gateway);
  });
}

async function mapNatPmp(address: string, port: number): Promise<Mapping> {
  const gateway = parseDefaultGateway(execFileSync('route.exe', ['PRINT','-4','0.0.0.0'], { encoding:'utf8', windowsHide:true, timeout:3000 }));
  if (!gateway) throw new Error('Standaardgateway voor NAT-PMP niet gevonden.');
  const response = await natPmpRequest(gateway, port, port, 3600);
  const mappedPort = response.readUInt16BE(10) || port;
  return { protocol:'nat-pmp', port:mappedPort, address, remove:() => natPmpRequest(gateway, port, mappedPort, 0).then(() => undefined) };
}

export async function mapWithFallback(upnp: () => Promise<Mapping>, natPmp: () => Promise<Mapping>) {
  try { return await upnp(); } catch (upnpError) {
    try { return await natPmp(); } catch (natError) {
      throw new Error(`UPnP mislukt (${upnpError instanceof Error?upnpError.message:String(upnpError)}); NAT-PMP mislukt (${natError instanceof Error?natError.message:String(natError)}).`);
    }
  }
}

export function externalAccessStatus() { return { ...status }; }

export async function removeExternalPortMapping() {
  if (renewalTimer) clearTimeout(renewalTimer);
  renewalTimer = null;
  const current = active; active = null;
  if (current) try { await current.remove(); } catch (error) { log('WARNING','streaming','Externe routermapping kon niet netjes worden verwijderd.',{ error:error instanceof Error?error.message:String(error) }); }
}

export async function refreshExternalAccessMapping() {
  const mode = getSetting('externalAccessMode','home') as ExternalAccessMode;
  await removeExternalPortMapping();
  const listening = externalStreamingStatus();
  if (mode !== 'router') {
    status = { mode, active:mode==='tailscale', protocol:mode==='tailscale'?'tailscale':'', port:0, publicAddress:'', message:mode==='tailscale'?'Tailscale blijft beschikbaar; controleer Tailscale Serve voor de actuele status.':'Alleen bereikbaar binnen het thuisnetwerk.', checkedAt:new Date().toISOString() };
    return externalAccessStatus();
  }
  if (!listening.listening) {
    status = { mode, active:false, protocol:'', port:listening.port, publicAddress:'', message:'Herstart ThuisHub om de aparte externe streamingpoort te activeren.', checkedAt:new Date().toISOString() };
    return externalAccessStatus();
  }
  try {
    active = await mapWithFallback(() => mapUpnp(listening.address,listening.port), () => mapNatPmp(listening.address,listening.port));
    status = { mode, active:true, protocol:active.protocol, port:active.port, publicAddress:active.publicAddress||'', message:'Routermapping actief voor uitsluitend afspelen en gekoppelde apparaten.', checkedAt:new Date().toISOString() };
    if (active.protocol === 'nat-pmp') {
      renewalTimer = setTimeout(() => { void refreshExternalAccessMapping(); }, 45 * 60 * 1000);
      renewalTimer.unref();
    }
  } catch (error) {
    status = { mode, active:false, protocol:'', port:listening.port, publicAddress:'', message:error instanceof Error?error.message:String(error), checkedAt:new Date().toISOString() };
  }
  return externalAccessStatus();
}

export const portMappingInternals = { natPmpRequest };
