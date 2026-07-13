import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const labels = require('../../desktop/tray-labels.cjs') as string[];

describe('Windows-distributie', () => {
  it('bevat het volledige systeemvakmenu', () => {
    expect(labels).toHaveLength(10);
    for (const label of ['Serverdashboard', 'Externe toegang', 'Back-up maken', 'ThuisHub afsluiten']) expect(labels).toContain(label);
  });

  it('configureert portable, installer en veilige upgrade', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    expect(packageJson.version).toBe('1.2.0');
    expect(packageJson.build.nsis.artifactName).toContain('ThuisHub-Setup');
    expect(packageJson.build.portable.artifactName).toContain('ThuisHub-Portable');
    expect(packageJson.build.appId).toBe('nl.huiskamer.media');
    expect(fs.readFileSync(path.resolve('build/installer.nsh'), 'utf8')).toContain('Huiskamer.lnk');
  });
});
