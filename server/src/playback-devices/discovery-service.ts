import os from 'node:os';
import { getSetting } from '../db.js';
import { assignedPrivateAddresses } from '../network.js';
import { log } from '../logger.js';
import { probeMdnsService } from './mdns-diagnostics.js';
import { playbackDeviceRegistry } from './registry.js';
import type { PlaybackDeviceDiscoveryResult, PlaybackDeviceProtocol } from './types.js';

export type DiscoveryReason = 'startup' | 'manual' | 'background' | 'network-change' | 'resume';
export type PlaybackDiscoveryProvider = {
  id: string;
  protocols: PlaybackDeviceProtocol[];
  discover(address: string): Promise<PlaybackDeviceDiscoveryResult>;
  stop?(): void | Promise<void>;
};
export type PlaybackDiscoveryLifecycleHook = (event: { reason: Extract<DiscoveryReason, 'startup' | 'network-change' | 'resume'>; address: string }) => void | Promise<void>;

type DiscoveryStatus = {
  running: boolean;
  lastRun?: string;
  lastReason?: DiscoveryReason;
  lastError?: string;
  multicastAvailable?: boolean;
  mdnsGoogleCastVisible?: boolean;
  mdnsThuisHubServerVisible?: boolean;
  providerResults: Record<string, { count: number; error?: string; finishedAt: string }>;
};

const providers = new Map<string, PlaybackDiscoveryProvider>();
const status: DiscoveryStatus = { running: false, providerResults: {} };
let activeRun: Promise<ReturnType<typeof diagnostics>> | null = null;
let pendingLifecycleReason: Extract<DiscoveryReason, 'network-change' | 'resume'> | null = null;
let backgroundTimer: NodeJS.Timeout | null = null;
let networkTimer: NodeJS.Timeout | null = null;
let lastNetworkFingerprint = '';
let lastTick = Date.now();
let lifecycleHook: PlaybackDiscoveryLifecycleHook | null = null;

function networkFingerprint() {
  return JSON.stringify(Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => (entries || []).filter(entry => entry.family === 'IPv4' && !entry.internal).map(entry => [name, entry.address, entry.netmask])));
}

export function discoveryReasonForTick(previousFingerprint: string, previousTick: number, currentFingerprint: string, now: number): DiscoveryReason | null {
  if (now - previousTick > 45_000) return 'resume';
  if (currentFingerprint !== previousFingerprint) return 'network-change';
  return null;
}

export function registerPlaybackDiscoveryProvider(provider: PlaybackDiscoveryProvider) {
  providers.set(provider.id, provider);
  return () => providers.delete(provider.id);
}

export function diagnostics() {
  const selectedAddress = getSetting('localStreamingAddress', '');
  const devices = playbackDeviceRegistry.list();
  const count = (protocol: PlaybackDeviceProtocol) => devices.filter(device => device.protocol === protocol).length;
  return {
    ...status,
    selectedAddress,
    selectedAddressPresent: Boolean(selectedAddress && assignedPrivateAddresses().includes(selectedAddress)),
    counts: {
      googleCast: count('google-cast'),
      dlna: count('dlna-upnp'),
      pairedApps: devices.filter(device => device.protocol === 'thuishub-tv-app' && device.trusted).length,
      total: devices.length,
    },
  };
}

export function discoverPlaybackDevices(reason: DiscoveryReason = 'manual') {
  if (activeRun) {
    if (reason === 'network-change' || reason === 'resume') pendingLifecycleReason = reason;
    return activeRun;
  }
  activeRun = (async () => {
    status.running = true;
    status.lastReason = reason;
    status.lastError = undefined;
    delete status.multicastAvailable;
    const address = getSetting('localStreamingAddress', '');
    const errors: string[] = [];
    if (reason === 'startup' || reason === 'network-change' || reason === 'resume') {
      try { await lifecycleHook?.({ reason, address }); }
      catch (error) { errors.push(`netwerkdiensten: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (!getSetting('automaticDeviceDiscovery', 'true').startsWith('t') && reason !== 'manual') {
      status.lastError = errors[0];
      status.running = false;
      status.lastRun = new Date().toISOString();
      return diagnostics();
    }
    if (!address || !assignedPrivateAddresses().includes(address)) {
      status.lastError = 'Selecteer eerst een actief priv\u00e9-LAN-adres voor automatische tv-detectie.';
      status.running = false;
      status.lastRun = new Date().toISOString();
      return diagnostics();
    }
    const results = await Promise.all([...providers.values()].map(async provider => {
      try {
        const result = await provider.discover(address);
        const seenByProtocol = new Map<PlaybackDeviceProtocol, string[]>();
        for (const device of result.devices) {
          const saved = playbackDeviceRegistry.upsertDiscovered(device);
          if (saved) seenByProtocol.set(saved.protocol, [...(seenByProtocol.get(saved.protocol) || []), saved.id]);
        }
        for (const protocol of provider.protocols) playbackDeviceRegistry.markProviderMissing(protocol, seenByProtocol.get(protocol) || []);
        status.providerResults[provider.id] = { count: result.devices.length, error: result.error, finishedAt: result.finishedAt };
        if (result.error) errors.push(`${provider.id}: ${result.error}`);
        if (result.multicastAvailable !== undefined) status.multicastAvailable = result.multicastAvailable;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${provider.id}: ${message}`);
        status.providerResults[provider.id] = { count: 0, error: message, finishedAt: new Date().toISOString() };
      }
    }));
    void results;
    if (reason === 'manual' || reason === 'startup' || reason === 'network-change') {
      const [cast, server] = await Promise.all([
        probeMdnsService('_googlecast._tcp.local', address).catch(error => ({ visible: false, error: String(error) })),
        probeMdnsService('_thuishub._tcp.local', address).catch(error => ({ visible: false, error: String(error) })),
      ]);
      status.mdnsGoogleCastVisible = Boolean(cast.visible);
      status.mdnsThuisHubServerVisible = Boolean(server.visible);
    }
    status.lastError = errors[0];
    status.lastRun = new Date().toISOString();
    status.running = false;
    playbackDeviceRegistry.removeStale(Number(getSetting('deviceRetentionDays', '30')));
    log(errors.length ? 'WARNING' : 'INFO', 'tv-discovery', errors.length ? 'Tv-detectie afgerond met waarschuwingen.' : 'Tv-detectie afgerond.', { reason, providerCount: providers.size, errors });
    return diagnostics();
  })().finally(() => {
    activeRun = null;
    const pending = pendingLifecycleReason;
    pendingLifecycleReason = null;
    if (pending) void discoverPlaybackDevices(pending);
  });
  return activeRun;
}

export function startPlaybackDeviceDiscovery(onLifecycle?: PlaybackDiscoveryLifecycleHook) {
  if (backgroundTimer) return;
  lifecycleHook = onLifecycle || null;
  lastNetworkFingerprint = networkFingerprint();
  lastTick = Date.now();
  void discoverPlaybackDevices('startup');
  backgroundTimer = setInterval(() => void discoverPlaybackDevices('background'), 45_000);
  networkTimer = setInterval(() => {
    const now = Date.now();
    const fingerprint = networkFingerprint();
    const reason = discoveryReasonForTick(lastNetworkFingerprint, lastTick, fingerprint, now);
    if (reason) void discoverPlaybackDevices(reason);
    lastNetworkFingerprint = fingerprint;
    lastTick = now;
  }, 15_000);
  backgroundTimer.unref();
  networkTimer.unref();
}

export async function stopPlaybackDeviceDiscovery() {
  if (backgroundTimer) clearInterval(backgroundTimer);
  if (networkTimer) clearInterval(networkTimer);
  backgroundTimer = null;
  networkTimer = null;
  lifecycleHook = null;
  pendingLifecycleReason = null;
  await Promise.all([...providers.values()].map(provider => Promise.resolve(provider.stop?.()).catch(() => undefined)));
}

export const discoveryInternals = { networkFingerprint, discoveryReasonForTick };
