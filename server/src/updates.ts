import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from './constants.js';
import { getSetting, setSetting } from './db.js';
import { log } from './logger.js';
import { appPaths } from './paths.js';

export type UpdateChannel = 'stable' | 'beta' | 'development';
export type UpdateManifest = { version: string; channel: UpdateChannel; downloadUrl: string; sha256: string; releaseNotes: string; size?: number };

function compareVersions(left: string, right: string) {
  const a = left.split(/[.-]/).map(value => Number(value) || 0);
  const b = right.split(/[.-]/).map(value => Number(value) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  return 0;
}

function validateManifest(value: any): UpdateManifest {
  if (!value || !/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(value.version) || !['stable', 'beta', 'development'].includes(value.channel) || typeof value.downloadUrl !== 'string' || !/^https:\/\//i.test(value.downloadUrl) || !/^[a-f0-9]{64}$/i.test(value.sha256)) {
    throw new Error('Het update-manifest is ongeldig.');
  }
  return value;
}

export async function checkForUpdates(fetcher: typeof fetch = fetch) {
  const manifestUrl = getSetting('updateManifestUrl', process.env.THUIS_HUB_UPDATE_MANIFEST || '');
  const channel = getSetting('updateChannel', 'stable') as UpdateChannel;
  if (!manifestUrl) return { configured: false, currentVersion: APP_VERSION, available: false, channel, message: 'Er is nog geen updatebron ingesteld.' };
  try {
    const response = await fetcher(manifestUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Updatebron antwoordde met ${response.status}.`);
    const manifest = validateManifest(await response.json());
    const allowed = channel === 'development' || channel === 'beta' && manifest.channel !== 'development' || channel === 'stable' && manifest.channel === 'stable';
    const available = allowed && compareVersions(manifest.version, APP_VERSION) > 0;
    setSetting('lastUpdateCheckAt', new Date().toISOString());
    setSetting('lastUpdateResult', JSON.stringify({ ...manifest, available }));
    log('INFO', 'updater', 'Updatecontrole voltooid.', { currentVersion: APP_VERSION, remoteVersion: manifest.version, channel, available });
    return { configured: true, currentVersion: APP_VERSION, available, channel, manifest, message: available ? `ThuisHub ${manifest.version} is beschikbaar.` : 'ThuisHub is actueel.' };
  } catch (error) {
    log('WARNING', 'updater', 'Updatecontrole mislukt; de huidige installatie blijft actief.', { error: error instanceof Error ? error.message : String(error) });
    return { configured: true, currentVersion: APP_VERSION, available: false, channel, offline: true, message: 'De updatebron is momenteel niet bereikbaar.' };
  }
}

export async function downloadUpdate(manifest: UpdateManifest, fetcher: typeof fetch = fetch) {
  const valid = validateManifest(manifest);
  fs.mkdirSync(appPaths.updatesDir, { recursive: true });
  const response = await fetcher(valid.downloadUrl, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download mislukt (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash.toLowerCase() !== valid.sha256.toLowerCase()) {
    log('CRITICAL', 'updater', 'Updatebestand geweigerd door onjuiste SHA-256-hash.', { expected: valid.sha256, actual: hash });
    throw new Error('De integriteitscontrole van de update is mislukt. De huidige installatie blijft ongewijzigd.');
  }
  const target = path.join(appPaths.updatesDir, `ThuisHub-${valid.version}.exe`);
  fs.writeFileSync(target, bytes);
  log('INFO', 'updater', 'Update gedownload en SHA-256 gecontroleerd.', { version: valid.version, file: target, bytes: bytes.length });
  return { file: target, bytes: bytes.length, sha256: hash, installRequiresConsent: true };
}

export const updateInternals = { compareVersions, validateManifest };
