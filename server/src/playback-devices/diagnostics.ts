import net from 'node:net';
import os from 'node:os';
import { discoverDlnaDevices, isPrivateDlnaIpv4, type DiscoverDlnaOptions, type DlnaDevice } from './providers/dlna.js';

export type DiscoveryDiagnostics = {
  checkedAt: string;
  interface: {
    address: string;
    private: boolean;
    assigned: boolean;
    name?: string;
  };
  streamingServer: {
    port: number;
    listening: boolean;
  };
  ssdp: {
    status: 'responsive' | 'no-devices' | 'error' | 'not-run';
    message: string;
  };
  dlna: {
    count: number;
    devices: Array<Pick<DlnaDevice, 'id' | 'name' | 'manufacturer' | 'model' | 'lastSeen'>>;
  };
  lastError?: string;
};

type TcpProbe = (address: string, port: number, timeoutMs: number) => Promise<boolean>;

export type DiscoveryDiagnosticsOptions = {
  address: string;
  streamingPort?: number;
  timeoutMs?: number;
  discover?: (options: DiscoverDlnaOptions) => Promise<DlnaDevice[]>;
  tcpProbe?: TcpProbe;
  dlnaOptions?: Omit<DiscoverDlnaOptions, 'address' | 'timeoutMs'>;
  now?: () => Date;
};

function assignedInterface(address: string) {
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    if (entries?.some(entry => entry.family === 'IPv4' && !entry.internal && entry.address === address)) return name;
  }
  return undefined;
}

const defaultTcpProbe: TcpProbe = (address, port, timeoutMs) => new Promise(resolve => {
  const socket = net.createConnection({ host: address, port });
  let finished = false;
  const done = (result: boolean) => {
    if (finished) return;
    finished = true;
    socket.destroy();
    resolve(result);
  };
  socket.setTimeout(timeoutMs);
  socket.once('connect', () => done(true));
  socket.once('timeout', () => done(false));
  socket.once('error', () => done(false));
});

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(token|authorization|cookie)=?[^\s&]*/gi, '$1=[VERBORGEN]').slice(0, 500);
}

export async function runDlnaDiscoveryDiagnostics(options: DiscoveryDiagnosticsOptions): Promise<DiscoveryDiagnostics> {
  const now = options.now || (() => new Date());
  const port = Math.min(65_535, Math.max(1, Math.floor(options.streamingPort ?? 8_788)));
  const timeoutMs = Math.min(10_000, Math.max(250, options.timeoutMs ?? 2_000));
  const privateAddress = isPrivateDlnaIpv4(options.address);
  const interfaceName = assignedInterface(options.address);
  const base: DiscoveryDiagnostics = {
    checkedAt: now().toISOString(),
    interface: { address: options.address, private: privateAddress, assigned: Boolean(interfaceName), name: interfaceName },
    streamingServer: { port, listening: false },
    ssdp: { status: 'not-run', message: 'SSDP is niet uitgevoerd.' },
    dlna: { count: 0, devices: [] },
  };
  if (!privateAddress) {
    base.lastError = 'Het gekozen adres is geen privé IPv4-LAN-adres.';
    return base;
  }
  if (!interfaceName) {
    base.lastError = 'Het gekozen privé-LAN-adres is niet aan deze computer toegewezen.';
    return base;
  }

  base.streamingServer.listening = await (options.tcpProbe || defaultTcpProbe)(options.address, port, Math.min(timeoutMs, 2_000));
  try {
    const devices = await (options.discover || discoverDlnaDevices)({
      address: options.address,
      timeoutMs,
      ...(options.dlnaOptions || {}),
    });
    base.dlna = {
      count: devices.length,
      devices: devices.map(({ id, name, manufacturer, model, lastSeen }) => ({ id, name, manufacturer, model, lastSeen })),
    };
    base.ssdp = devices.length
      ? { status: 'responsive', message: `${devices.length} DLNA MediaRenderer${devices.length === 1 ? '' : 's'} gevonden.` }
      : { status: 'no-devices', message: 'Geen DLNA MediaRenderers antwoordden. Dit bewijst niet dat multicast is geblokkeerd.' };
  } catch (error) {
    base.ssdp = { status: 'error', message: 'SSDP-discovery kon niet worden uitgevoerd.' };
    base.lastError = safeError(error);
  }
  return base;
}

export const runDiscoveryDiagnostics = runDlnaDiscoveryDiagnostics;
export const discoveryDiagnosticInternals = { assignedInterface, defaultTcpProbe, safeError };
