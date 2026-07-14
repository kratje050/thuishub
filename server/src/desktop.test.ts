import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const labels = require('../../desktop/tray-labels.cjs') as string[];
const handoff = require('../../desktop/update-handoff.cjs') as any;

describe('Windows-distributie', () => {
  it('bevat het volledige systeemvakmenu', () => {
    expect(labels).toHaveLength(10);
    for (const label of ['Serverdashboard', 'Externe toegang', 'Back-up maken', 'ThuisHub afsluiten']) expect(labels).toContain(label);
  });

  it('configureert portable, installer en veilige upgrade', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    expect(packageJson.version).toBe('1.2.14');
    expect(packageJson.build.nsis.artifactName).toContain('ThuisHub-Setup');
    expect(packageJson.build.nsis.deleteAppDataOnUninstall).toBe(false);
    expect(packageJson.build.portable.artifactName).toContain('ThuisHub-Portable');
    expect(packageJson.build.appId).toBe('nl.huiskamer.media');
    const installerInclude=fs.readFileSync(path.resolve('build/installer.nsh'),'utf8');
    expect(installerInclude).toContain('Huiskamer.lnk');
    expect(installerInclude).toContain('${ifNot} ${isUpdated}');
    expect(installerInclude).toContain('/SD IDNO');
    const upgradeTemplate=fs.readFileSync(path.resolve('node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh'),'utf8');
    expect(upgradeTemplate).toContain('Function uninstallOldVersion');
    expect(upgradeTemplate).toContain('/S /KEEP_APP_DATA');
    const serverEntry=fs.readFileSync(path.resolve('server/src/index.ts'),'utf8');
    expect(serverEntry).toContain('void checkForUpdates();');
    expect(serverEntry).not.toContain("if (getSetting('automaticUpdateCheck'");
    const desktopEntry=fs.readFileSync(path.resolve('desktop/main.cjs'),'utf8');
    expect(desktopEntry).toContain("process.argv.includes('--updated')");
    expect(desktopEntry).toContain('revealWindowAfterStart');
    expect(desktopEntry).toContain('mainWindow.setAlwaysOnTop(true)');
  });

  it('accepteert alleen de exacte gecontroleerde installer en verwijdert het overdrachtsbestand', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'thuishub-handoff-'));
    try{
      const version='1.3.0';const fileName=`ThuisHub-Setup-${version}.exe`;const file=path.join(root,fileName);const requestFile=path.join(root,'install-request.json');
      fs.writeFileSync(file,'installer');const bytes=fs.statSync(file).size;const sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      fs.writeFileSync(requestFile,JSON.stringify({version,fileName,file,bytes,sha256}));
      expect(handoff.consumeInstallRequest(requestFile,root)).toMatchObject({version,fileName,file,bytes,sha256});
      expect(fs.existsSync(requestFile)).toBe(false);
      expect(()=>handoff.validateInstallRequest({version,fileName,file:path.join(root,'..',fileName),bytes,sha256},root)).toThrow('ontbreekt');
    }finally{fs.rmSync(root,{recursive:true,force:true})}
  });

  it('start de installer pas nadat het desktopproces is afgesloten', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'thuishub-helper-'));
    try{
      let call:any;const installer=path.join(root,'ThuisHub-Setup-1.3.0.exe');
      const result=handoff.launchInstallerAfterExit(installer,4321,{restartExecutable:'C:\\Programs\\ThuisHub\\ThuisHub.exe',execProcess:(command:string,args:string[],options:any)=>{call={command,args,options};return'9876\n'}});
      expect(call.command).toBe('powershell.exe');expect(call.options).toMatchObject({windowsHide:true,timeout:15000});expect(result.helperPid).toBe(9876);
      const broker=Buffer.from(call.args.at(-1),'base64').toString('utf16le');
      expect(broker).toContain('Invoke-CimMethod');expect(broker).toContain('Win32_Process');expect(broker).toContain('-File');
      expect(result.script).toContain('Wait-Process -Id 4321');expect(result.script).toContain('ThuisHub-Setup-1.3.0.exe');
      expect(result.script).toContain("Get-Process -Name 'ThuisHub'");
      expect(result.script).toContain("-ArgumentList '/S','--force-run' -PassThru -Wait");
      expect(result.script).toContain("Start-Process -FilePath $installedExecutable");
      expect(result.script).toContain('install-helper.log');expect(result.script).toContain('C:\\Programs\\ThuisHub\\ThuisHub.exe');
      expect(fs.existsSync(result.helperFile)).toBe(true);
    }finally{fs.rmSync(root,{recursive:true,force:true})}
  });
});
