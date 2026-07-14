import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { APP_VERSION } from './constants.js';
import { getSetting, setSetting } from './db.js';
import { log } from './logger.js';
import { appPaths } from './paths.js';

const require = createRequire(import.meta.url);
type ExecProcessLike=(command:string,args?:readonly string[],options?:Record<string,unknown>)=>string|Buffer;
const updateHandoff = require('../../desktop/update-handoff.cjs') as {
  launchInstallerAfterExit:(installer:string,waitPid:number,options?:{execProcess?:ExecProcessLike;restartExecutable?:string})=>unknown;
};

export type UpdateChannel = 'stable' | 'beta' | 'development';
export type UpdateManifest = {
  product?: string; version: string; channel: UpdateChannel; tag?: string; downloadUrl: string; sha256: string; releaseNotes: string;
  size?: number; publishedAt?: string; releasePage?: string; assetName?: string; githubDigest?: string; minimumSupportedVersion?: string;
};
type GitHubAsset = { name:string; browser_download_url:string; size:number; digest?:string };
type GitHubRelease = { tag_name:string; name?:string; body?:string; html_url:string; published_at?:string; draft:boolean; prerelease:boolean; assets:GitHubAsset[] };

const GITHUB_REPOSITORY='kratje050/thuishub';
const GITHUB_API=`https://api.github.com/repos/${GITHUB_REPOSITORY}`;
const headers={Accept:'application/vnd.github+json','User-Agent':`ThuisHub-Updater/${APP_VERSION}`,'X-GitHub-Api-Version':'2022-11-28'};

function compareVersions(left: string, right: string) {
  const clean=(value:string)=>value.replace(/^v/i,'').split('+')[0];
  const parse=(value:string)=>{const[main,pre='']=clean(value).split('-',2);return{parts:main.split('.').map(x=>Number(x)||0),pre}};
  const a=parse(left),b=parse(right);for(let index=0;index<Math.max(a.parts.length,b.parts.length);index++){const delta=(a.parts[index]||0)-(b.parts[index]||0);if(delta)return delta>0?1:-1}
  if(a.pre===b.pre)return 0;if(!a.pre)return 1;if(!b.pre)return-1;return a.pre.localeCompare(b.pre,undefined,{numeric:true})>0?1:-1;
}

function validVersion(value:string){return /^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value)}
function exactAsset(release:GitHubRelease,name:string){return release.assets.find(asset=>asset.name===name)}

async function fetchJson(fetcher:typeof fetch,url:string){const response=await fetcher(url,{headers,signal:AbortSignal.timeout(8000)});if(!response.ok)throw Object.assign(new Error(`GitHub antwoordde met ${response.status}.`),{status:response.status});return response.json()}
async function fetchText(fetcher:typeof fetch,url:string){const response=await fetcher(url,{headers,signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error(`Release-asset antwoordde met ${response.status}.`);return response.text()}

function selectRelease(releases:GitHubRelease[],channel:UpdateChannel){return releases.filter(release=>!release.draft&&validVersion(release.tag_name)&&(channel!=='stable'||!release.prerelease)).sort((a,b)=>compareVersions(b.tag_name,a.tag_name))[0]}

async function manifestFromRelease(release:GitHubRelease,channel:UpdateChannel,fetcher:typeof fetch):Promise<UpdateManifest>{
  const version=release.tag_name.replace(/^v/i,'');const setupName=`ThuisHub-Setup-${version}.exe`;const setup=exactAsset(release,setupName);
  if(!setup)throw new Error(`De vereiste release-asset ${setupName} ontbreekt.`);
  let publishedManifest:any={};let sums='';
  const manifestAsset=exactAsset(release,'latest.json');const sumsAsset=exactAsset(release,'SHA256SUMS.txt');
  if(manifestAsset){try{publishedManifest=JSON.parse(await fetchText(fetcher,manifestAsset.browser_download_url))}catch{throw new Error('latest.json is beschadigd of niet leesbaar.')}}
  if(sumsAsset)sums=await fetchText(fetcher,sumsAsset.browser_download_url);
  const manifestHash=publishedManifest?.assets?.setup?.name===setupName?publishedManifest.assets.setup.sha256:'';
  const sumsHash=sums.split(/\r?\n/).map(line=>line.trim().split(/\s+[*]?/)).find(parts=>parts[1]===setupName)?.[0]||'';
  const digest=String(setup.digest||'').replace(/^sha256:/i,'');const sha256=String(manifestHash||sumsHash||digest).toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(sha256))throw new Error('De release bevat geen geldige SHA-256 voor de exacte installerasset.');
  if(manifestHash&&sumsHash&&manifestHash.toLowerCase()!==sumsHash.toLowerCase())throw new Error('latest.json en SHA256SUMS.txt spreken elkaar tegen.');
  if(digest&&sha256!==digest.toLowerCase())throw new Error('De GitHub asset-digest komt niet overeen met het release-manifest.');
  return{product:'ThuisHub',version,channel,tag:release.tag_name,downloadUrl:setup.browser_download_url,sha256,releaseNotes:release.body||'',size:setup.size,publishedAt:release.published_at,releasePage:release.html_url,assetName:setupName,githubDigest:digest||undefined,minimumSupportedVersion:publishedManifest.minimumSupportedVersion};
}

export async function checkForUpdates(fetcher:typeof fetch=fetch){
  const channel=getSetting('updateChannel','stable') as UpdateChannel;
  if(channel==='development'&&getSetting('developmentUpdatesEnabled','false')!=='true')return{configured:true,currentVersion:APP_VERSION,available:false,channel,message:'Ontwikkelingsupdates zijn uitgeschakeld in geavanceerde instellingen.'};
  try{
    let release:GitHubRelease|undefined;
    if(channel==='stable')release=await fetchJson(fetcher,`${GITHUB_API}/releases/latest`) as GitHubRelease;
    else{const list=await fetchJson(fetcher,`${GITHUB_API}/releases?per_page=30`) as GitHubRelease[];release=selectRelease(list,channel)}
    if(!release||release.draft||channel==='stable'&&release.prerelease) return{configured:true,currentVersion:APP_VERSION,available:false,channel,message:'Er is nog geen officiële ThuisHub-release gepubliceerd.'};
    const manifest=await manifestFromRelease(release,channel,fetcher);const available=compareVersions(manifest.version,APP_VERSION)>0;
    const result={...manifest,available};setSetting('lastUpdateCheckAt',new Date().toISOString());setSetting('lastUpdateResult',JSON.stringify(result));
    log('INFO','updater','GitHub Releases-updatecontrole voltooid.',{currentVersion:APP_VERSION,remoteVersion:manifest.version,channel,available,asset:manifest.assetName});
    return{configured:true,currentVersion:APP_VERSION,available,channel,manifest,message:available?`ThuisHub ${manifest.version} is beschikbaar.`:'ThuisHub is bijgewerkt. Je gebruikt de nieuwste stabiele versie.'};
  }catch(error:any){
    const noRelease=error?.status===404;log(noRelease?'INFO':'WARNING','updater',noRelease?'Er is nog geen officiële release.':'GitHub-updatecontrole mislukt; de huidige installatie blijft actief.',{status:error?.status,error:error?.message});
    return{configured:true,currentVersion:APP_VERSION,available:false,channel,offline:!noRelease,message:noRelease?'Er is nog geen officiële ThuisHub-release gepubliceerd.':'De updatecontrole kon GitHub niet bereiken. Je huidige versie blijft gewoon werken.'};
  }
}

let downloadInProgress=false;
type UpdateDownloadState='idle'|'downloading'|'verifying'|'ready'|'error';
type UpdateDownloadProgress={state:UpdateDownloadState;version?:string;fileName?:string;downloadedBytes:number;totalBytes:number;percent:number;startedAt?:string;completedAt?:string;error?:string};
const idleDownloadProgress:UpdateDownloadProgress={state:'idle',downloadedBytes:0,totalBytes:0,percent:0};
let downloadProgress:UpdateDownloadProgress={...idleDownloadProgress};
const MAX_UPDATE_BYTES=1024*1024*1024;

function progressPercent(downloadedBytes:number,totalBytes:number){return totalBytes>0?Math.min(100,Math.max(0,Math.round(downloadedBytes/totalBytes*1000)/10)):0}

export function updateDownloadStatus(){
  if(!downloadInProgress&&downloadProgress.state==='idle'){
    const downloaded=downloadedUpdateStatus();
    if(downloaded.ready)return{state:'ready' as const,version:downloaded.version,fileName:downloaded.fileName,downloadedBytes:downloaded.bytes||0,totalBytes:downloaded.bytes||0,percent:100,completedAt:downloaded.downloadedAt};
  }
  return{...downloadProgress};
}

export async function downloadUpdate(manifest:UpdateManifest,fetcher:typeof fetch=fetch){
  if(downloadInProgress)throw new Error('Er is al een update-download actief.');
  const expectedName=manifest.assetName||`ThuisHub-Setup-${manifest.version}.exe`;
  const expectedPrefix=`https://github.com/${GITHUB_REPOSITORY}/releases/download/`;
  if(!validVersion(manifest.version)||!manifest.downloadUrl.startsWith(expectedPrefix)||expectedName!==`ThuisHub-Setup-${manifest.version}.exe`||!/^[a-f0-9]{64}$/i.test(manifest.sha256))throw new Error('Het update-manifest is ongeldig.');
  downloadInProgress=true;fs.mkdirSync(appPaths.updatesDir,{recursive:true});const name=manifest.assetName||`ThuisHub-Setup-${manifest.version}.exe`;const target=path.join(appPaths.updatesDir,path.basename(name));const temporary=`${target}.${crypto.randomBytes(5).toString('hex')}.part`;
  downloadProgress={state:'downloading',version:manifest.version,fileName:name,downloadedBytes:0,totalBytes:Number(manifest.size)||0,percent:0,startedAt:new Date().toISOString()};
  try{
    if(manifest.size&&manifest.size>MAX_UPDATE_BYTES)throw new Error('De update is onverwacht groot.');
    const response=await fetcher(manifest.downloadUrl,{headers,signal:AbortSignal.timeout(900000)});if(!response.ok)throw new Error(`Download mislukt (${response.status}).`);
    const declaredLength=Number(response.headers.get('content-length')||0);
    if(declaredLength>MAX_UPDATE_BYTES||manifest.size&&declaredLength&&declaredLength!==manifest.size)throw new Error('De downloadgrootte komt niet overeen met de GitHub-release.');
    const totalBytes=Number(manifest.size)||declaredLength||0;downloadProgress={...downloadProgress,totalBytes};
    const digest=crypto.createHash('sha256');let received=0;const handle=fs.openSync(temporary,'wx');
    try{
      if(!response.body)throw new Error('GitHub leverde geen downloadgegevens.');
      const reader=response.body.getReader();
      while(true){const{done,value}=await reader.read();if(done)break;if(!value?.byteLength)continue;received+=value.byteLength;if(received>MAX_UPDATE_BYTES||totalBytes&&received>totalBytes)throw new Error('De update is onverwacht groot.');fs.writeSync(handle,value);digest.update(value);downloadProgress={...downloadProgress,downloadedBytes:received,totalBytes,percent:progressPercent(received,totalBytes)}}
    }finally{fs.closeSync(handle)}
    if(manifest.size&&received!==manifest.size)throw new Error('De downloadgrootte komt niet overeen met de GitHub-release.');
    downloadProgress={...downloadProgress,state:'verifying',downloadedBytes:received,totalBytes:totalBytes||received,percent:100};
    const hash=digest.digest('hex');if(hash.toLowerCase()!==manifest.sha256.toLowerCase())throw new Error('De integriteitscontrole van de update is mislukt. De huidige installatie blijft ongewijzigd.');
    if(manifest.githubDigest&&hash.toLowerCase()!==manifest.githubDigest.toLowerCase())throw new Error('De GitHub asset-digest is ongeldig.');
    fs.rmSync(target,{force:true});fs.renameSync(temporary,target);const completedAt=new Date().toISOString();setSetting('downloadedUpdateResult',JSON.stringify({version:manifest.version,fileName:name,bytes:received,sha256:hash,downloadedAt:completedAt}));downloadProgress={state:'ready',version:manifest.version,fileName:name,downloadedBytes:received,totalBytes:received,percent:100,startedAt:downloadProgress.startedAt,completedAt};log('INFO','updater','GitHub-update gedownload; grootte en SHA-256 zijn gecontroleerd.',{version:manifest.version,file:target,bytes:received});
    return{file:target,fileName:name,version:manifest.version,bytes:received,sha256:hash,sha256Verified:true,digitallySigned:false,installRequiresConsent:true};
  }catch(error){fs.rmSync(temporary,{force:true});fs.rmSync(target,{force:true});const message=error instanceof Error?error.message:String(error);downloadProgress={...downloadProgress,state:'error',error:message,percent:0};log('CRITICAL','updater','Updatebestand geweigerd; huidige installatie blijft actief.',{error:message});throw error}
  finally{downloadInProgress=false}
}

type DownloadedUpdateRecord={version:string;fileName:string;bytes:number;sha256:string;downloadedAt:string};
const installRequestFile=path.join(appPaths.updatesDir,'install-request.json');

function storedJson<T>(key:string):Partial<T>{try{return JSON.parse(getSetting(key,'{}')||'{}')}catch{return{}}}

export function downloadedUpdateStatus(){
  const trusted=storedJson<UpdateManifest&{available:boolean}>('lastUpdateResult');
  const downloaded=storedJson<DownloadedUpdateRecord>('downloadedUpdateResult');
  const expectedName=trusted.version?`ThuisHub-Setup-${trusted.version}.exe`:'';
  const target=expectedName?path.join(appPaths.updatesDir,expectedName):'';
  const exists=Boolean(target&&fs.existsSync(target));
  const bytes=exists?fs.statSync(target).size:0;
  const ready=Boolean(trusted.available&&validVersion(String(trusted.version||''))&&downloaded.version===trusted.version&&downloaded.fileName===expectedName&&downloaded.sha256===trusted.sha256&&/^[a-f0-9]{64}$/i.test(String(downloaded.sha256||''))&&bytes===downloaded.bytes&&(!trusted.size||bytes===trusted.size));
  return{ready,version:ready?downloaded.version:undefined,fileName:ready?downloaded.fileName:undefined,bytes:ready?bytes:undefined,downloadedAt:ready?downloaded.downloadedAt:undefined,sha256Verified:ready};
}

function verifiedDownloadedUpdate(){
  const status=downloadedUpdateStatus();
  if(!status.ready||!status.version||!status.fileName)throw Object.assign(new Error('Download de update eerst opnieuw en laat de SHA-256-controle voltooien.'),{status:409});
  const trusted=storedJson<UpdateManifest&{available:boolean}>('lastUpdateResult');
  const file=path.join(appPaths.updatesDir,status.fileName);
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(hash.toLowerCase()!==String(trusted.sha256||'').toLowerCase()||trusted.githubDigest&&hash.toLowerCase()!==trusted.githubDigest.toLowerCase()){
    fs.rmSync(file,{force:true});setSetting('downloadedUpdateResult','{}');
    throw Object.assign(new Error('De gedownloade installer is gewijzigd of beschadigd en is verwijderd. Download de update opnieuw.'),{status:409});
  }
  return{version:status.version,fileName:status.fileName,file,bytes:status.bytes!,sha256:hash};
}

export function requestUpdateInstall(options:{desktop?:boolean;execProcess?:ExecProcessLike;shutdown?:()=>void}={}){
  if(process.platform!=='win32')throw Object.assign(new Error('Automatisch installeren wordt alleen op Windows ondersteund.'),{status:400});
  const update=verifiedDownloadedUpdate();
  const desktop=options.desktop??process.env.THUIS_HUB_DESKTOP==='true';
  if(desktop){
    fs.mkdirSync(appPaths.updatesDir,{recursive:true});const temporary=`${installRequestFile}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    fs.writeFileSync(temporary,JSON.stringify({...update,requestedAt:new Date().toISOString()}));fs.renameSync(temporary,installRequestFile);
    log('INFO','updater','Installatieverzoek veilig overgedragen aan de Windows-app.',{version:update.version,fileName:update.fileName});
    return{accepted:true,mode:'desktop',version:update.version,message:'ThuisHub wordt afgesloten. De oude programmaversie wordt automatisch vervangen en de nieuwe versie start daarna.'};
  }
  updateHandoff.launchInstallerAfterExit(update.file,process.pid,{execProcess:options.execProcess});
  (options.shutdown||(()=>{const timer=setTimeout(()=>process.kill(process.pid,'SIGTERM'),1200);timer.unref()}))();
  log('INFO','updater','Installer gepland na het afsluiten van de browser-server.',{version:update.version,fileName:update.fileName});
  return{accepted:true,mode:'browser',version:update.version,message:'De server sluit af. De oude programmaversie wordt automatisch vervangen en de nieuwe versie start daarna.'};
}

export const updateInternals={compareVersions,selectRelease,manifestFromRelease,exactAsset,headers,GITHUB_API,installRequestFile,verifiedDownloadedUpdate,launchInstallerAfterExit:updateHandoff.launchInstallerAfterExit,setDownloadInProgress:(value:boolean)=>{downloadInProgress=value;if(!value)downloadProgress={...idleDownloadProgress}}};
