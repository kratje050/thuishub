import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);
export type CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr?: string }>;

async function defaultRunner(file: string, args: string[]) {
  return execFileAsync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 7000, maxBuffer: 2 * 1024 * 1024 });
}

async function findExecutable(runner: CommandRunner) {
  try {
    const { stdout } = await runner('where.exe', ['tailscale.exe']);
    return stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean) || '';
  } catch {
    return '';
  }
}

export async function tailscaleStatus(runner: CommandRunner = defaultRunner) {
  const executable = await findExecutable(runner);
  const base = { installed: Boolean(executable), connected: false, serveActive: false, computerName: os.hostname(), localUrl: 'http://127.0.0.1:8787', httpsUrl: '', connection: 'onbekend', message: '' };
  if (!executable) return { ...base, message: 'Tailscale is niet geïnstalleerd.' };
  try {
    const [{ stdout: statusText }, serveResult] = await Promise.all([
      runner(executable, ['status', '--json']),
      runner(executable, ['serve', 'status', '--json']).catch(() => ({ stdout: '{}' })),
    ]);
    const status = JSON.parse(statusText);
    const serve = JSON.parse(serveResult.stdout || '{}');
    const connected = status.BackendState === 'Running' && Boolean(status.Self?.Online);
    const dnsName = String(status.Self?.DNSName || '').replace(/\.$/, '');
    const serveText = JSON.stringify(serve);
    const serveActive = serveText.includes('8787') || serveText.includes('127.0.0.1:8787') || serveText.includes('localhost:8787');
    const peers = Object.values(status.Peer || {}) as any[];
    const activePeer = peers.find(peer => peer.Active);
    const connection = activePeer?.CurAddr ? 'direct' : activePeer?.Relay ? `DERP-relay (${activePeer.Relay})` : connected ? 'verbonden; nog geen actieve peerverbinding' : 'niet verbonden';
    return { ...base, installed: true, connected, serveActive, httpsUrl: dnsName && serveActive ? `https://${dnsName}` : '', connection, message: !connected ? 'Tailscale is geïnstalleerd maar niet aangemeld of verbonden.' : !serveActive ? 'Tailscale Serve is nog niet actief.' : 'Privétoegang via Tailscale Serve is actief.' };
  } catch (error) {
    log('WARNING', 'tailscale', 'Tailscale-status kon niet worden gelezen.', { error: error instanceof Error ? error.message : String(error) });
    return { ...base, installed: true, message: 'Tailscale reageert niet of is nog niet aangemeld.' };
  }
}

export const tailscaleInternals = { findExecutable };

