import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-discovery-trigger-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');
fs.writeFileSync(path.join(root, '.migration-from-huiskamer.json'), '{}');
const database = await import('../db.js');
const { discoverPlaybackDevices, discoveryReasonForTick, startPlaybackDeviceDiscovery, stopPlaybackDeviceDiscovery } = await import('./discovery-service.js');
afterAll(() => { database.db.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('discoverytriggers', () => {
  it('start opnieuw zoeken wanneer de netwerkinterface verandert', () => {
    expect(discoveryReasonForTick('wifi:192.168.1.10', 1_000, 'wifi:192.168.1.11', 15_000)).toBe('network-change');
  });

  it('herkent hervatten uit slaapstand aan een lange timerpauze', () => {
    expect(discoveryReasonForTick('wifi:192.168.1.10', 1_000, 'wifi:192.168.1.10', 50_001)).toBe('resume');
  });

  it('start geen extra scan als netwerk en timer normaal zijn', () => {
    expect(discoveryReasonForTick('wifi:192.168.1.10', 1_000, 'wifi:192.168.1.10', 15_000)).toBeNull();
  });

  it('roept bij opstarten de lifecycle-hook aan zodat sockets aan de actuele interface worden gebonden', async () => {
    const hook = vi.fn();
    startPlaybackDeviceDiscovery(hook);
    await vi.waitFor(() => expect(hook).toHaveBeenCalledWith(expect.objectContaining({ reason: 'startup' })));
    await stopPlaybackDeviceDiscovery();
  });

  it('verliest een netwerkverandering niet wanneer er al een scan loopt', async () => {
    let releaseStartup!: () => void;
    const startupGate = new Promise<void>(resolve => { releaseStartup = resolve; });
    const hook = vi.fn(async ({ reason }: { reason: string }) => {
      if (reason === 'startup') await startupGate;
    });
    startPlaybackDeviceDiscovery(hook);
    await vi.waitFor(() => expect(hook).toHaveBeenCalledWith(expect.objectContaining({ reason: 'startup' })));
    void discoverPlaybackDevices('network-change');
    releaseStartup();
    await vi.waitFor(() => expect(hook).toHaveBeenCalledWith(expect.objectContaining({ reason: 'network-change' })));
    await stopPlaybackDeviceDiscovery();
  });
});
