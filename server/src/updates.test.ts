import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'thuishub-updates-'));
process.env.THUIS_HUB_ROOT_DIR=root;
process.env.THUIS_HUB_DATA_DIR=path.join(root,'data');
process.env.THUIS_HUB_BACKUP_DIR=path.join(root,'backups');
process.env.THUIS_HUB_LOG_DIR=path.join(root,'logs');
process.env.LOCALAPPDATA=path.join(root,'local');
const database=await import('./db.js');
const updates=await import('./updates.js');
const {appPaths}=await import('./paths.js');

const hash='a'.repeat(64);
function release(version='1.3.0',overrides:Record<string,unknown>={}){
  return {tag_name:`v${version}`,name:`ThuisHub ${version}`,body:'Release notes',html_url:`https://github.com/kratje050/thuishub/releases/tag/v${version}`,published_at:'2026-07-13T12:00:00Z',draft:false,prerelease:false,assets:[{name:`ThuisHub-Setup-${version}.exe`,browser_download_url:`https://github.com/kratje050/thuishub/releases/download/v${version}/ThuisHub-Setup-${version}.exe`,size:7,digest:`sha256:${hash}`}],...overrides};
}
function responseJson(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})}

beforeEach(()=>{database.setSetting('updateChannel','stable');database.setSetting('developmentUpdatesEnabled','false');database.setSetting('downloadedUpdateResult','{}');updates.updateInternals.setDownloadInProgress(false);fs.rmSync(appPaths.updatesDir,{recursive:true,force:true})});
afterAll(()=>{database.db.close();fs.rmSync(root,{recursive:true,force:true})});

describe('GitHub Releases-updatecontrole',()=>{
  it('vergelijkt dezelfde, nieuwere en oudere SemVer-versies',()=>{
    expect(updates.updateInternals.compareVersions('1.2.0','1.2.0')).toBe(0);
    expect(updates.updateInternals.compareVersions('1.3.0','1.2.0')).toBe(1);
    expect(updates.updateInternals.compareVersions('1.1.9','1.2.0')).toBe(-1);
    expect(updates.updateInternals.compareVersions('1.2.0','1.2.0-beta.2')).toBe(1);
  });

  it.each([['dezelfde versie','1.2.0',false],['nieuwere stabiele versie','1.3.0',true],['oudere release','1.1.0',false]] as const)('%s',async(_name,version,available)=>{
    const result:any=await updates.checkForUpdates(async()=>responseJson(release(version)));
    expect(result.available).toBe(available);
  });

  it('negeert een prerelease op het stabiele kanaal',async()=>{
    const result:any=await updates.checkForUpdates(async()=>responseJson(release('1.3.0-beta.1',{prerelease:true})));
    expect(result.available).toBe(false);expect(result.message).toContain('geen officiële');
  });

  it('kiest een prerelease op het bètakanaal maar nooit een draft',async()=>{
    database.setSetting('updateChannel','beta');
    const list=[release('9.0.0',{draft:true}),release('1.3.0-beta.2',{prerelease:true}),release('1.2.1')];
    const result:any=await updates.checkForUpdates(async()=>responseJson(list));
    expect(result.available).toBe(true);expect(result.manifest.version).toBe('1.3.0-beta.2');
  });

  it('houdt ontwikkelingsupdates standaard uitgeschakeld',async()=>{
    database.setSetting('updateChannel','development');let called=false;
    const result:any=await updates.checkForUpdates(async()=>{called=true;return responseJson([])});
    expect(called).toBe(false);expect(result.message).toContain('uitgeschakeld');
  });

  it.each([['GitHub 404',404,false],['rate limit',403,true],['serverfout',500,true]] as const)('verwerkt %s zonder de installatie te beschadigen',async(_name,status,offline)=>{
    const result:any=await updates.checkForUpdates(async()=>responseJson({message:'fout'},status));
    expect(result.available).toBe(false);expect(Boolean(result.offline)).toBe(offline);
  });

  it('verwerkt een timeout als offline toestand',async()=>{
    const result:any=await updates.checkForUpdates(async()=>{throw new DOMException('timeout','TimeoutError')});
    expect(result.offline).toBe(true);expect(result.message).toContain('huidige versie');
  });

  it('weigert beschadigde latest.json',async()=>{
    const value:any=release();value.assets.push({name:'latest.json',browser_download_url:'https://github.com/kratje050/thuishub/releases/download/v1.3.0/latest.json',size:1});value.assets[0].digest=undefined;
    await expect(updates.updateInternals.manifestFromRelease(value,'stable',async()=>new Response('{kapot'))).rejects.toThrow('latest.json');
  });

  it('weigert een ontbrekende of verkeerd benoemde installerasset',async()=>{
    await expect(updates.updateInternals.manifestFromRelease({...release(),assets:[]},'stable',fetch)).rejects.toThrow('ThuisHub-Setup-1.3.0.exe');
    await expect(updates.updateInternals.manifestFromRelease({...release(),assets:[{name:'willekeurig.exe',browser_download_url:'https://github.com/x',size:1,digest:`sha256:${hash}`}]},'stable',fetch)).rejects.toThrow('ontbreekt');
  });

  it('weigert tegenstrijdige SHA-256-bronnen',async()=>{
    const value:any=release();value.assets[0].digest=undefined;value.assets.push({name:'latest.json',browser_download_url:'https://github.com/manifest',size:1},{name:'SHA256SUMS.txt',browser_download_url:'https://github.com/sums',size:1});
    const fetcher=async(url:any)=>String(url).endsWith('manifest')?new Response(JSON.stringify({assets:{setup:{name:'ThuisHub-Setup-1.3.0.exe',sha256:'a'.repeat(64)}}})):new Response(`${'b'.repeat(64)}  ThuisHub-Setup-1.3.0.exe`);
    await expect(updates.updateInternals.manifestFromRelease(value,'stable',fetcher as any)).rejects.toThrow('spreken elkaar tegen');
  });
});

describe('beveiligde update-download',()=>{
  const bytes=Buffer.from('bestand');const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const manifest={version:'1.3.0',channel:'stable' as const,assetName:'ThuisHub-Setup-1.3.0.exe',downloadUrl:'https://github.com/kratje050/thuishub/releases/download/v1.3.0/ThuisHub-Setup-1.3.0.exe',sha256,releaseNotes:'test',size:bytes.length};

  it('downloadt naar LocalAppData en controleert grootte en SHA-256',async()=>{
    const result=await updates.downloadUpdate(manifest,async()=>new Response(bytes));
    expect(result.sha256Verified).toBe(true);expect(result.installRequiresConsent).toBe(true);expect(path.dirname(result.file)).toBe(appPaths.updatesDir);expect(fs.readFileSync(result.file)).toEqual(bytes);
  });

  it('toont na downloaden Installeren en draagt een dubbel gecontroleerde installer over aan de desktop-app',async()=>{
    database.setSetting('lastUpdateResult',JSON.stringify({...manifest,available:true}));
    await updates.downloadUpdate(manifest,async()=>new Response(bytes));
    expect(updates.downloadedUpdateStatus()).toMatchObject({ready:true,version:'1.3.0',sha256Verified:true});
    const result=updates.requestUpdateInstall({desktop:true});
    expect(result).toMatchObject({accepted:true,mode:'desktop',version:'1.3.0'});
    const request=JSON.parse(fs.readFileSync(updates.updateInternals.installRequestFile,'utf8'));
    expect(request).toMatchObject({version:'1.3.0',fileName:'ThuisHub-Setup-1.3.0.exe',bytes:bytes.length,sha256});
  });

  it('vervangt via de losse browserserver de oude installatie stil en start de nieuwe versie',async()=>{
    database.setSetting('lastUpdateResult',JSON.stringify({...manifest,available:true}));
    await updates.downloadUpdate(manifest,async()=>new Response(bytes));
    let call:any;let stopped=false;
    const result=updates.requestUpdateInstall({desktop:false,shutdown:()=>{stopped=true},spawnProcess:(command,args,options)=>{call={command,args,options};return{unref(){}}}});
    const encoded=call.args.at(-1);const script=Buffer.from(encoded,'base64').toString('utf16le');
    expect(result).toMatchObject({accepted:true,mode:'browser',version:'1.3.0'});expect(stopped).toBe(true);
    expect(script).toContain("-ArgumentList '/S','--force-run' -Wait -PassThru");
  });

  it('controleert de installer opnieuw en weigert een wijziging na de download',async()=>{
    database.setSetting('lastUpdateResult',JSON.stringify({...manifest,available:true}));
    const result=await updates.downloadUpdate(manifest,async()=>new Response(bytes));
    fs.writeFileSync(result.file,'bestanD');
    expect(updates.downloadedUpdateStatus().ready).toBe(true);
    expect(()=>updates.requestUpdateInstall({desktop:true})).toThrow('gewijzigd of beschadigd');
    expect(fs.existsSync(result.file)).toBe(false);
  });

  it('weigert een verkeerde hash en verwijdert tijdelijke bestanden',async()=>{
    await expect(updates.downloadUpdate({...manifest,sha256:'0'.repeat(64)},async()=>new Response(bytes))).rejects.toThrow('integriteitscontrole');
    expect(fs.readdirSync(appPaths.updatesDir).some(name=>name.endsWith('.part'))).toBe(false);
  });

  it('weigert een verkeerde assetnaam en andere repository',async()=>{
    await expect(updates.downloadUpdate({...manifest,assetName:'ander.exe'})).rejects.toThrow('manifest');
    await expect(updates.downloadUpdate({...manifest,downloadUrl:'https://github.com/aanvaller/repo/releases/download/v1.3.0/ThuisHub-Setup-1.3.0.exe'})).rejects.toThrow('manifest');
  });

  it('ruimt een afgebroken download op',async()=>{
    await expect(updates.downloadUpdate(manifest,async()=>{throw new DOMException('afgebroken','AbortError')})).rejects.toThrow('afgebroken');
    expect(fs.readdirSync(appPaths.updatesDir).some(name=>name.endsWith('.part'))).toBe(false);
  });

  it('voorkomt een dubbele update',async()=>{
    updates.updateInternals.setDownloadInProgress(true);
    await expect(updates.downloadUpdate(manifest)).rejects.toThrow('al een update-download');
  });
});
