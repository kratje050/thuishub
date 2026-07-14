import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import mime from 'mime-types';
import { execFile } from 'node:child_process';
import { createUser, requireAdmin, requireAuth } from '../auth.js';
import { databaseIntegrity, db, getSetting, publicSettings, setSetting } from '../db.js';
import { scanLibrary, scanState } from '../media.js';
import { applyLocalMetadata, applyProviderMatch, metadataContext, metadataDashboard, metadataProviders, metadataStatusForMedia, migrateLegacyTmdbMetadata, processMetadataMedia, retryMetadataQueue, searchMetadata } from '../metadata/index.js';
import { applyManualMetadata, metadataFieldStates, metadataHistory, restoreMetadataHistory, setMetadataFieldLock } from '../metadata/apply.js';
import { cacheExternalImage, cacheLocalImage, clearMetadataImageCache, imageApiUrl, metadataImageFile, removeMetadataImage, selectMetadataImage } from '../metadata/images.js';
import { clearProviderCache, providerOrder, setProviderEnabled, setProviderOrder } from '../metadata/store.js';
import { clearOmdbApiKey, getOmdbApiKey, secretsStatus, setOmdbApiKey } from '../metadata/secrets.js';
import type { MetadataProviderId } from '../metadata/types.js';
import { ensureHls, hlsFile, isDirectPlayable } from '../transcode.js';
import { detectedGpus, videoEncoder } from '../ffmpeg.js';
import { listActivity, patchActivity, removeActivity, updateActivity } from '../activity.js';
import { audit, emitWebhook } from '../webhooks.js';
import { optimizedFile, optimizationList, queueOptimization } from '../optimizer.js';
import { previewThumbnail } from '../thumbnails.js';
import { photoThumbnail } from '../extra-media.js';
import { refreshTvSource } from '../live-tv.js';
import { createBackup, exportDatabase, listBackups, resolveBackup, scheduleRestore, verifyBackup } from '../backup.js';
import { APP_NAME, APP_PORT, APP_VERSION } from '../constants.js';
import { appPaths } from '../paths.js';
import { clearLogs, log, logStorageBytes, readLogs, setMaxLogStorageMb } from '../logger.js';
import { tailscaleStatus } from '../tailscale.js';
import { checkForUpdates, downloadedUpdateStatus, downloadUpdate, requestUpdateInstall } from '../updates.js';
import { BROWSER_CAPABILITIES, CAST_CAPABILITIES, QUALITY_PROFILES, decisionEngine, type DeviceCapabilities, type QualityId } from '../playback.js';
import { mediaCapabilitiesFromRow } from '../media-info.js';
import { createPlaybackGrant, createPlaybackToken, renewPlaybackGrant } from '../playback-tokens.js';
import { acknowledgeDeviceCommand, approvePairing, claimPairing, deviceCapabilities, forgetDevice, listDevices, pendingDeviceCommands, requestPairing, requireDevice, setDeviceOverrides } from '../devices.js';
import { assignedPrivateAddresses, isLanListenerEndpoint, isPrivateIpv4, isValidLanStreamingPort, lanPlaybackBaseUrl, lanStreamingStatus } from '../network.js';
import { playbackDeviceRegistry } from '../playback-devices/registry.js';
import { diagnostics as playbackDiscoveryDiagnostics, discoverPlaybackDevices } from '../playback-devices/discovery-service.js';
import { controlPlaybackSession, createPlaybackSession, getActivePlaybackSession, getPlaybackSession, listActivePlaybackSessions, playbackTransferSourceId, stopPlaybackSession, updatePlaybackSession } from '../playback-devices/sessions.js';
import { DlnaController, type DlnaControllerTarget } from '../playback-devices/providers/dlna.js';
import { startConfirmedDlnaPlayback } from '../playback-devices/dlna-start.js';
import { broadcastPlaybackSession, dispatchDeviceCommand } from '../playback-devices/websocket.js';
import { runDiscoveryDiagnostics } from '../playback-devices/diagnostics.js';
import { adjacentEpisodeId } from '../playback-devices/navigation.js';
import { abortPlaybackTransfer, armPlaybackTransferTimeout, assertPlaybackTransferControllerActionAllowed, disarmPlaybackTransferTimeout, finalizePlaybackTransfer, isPendingPlaybackTransfer, resolvePlaybackHandoffSource, stopPlaybackReceiver } from '../playback-devices/transfers.js';
import { databaseTimestampMs } from '../time.js';

export const apiRouter = Router();
const deviceRatingLevels:Record<string,number>={ALL:99,AL:0,G:0,TV_Y:0,TV_G:0,'6':6,PG:8,TV_PG:9,'9':9,'12':12,PG_13:13,'14':14,TV_14:14,'16':16,R:16,NC_17:18,'18':18,TV_MA:18};

const pairingAttempts = new Map<string,{count:number;resetAt:number}>();
function pairingRateLimit(limit=20){return(req:any,res:any,next:any)=>{const key=String(req.socket.remoteAddress||'unknown').replace(/^::ffff:/,'');const now=Date.now();const current=pairingAttempts.get(key);const bucket=!current||current.resetAt<=now?{count:0,resetAt:now+60_000}:current;bucket.count+=1;pairingAttempts.set(key,bucket);if(bucket.count>limit){res.setHeader('Retry-After',String(Math.ceil((bucket.resetAt-now)/1000)));return res.status(429).json({error:'Te veel koppelpogingen. Wacht een minuut en probeer opnieuw.'})}next()}};
function requirePairingLanListener(req:any,res:any,next:any){const status=lanStreamingStatus();if(!status.listening||!isLanListenerEndpoint(req.socket.localAddress,req.socket.localPort,status.address,status.port))return res.status(403).json({error:'Een tv kan alleen koppelen via de beperkte poort van hetzelfde privé-thuisnetwerk.'});next()}

apiRouter.post('/devices/pair/request',requirePairingLanListener,pairingRateLimit(), (req,res,next)=>{try{const remote=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');res.status(201).json(requestPairing({...req.body,address:isPrivateIpv4(remote)?remote:undefined}))}catch(error){next(error)}});
apiRouter.post('/devices/pair/claim',requirePairingLanListener,pairingRateLimit(30), (req,res)=>{const result=claimPairing(String(req.body?.deviceId||''),String(req.body?.pairingSecret||''));res.status(result.status==='expired'?410:200).json(result)});
apiRouter.get('/device/commands',requireDevice,(req,res)=>res.json({items:pendingDeviceCommands(req.playbackDevice!.id)}));
apiRouter.post('/device/commands/:id/ack',requireDevice,(req,res)=>res.json({ok:acknowledgeDeviceCommand(req.playbackDevice!.id,Number(req.params.id))}));
apiRouter.get('/device/library',requireDevice,(req,res)=>{const profile=db.prepare('SELECT role,max_content_rating maxRating FROM users WHERE id=?').get(req.playbackDevice!.userId) as any;if(!profile)return res.status(403).end();const rows=db.prepare('SELECT * FROM media_items ORDER BY sort_title COLLATE NOCASE').all() as any[];const max=deviceRatingLevels[String(profile.maxRating||'ALL').toUpperCase().replace(/[- ]/g,'_')]??99;res.json(rows.filter(row=>profile.role==='admin'||max===99||Boolean(row.content_rating&&row.content_rating!=='ONBEKEND'&&(deviceRatingLevels[String(row.content_rating).toUpperCase().replace(/[- ]/g,'_')]??99)<=max)).map(row=>({id:row.id,kind:row.kind,title:row.title,seriesTitle:row.series_title,season:row.season,episode:row.episode,year:row.year,width:row.width,height:row.height,hdrType:row.hdr_type,audioCodec:row.audio_codec,atmos:Boolean(row.atmos),posterUrl:imageApiUrl(row.id,'poster')})))});
apiRouter.post('/device/media/:id/session',requireDevice,async(req,res,next)=>{try{
  const profile=db.prepare('SELECT role,max_content_rating maxRating FROM users WHERE id=?').get(req.playbackDevice!.userId) as any;
  if(!profile)return res.status(403).json({error:'Het gekoppelde profiel bestaat niet meer.'});
  const result=await beginPlaybackOnDevice({
    userId:req.playbackDevice!.userId,
    admin:profile.role==='admin',
    maxContentRating:profile.maxRating,
    mediaId:Number(req.params.id),
    deviceId:req.playbackDevice!.id,
    startPosition:Number(req.body?.startPosition)||0,
    quality:(req.body?.quality||'auto') as QualityId,
    controllerId:`device:${req.playbackDevice!.id}`,
    availableBandwidthMbps:Number(req.body?.availableBandwidthMbps)||undefined,
    dispatchLoad:false,
  });
  broadcastPlaybackSession(result.session);
  res.status(201).json(result);
}catch(error){next(error)}});
apiRouter.post('/device/media/:id/decision',requireDevice,(req,res)=>{const mediaId=Number(req.params.id);const row=db.prepare('SELECT * FROM media_items WHERE id=?').get(mediaId) as any;if(!row)return res.status(404).json({error:'Media niet gevonden.'});const profile=db.prepare('SELECT role,max_content_rating maxRating FROM users WHERE id=?').get(req.playbackDevice!.userId) as any;if(!profile||!ratingAllowed(row.content_rating,profile.maxRating,profile.role==='admin'))return res.status(403).json({error:'Dit profiel mag deze media niet afspelen.'});const capabilities=deviceCapabilities(req.playbackDevice!.id);if(!capabilities)return res.status(403).json({error:'Apparaatprofiel ontbreekt.'});const base=lanPlaybackBaseUrl();if(!base)return res.status(409).json({error:'De priv\u00e9-LAN-streamserver is niet actief. Start ThuisHub opnieuw nadat je thuisnetwerkstreaming hebt ingesteld.'});const decision=decisionEngine({media:mediaCapabilitiesFromRow(row),device:capabilities,quality:(req.body?.quality||'auto') as QualityId,availableBandwidthMbps:Number(req.body?.availableBandwidthMbps)||undefined,network:'lan'});const resource=decision.mode==='direct_play'?'file':'hls';const token=createPlaybackToken({mediaId,resource,userId:req.playbackDevice!.userId,deviceId:req.playbackDevice!.id,options:{copyVideo:decision.copyVideo,copyAudio:decision.copyAudio,burnSubtitles:decision.burnSubtitles,targetBitrateMbps:decision.targetBitrateMbps,targetWidth:decision.targetWidth,targetHeight:decision.targetHeight}},resource==='file'?600:3600);const subtitle=row.subtitle_path?createPlaybackToken({mediaId,resource:'subtitle',userId:req.playbackDevice!.userId,deviceId:req.playbackDevice!.id},3600):'';res.json({decision,technical:mediaCapabilitiesFromRow(row),urls:{playback:`${base}/api/playback/${mediaId}/${resource==='file'?'file':'hls/index.m3u8'}?token=${encodeURIComponent(token)}`,subtitle:subtitle?`${base}/api/playback/${mediaId}/subtitle?token=${encodeURIComponent(subtitle)}`:''}})});
apiRouter.put('/device/media/:id/progress',requireDevice,async(req,res)=>{
  const position=Math.max(0,Number(req.body?.position)||0);const duration=Math.max(0,Number(req.body?.duration)||0);const sessionId=String(req.body?.sessionId||'');
  if(sessionId){
    const current=getPlaybackSession(sessionId,req.playbackDevice!.userId);
    if(!current||current.deviceId!==req.playbackDevice!.id||current.mediaId!==Number(req.params.id))return res.status(409).json({error:'Deze voortgang hoort niet bij de actieve afspeelsessie.'});
    if(current.endedAt)return res.json({position:current.position,duration:current.duration,completed:current.duration>0&&current.position/current.duration>=.92,revision:current.revision,stopped:true});
    const terminalState=String(req.body?.state);
    if(terminalState==='stopped'||terminalState==='error'){
      if(isPendingPlaybackTransfer(current)){
        const rolledBack=await abortPlaybackTransfer(current,terminalState==='error'?'receiver-error':'receiver-stopped');
        broadcastPlaybackSession(rolledBack.activeSession);
        return res.json({position:rolledBack.session.position,duration:rolledBack.session.duration,completed:false,revision:rolledBack.session.revision,stopped:true,rolledBack:true});
      }
      const stopped=stopPlaybackSession({id:current.id,userId:current.userId,revision:current.revision,position,duration,reason:terminalState==='error'?'receiver-error':'receiver-stopped'});
      broadcastPlaybackSession(stopped);
      return res.json({position:stopped.position,duration:stopped.duration,completed:stopped.duration>0&&stopped.position/stopped.duration>=.92,revision:stopped.revision,stopped:true});
    }
    const state=['playing','paused','buffering'].includes(String(req.body?.state))?req.body.state:current.state;
    let session=updatePlaybackSession({id:current.id,userId:current.userId,revision:current.revision,state,position,duration});
    if(state==='playing')session=await finalizePlaybackTransfer(session);
    broadcastPlaybackSession(session);
    return res.json({position:session.position,duration:session.duration,completed:session.duration>0&&session.position/session.duration>=.92,revision:session.revision});
  }
  const pendingDeviceSession=listActivePlaybackSessions(req.playbackDevice!.userId).find(session=>session.deviceId===req.playbackDevice!.id&&session.mediaId===Number(req.params.id)&&isPendingPlaybackTransfer(session));
  if(pendingDeviceSession)return res.status(409).json({error:'Stuur de sessiesleutel mee zolang deze ontvanger op een afspeeloverdracht wacht.',code:'PLAYBACK_SESSION_ID_REQUIRED'});
  const completed=duration>0&&position/duration>=.92?1:0;db.prepare(`INSERT INTO progress(user_id,media_id,position,duration,completed,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,media_id) DO UPDATE SET position=excluded.position,duration=excluded.duration,completed=excluded.completed,updated_at=CURRENT_TIMESTAMP`).run(req.playbackDevice!.userId,Number(req.params.id),position,duration,completed);res.json({position,duration,completed:Boolean(completed)});
});
apiRouter.use(requireAuth);

const ratingLevels:Record<string,number>={ALL:99,AL:0,G:0,TV_Y:0,TV_G:0,'6':6,PG:8,TV_PG:9,'9':9,'12':12,PG_13:13,'14':14,TV_14:14,'16':16,R:16,NC_17:18,'18':18,TV_MA:18};
function ratingAllowed(rating:string|null,max:string|undefined,admin:boolean){if(admin||!max||max==='ALL')return true;if(!rating||rating==='ONBEKEND')return false;const normalize=(x:string)=>x.toUpperCase().replace(/[- ]/g,'_');return(ratingLevels[normalize(rating)]??99)<=(ratingLevels[normalize(max)]??99)}

function playbackTarget(deviceId:string,userId:number){
  if(deviceId==='local-browser'||/^local-browser:[a-zA-Z0-9_-]{8,80}$/.test(deviceId))return{device:null,protocol:'local-browser',capabilities:BROWSER_CAPABILITIES,needsLan:false};
  if(deviceId==='google-cast')return{device:null,protocol:'google-cast',capabilities:CAST_CAPABILITIES,needsLan:true};
  const device=playbackDeviceRegistry.getForUser(deviceId,userId);
  if(!device||!device.online)return null;
  if(device.requiresPairing&&!device.trusted)return null;
  return{device,protocol:device.protocol,capabilities:device.capabilities,needsLan:device.protocol!=='local-browser'};
}

function playbackUrls(base:string,mediaId:number,sessionId:string,decision:any,hasSubtitle:boolean){
  const resource=decision.mode==='direct_play'?'file':'hls';
  const options={copyVideo:decision.copyVideo,copyAudio:decision.copyAudio,burnSubtitles:decision.burnSubtitles,targetBitrateMbps:decision.targetBitrateMbps,targetWidth:decision.targetWidth,targetHeight:decision.targetHeight};
  const playback=createPlaybackGrant({sessionId,resource,options},600);
  const subtitle=hasSubtitle?createPlaybackGrant({sessionId,resource:'subtitle'},600):'';
  const artwork=createPlaybackGrant({sessionId,resource:'artwork'},600);
  return{playback:`${base}/api/playback/${mediaId}/${resource==='file'?'file':'hls/index.m3u8'}?token=${encodeURIComponent(playback)}`,subtitle:subtitle?`${base}/api/playback/${mediaId}/subtitle?token=${encodeURIComponent(subtitle)}`:'',artwork:`${base}/api/playback/${mediaId}/artwork?token=${encodeURIComponent(artwork)}`,expiresInSeconds:600,slidingWhileSessionActive:true};
}

function dlnaController(deviceId:string){
  const device=playbackDeviceRegistry.get(deviceId);
  const services=device?.metadata?.services as DlnaControllerTarget['services']|undefined;
  if(!device?.address||!services?.avTransport)throw Object.assign(new Error('De DLNA-bedieningsgegevens van dit apparaat ontbreken.'),{status:409});
  return new DlnaController({address:device.address,services});
}

function dlnaMetadata(title:string,artworkUrl:string){
  const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="0" restricted="1"><dc:title>${escape(title)}</dc:title><upnp:class>object.item.videoItem</upnp:class>${artworkUrl?`<upnp:albumArtURI>${escape(artworkUrl)}</upnp:albumArtURI>`:''}</item></DIDL-Lite>`;
}

function sessionPresentation(session:any,row:any,target:any,urls:any){
  const nextId=adjacentEpisodeId(Number(row.id),'next');
  const previousId=adjacentEpisodeId(Number(row.id),'previous');
  return{
    session:{...session,...sessionControlPresentation(session),canSkipNext:target.protocol!=='local-browser'&&Boolean(nextId),canSkipPrevious:target.protocol!=='local-browser'&&Boolean(previousId),canChangeQuality:target.protocol!=='local-browser',canChangeSubtitleTrack:target.protocol==='google-cast'&&Boolean(row.subtitle_path),subtitleTracks:row.subtitle_path?[{id:'external-subtitle',label:'Ondertiteling',language:'nl'}]:[]},
    media:{id:Number(row.id),kind:row.kind,title:row.title,seriesTitle:row.series_title||undefined,season:row.season||undefined,episode:row.episode||undefined,year:row.year||undefined,videoCodec:row.video_codec||undefined,duration:Number(row.duration)||0},
    urls,
    navigation:{nextMediaId:nextId,previousMediaId:previousId},
  };
}

function sessionControlPresentation(session:any){
  const presentation:Record<string,unknown>={};
  if(Number.isFinite(Number(session?.metadata?.volume)))presentation.volume=Math.max(0,Math.min(1,Number(session.metadata.volume)));
  if(Object.prototype.hasOwnProperty.call(session?.metadata||{},'activeSubtitleTrackId'))presentation.activeSubtitleTrackId=session.metadata.activeSubtitleTrackId;
  return presentation;
}

async function beginPlaybackOnDevice(input:{userId:number;admin:boolean;maxContentRating?:string;mediaId:number;deviceId:string;startPosition?:number;quality?:QualityId;controllerId?:string;localBase?:string;customMaxBitrateMbps?:number;availableBandwidthMbps?:number;forceSdr?:boolean;dispatchLoad?:boolean;atomicHandoff?:boolean;handoffFromSessionId?:string;allowSameDeviceHandoff?:boolean}){
  const row=db.prepare('SELECT * FROM media_items WHERE id=?').get(input.mediaId) as any;
  if(!row)throw Object.assign(new Error('Media niet gevonden.'),{status:404});
  if(!ratingAllowed(row.content_rating,input.maxContentRating,input.admin))throw Object.assign(new Error('Dit profiel mag deze media niet afspelen.'),{status:403});
  const target=playbackTarget(input.deviceId,input.userId);
  if(!target)throw Object.assign(new Error('Afspeelapparaat niet gevonden, offline of nog niet gekoppeld.'),{status:404});
  const base=target.needsLan?lanPlaybackBaseUrl():input.localBase;
  if(!base)throw Object.assign(new Error('De privé-LAN-streamserver is niet actief. Kies een geldig LAN-adres en start ThuisHub opnieuw.'),{status:409,localStreamingRequired:true});
  const quality=QUALITY_PROFILES.some(item=>item.id===input.quality)?input.quality!:'auto';
  const decision=decisionEngine({media:mediaCapabilitiesFromRow(row),device:target.capabilities,quality,customMaxBitrateMbps:input.customMaxBitrateMbps,availableBandwidthMbps:input.availableBandwidthMbps,network:target.needsLan?'lan':'unknown',forceSdr:Boolean(input.forceSdr)});
  const activeBefore=listActivePlaybackSessions(input.userId);
  const resolvedHandoffSource=input.atomicHandoff===false?null:resolvePlaybackHandoffSource(input.userId,input.deviceId);
  const sameCastSource=input.atomicHandoff===false||target.protocol!=='google-cast'?null:activeBefore.find(item=>item.deviceId===input.deviceId&&item.protocol==='google-cast'&&!item.endedAt&&!playbackTransferSourceId(item));
  const handoffSourceId=input.handoffFromSessionId||resolvedHandoffSource?.id||sameCastSource?.id;
  const metadata:Record<string,unknown>={quality,title:row.title};
  if(target.protocol==='google-cast'&&row.subtitle_path)metadata.activeSubtitleTrackId='external-subtitle';
  let session=createPlaybackSession({userId:input.userId,mediaId:input.mediaId,deviceId:input.deviceId,protocol:target.protocol,startPosition:Math.max(0,Number(input.startPosition)||0),duration:Number(row.duration)||0,state:'connecting',controllerId:String(input.controllerId||'web').slice(0,200),playbackMode:decision.mode,metadata,handoffFromSessionId:handoffSourceId,allowSameDeviceHandoff:input.allowSameDeviceHandoff||Boolean(sameCastSource)});
  if(isPendingPlaybackTransfer(session))armPlaybackTransferTimeout(session);
  for(const replaced of activeBefore){
    if(replaced.id!==handoffSourceId&&playbackTransferSourceId(replaced)){
      disarmPlaybackTransferTimeout(replaced.id);
      await stopPlaybackReceiver(replaced,'transfer-replaced');
    }
  }
  const failNewSession=async(reason:string)=>{
    if(isPendingPlaybackTransfer(session))await abortPlaybackTransfer(session,reason);
    else if(!getPlaybackSession(session.id,input.userId)?.endedAt)stopPlaybackSession({id:session.id,userId:input.userId,reason});
  };
  let urls:ReturnType<typeof playbackUrls>;
  try{urls=playbackUrls(base,input.mediaId,session.id,decision,Boolean(row.subtitle_path))}
  catch(error){await failNewSession('load-failed');throw error}
  if((target.protocol==='thuishub-tv-app'||target.protocol==='android-tv'||target.protocol==='samsung-tizen')&&input.dispatchLoad!==false){
    try{dispatchDeviceCommand(input.deviceId,'load',{sessionId:session.id,mediaId:input.mediaId,title:row.title,position:session.position,urls,decision})}
    catch(error){await failNewSession('load-failed');throw error}
  }else if(target.protocol==='dlna-upnp'){
    try{
      const started=await startConfirmedDlnaPlayback({
        controller:dlnaController(input.deviceId),
        session,
        uri:urls.playback,
        metadata:dlnaMetadata(row.title,urls.artwork),
      });
      session=started.session;
    }catch(error){throw Object.assign(new Error(`De DLNA-tv kon het afspelen niet starten: ${error instanceof Error?error.message:String(error)}`),{status:502})}
  }
  return{...sessionPresentation(session,row,target,urls),decision,technical:{...mediaCapabilitiesFromRow(row),fileSize:row.size,duration:row.duration},device:target.device||{id:input.deviceId,name:target.protocol==='google-cast'?'Google Cast':'Deze browser',protocol:target.protocol}};
}

apiRouter.get('/bootstrap', (req, res) => {
  const sources = db.prepare('SELECT id, name, path, kind, created_at createdAt FROM sources ORDER BY name').all();
  const port = Number(process.env.PORT || 8787);
  const networkUrls = [`http://localhost:${port}`];
  res.json({ user: req.user, settings: publicSettings(), sources, scan: scanState, networkUrls });
});

apiRouter.get('/playback/quality-profiles',(_req,res)=>res.json(QUALITY_PROFILES));
apiRouter.get('/network/interfaces',requireAdmin,(_req,res)=>res.json({addresses:assignedPrivateAddresses(),selected:getSetting('localStreamingAddress',''),port:Number(getSetting('localStreamingPort','8788')),restartRequired:true,streaming:lanStreamingStatus()}));
apiRouter.get('/playback-devices',(req,res)=>res.json({items:playbackDeviceRegistry.list(req.user!.id),diagnostics:playbackDiscoveryDiagnostics()}));
apiRouter.post('/playback-devices/discover',async(_req,res,next)=>{try{res.json(await discoverPlaybackDevices('manual'))}catch(error){next(error)}});
apiRouter.get('/playback-devices/diagnostics',requireAdmin,(_req,res)=>res.json({...playbackDiscoveryDiagnostics(),streaming:lanStreamingStatus()}));
apiRouter.post('/playback-devices/diagnostics/run',requireAdmin,async(_req,res,next)=>{try{const discovery=await discoverPlaybackDevices('manual');const streaming=lanStreamingStatus();const dlna=await runDiscoveryDiagnostics({address:streaming.address,streamingPort:streaming.port,timeoutMs:2000});let windows:any=null;if(process.platform==='win32'){const script=path.resolve('scripts','diagnose-tv-discovery.ps1');if(fs.existsSync(script))windows=await new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Address',streaming.address,'-Port',String(streaming.port),'-TimeoutMs','2000','-Json'],{timeout:20_000,windowsHide:true,maxBuffer:1024*1024},(error,stdout,stderr)=>{if(error)return resolve({error:String(stderr||error.message).slice(0,500)});try{resolve(JSON.parse(stdout))}catch{resolve({error:'Het Windows-diagnoserapport kon niet worden gelezen.'})}}))}res.json({checkedAt:new Date().toISOString(),discovery,streaming,dlna,windows})}catch(error){next(error)}});
apiRouter.post('/playback-devices/cast-state',(req,res)=>{const connected=Boolean(req.body?.connected);if(!connected)return res.json({connected:false});const receiverId=String(req.body?.receiverId||'active-receiver').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||'active-receiver';const device=playbackDeviceRegistry.upsertDiscovered({name:String(req.body?.name||'Google Cast').slice(0,100),protocol:'google-cast',protocolId:`cast-session:${receiverId}`,deviceType:req.body?.deviceType==='audio'?'audio':'television',manufacturer:String(req.body?.manufacturer||'Google').slice(0,100),model:String(req.body?.model||'Cast-apparaat').slice(0,100),capabilities:CAST_CAPABILITIES,icon:req.body?.deviceType==='audio'?'speaker':'cast',requiresPairing:false,metadata:{reportedBy:'official-web-sender-sdk'}});res.json({connected:true,device})});
apiRouter.get('/playback-sessions/active',async(req,res,next)=>{try{
  let session=getActivePlaybackSession(req.user!.id);
  if(!session)return res.json({session:null});
  if(session.protocol==='dlna-upnp'&&!session.endedAt){
    try{
      const [position,transport]=await Promise.all([dlnaController(session.deviceId).getPosition(),dlnaController(session.deviceId).getTransportInfo()]);
      if(transport.state==='STOPPED'&&Date.now()-databaseTimestampMs(session.createdAt)>5000)session=stopPlaybackSession({id:session.id,userId:req.user!.id,revision:session.revision,position:position.positionSeconds,duration:position.durationSeconds||session.duration,reason:'receiver-stopped'});
      else{const state=transport.state==='PLAYING'?'playing':transport.state==='PAUSED_PLAYBACK'?'paused':session.state;session=updatePlaybackSession({id:session.id,userId:req.user!.id,revision:session.revision,state,position:position.positionSeconds,duration:position.durationSeconds||session.duration});}
      broadcastPlaybackSession(session);
    }catch{/* Sommige renderers ondersteunen statuspolling niet; de actieve sessie blijft bruikbaar. */}
  }
  const device=session.deviceId.startsWith('local-browser')?{id:session.deviceId,name:'Deze browser',protocol:'local-browser',capabilities:BROWSER_CAPABILITIES}:playbackDeviceRegistry.get(session.deviceId);
  const media=db.prepare('SELECT id,kind,title,series_title seriesTitle,season,episode,year,video_codec videoCodec,duration,subtitle_path subtitlePath FROM media_items WHERE id=?').get(session.mediaId) as any;
  const nextId=adjacentEpisodeId(session.mediaId,'next');const previousId=adjacentEpisodeId(session.mediaId,'previous');
  res.json({session:{...session,...sessionControlPresentation(session),device,media,canSkipNext:session.protocol!=='local-browser'&&Boolean(nextId),canSkipPrevious:session.protocol!=='local-browser'&&Boolean(previousId),canChangeQuality:session.protocol!=='local-browser',canChangeSubtitleTrack:session.protocol==='google-cast'&&Boolean(media?.subtitlePath),subtitleTracks:media?.subtitlePath?[{id:'external-subtitle',label:'Ondertiteling',language:'nl'}]:[]}});
}catch(error){next(error)}});
apiRouter.get('/playback-sessions/:id',(req,res)=>{const session=getPlaybackSession(String(req.params.id),req.user!.id);if(!session)return res.status(404).json({error:'Afspeelsessie niet gevonden.'});res.json({session})});
apiRouter.post('/playback-sessions',async(req,res,next)=>{try{
  const result=await beginPlaybackOnDevice({userId:req.user!.id,admin:req.user!.role==='admin',maxContentRating:req.user!.maxContentRating,mediaId:Number(req.body?.mediaId),deviceId:String(req.body?.deviceId||''),startPosition:Number(req.body?.startPosition)||0,quality:(req.body?.quality||'auto') as QualityId,controllerId:req.body?.controllerId,localBase:`${req.protocol}://${req.get('host')}`,customMaxBitrateMbps:Number(req.body?.customMaxBitrateMbps)||undefined,availableBandwidthMbps:Number(req.body?.availableBandwidthMbps)||undefined,forceSdr:Boolean(req.body?.forceSdr)});
  broadcastPlaybackSession(result.session);
  res.status(201).json(result);
}catch(error){next(error)}});
apiRouter.patch('/playback-sessions/:id',async(req,res,next)=>{try{
  const current=getPlaybackSession(String(req.params.id),req.user!.id);
  if(!current)return res.status(404).json({error:'Afspeelsessie niet gevonden.'});
  if(isPendingPlaybackTransfer(current))assertPlaybackTransferControllerActionAllowed(current,'patch');
  let session=updatePlaybackSession({id:current.id,userId:req.user!.id,revision:Number(req.body?.revision),state:req.body?.state,position:req.body?.position,duration:req.body?.duration,controllerId:req.body?.controllerId,metadata:req.body?.metadata});
  if(session.state==='error'&&isPendingPlaybackTransfer(session)){
    const rolledBack=await abortPlaybackTransfer(session,'receiver-error');
    broadcastPlaybackSession(rolledBack.activeSession);
    return res.json({session:rolledBack.session,activeSession:rolledBack.activeSession,rolledBack:true});
  }
  if(session.state==='error')session=stopPlaybackSession({id:session.id,userId:req.user!.id,revision:session.revision,position:session.position,duration:session.duration,reason:'receiver-error'});
  broadcastPlaybackSession(session);res.json({session});
}catch(error){next(error)}});
apiRouter.post('/playback-sessions/:id/browser-command/claim',(req,res,next)=>{try{
  const current=getPlaybackSession(String(req.params.id),req.user!.id);
  if(!current||current.endedAt)return res.status(404).json({error:'Actieve afspeelsessie niet gevonden.'});
  const revision=Number(req.body?.revision);
  if(!Number.isInteger(revision)||revision!==current.revision)return res.status(409).json({error:'De afspeelsessie is ondertussen op een ander apparaat bijgewerkt.',code:'STALE_PLAYBACK_SESSION',session:current});
  const command=current.metadata?.browserCommand as Record<string,unknown>|undefined;
  const commandId=String(req.body?.commandId||'');
  const claimedBy=String(req.body?.claimedBy||'');
  if(!command||String(command.id||'')!==commandId||!commandId||commandId.length>220)return res.status(409).json({error:'Deze browseropdracht is niet meer actueel.',code:'BROWSER_COMMAND_UNAVAILABLE'});
  if(!/^local-browser:[a-zA-Z0-9_-]{8,80}$/.test(claimedBy))return res.status(400).json({error:'De browserontvanger is ongeldig.'});
  if(command.claimedBy&&command.claimedBy!==claimedBy)return res.status(409).json({error:'Een ander ontvangervenster voert deze opdracht al uit.',code:'BROWSER_COMMAND_CLAIMED'});
  if(command.claimedBy===claimedBy)return res.json({session:current});
  const session=updatePlaybackSession({id:current.id,userId:req.user!.id,revision,metadata:{...current.metadata,browserCommand:{...command,claimedBy,claimedAt:Date.now()}}});
  broadcastPlaybackSession(session);
  res.json({session});
}catch(error){next(error)}});
apiRouter.post('/playback-sessions/:id/receiver-status',async(req,res,next)=>{try{
  const current=getPlaybackSession(String(req.params.id),req.user!.id);
  if(!current)return res.status(404).json({error:'Afspeelsessie niet gevonden.'});
  if(current.endedAt)return res.status(409).json({error:'Deze afspeelsessie is al gestopt.',code:'PLAYBACK_SESSION_ENDED'});
  if(current.protocol!=='google-cast'&&current.protocol!=='local-browser')return res.status(422).json({error:'Dit type ontvanger bevestigt de status via de gekoppelde apparaatverbinding.',code:'PLAYBACK_RECEIVER_STATUS_NOT_ALLOWED'});
  const state=String(req.body?.state||'');
  if(state!=='playing'&&state!=='error')return res.status(400).json({error:'Receiverstatus moet playing of error zijn.',code:'INVALID_PLAYBACK_RECEIVER_STATUS'});
  if(state==='error'){
    if(isPendingPlaybackTransfer(current)){
      const updated=updatePlaybackSession({id:current.id,userId:req.user!.id,revision:Number(req.body?.revision),state,position:req.body?.position,duration:req.body?.duration,controllerId:req.body?.controllerId});
      const rolledBack=await abortPlaybackTransfer(updated,'receiver-error');
      broadcastPlaybackSession(rolledBack.activeSession);
      return res.json({session:rolledBack.session,activeSession:rolledBack.activeSession,rolledBack:true});
    }
    const session=stopPlaybackSession({id:current.id,userId:req.user!.id,revision:Number(req.body?.revision),position:req.body?.position,duration:req.body?.duration,reason:'receiver-error'});
    broadcastPlaybackSession(session);
    return res.json({session});
  }
  let session=updatePlaybackSession({id:current.id,userId:req.user!.id,revision:Number(req.body?.revision),state,position:req.body?.position,duration:req.body?.duration,controllerId:req.body?.controllerId});
  if(isPendingPlaybackTransfer(session))session=await finalizePlaybackTransfer(session);
  broadcastPlaybackSession(session);
  res.json({session});
}catch(error){next(error)}});
apiRouter.post('/playback-sessions/:id/control',async(req,res,next)=>{try{
  const current=getPlaybackSession(String(req.params.id),req.user!.id);
  if(!current)return res.status(404).json({error:'Afspeelsessie niet gevonden.'});
  if(current.endedAt)return res.status(409).json({error:'Deze afspeelsessie is al gestopt.'});
  const action=String(req.body?.action||req.body?.command||'');
  const allowedActions=['play','pause','seek','stop','buffer','error','next','previous','volume','audio-track','subtitle-track','quality','disconnect'];
  if(!allowedActions.includes(action))return res.status(400).json({error:'Onbekende afspeelopdracht.'});
  const revision=req.body?.revision===undefined?current.revision:Number(req.body.revision);
  if(!Number.isInteger(revision)||revision!==current.revision)return res.status(409).json({error:'De afspeelsessie is ondertussen op een ander apparaat bijgewerkt.',code:'STALE_PLAYBACK_SESSION',session:current});
  assertPlaybackTransferControllerActionAllowed(current,action);
  const browserCommand=['google-cast','local-browser'].includes(current.protocol)&&['play','pause','seek','volume','subtitle-track'].includes(action)?{
    id:`${current.id}:${current.revision+1}`,
    issuedAt:Date.now(),
    command:action,
    payload:action==='seek'?{position:Math.max(0,Number(req.body?.position??req.body?.value)||0)}:action==='volume'?{level:Number(req.body?.value??req.body?.level)}:action==='subtitle-track'?{trackId:req.body?.trackId===null?null:String(req.body?.trackId||'')}:{},
  }:null;
  if(action==='next'||action==='previous'||action==='quality'){
    if(current.protocol==='local-browser')return res.status(422).json({error:'Gebruik voor de lokale browser de afspeelknoppen in de bibliotheek.'});
    const mediaId=action==='quality'?current.mediaId:adjacentEpisodeId(current.mediaId,action);
    if(!mediaId)return res.status(409).json({error:action==='next'?'Er is geen volgende aflevering beschikbaar.':'Er is geen vorige aflevering beschikbaar.'});
    const browserReplacement=current.protocol==='google-cast';
    const result=await beginPlaybackOnDevice({userId:req.user!.id,admin:req.user!.role==='admin',maxContentRating:req.user!.maxContentRating,mediaId,deviceId:current.deviceId,startPosition:action==='quality'?current.position:0,quality:(action==='quality'?req.body?.quality:current.metadata.quality||'auto') as QualityId,controllerId:current.controllerId||'web',atomicHandoff:true,handoffFromSessionId:current.id,allowSameDeviceHandoff:true});
    if(browserReplacement){
      const replaceCommand={
        id:`${result.session.id}:${result.session.revision+1}`,
        issuedAt:Date.now(),
        command:'replace-media',
        payload:{media:result.media,urls:result.urls,decision:result.decision,startPosition:result.session.position},
      };
      const updated=updatePlaybackSession({id:result.session.id,userId:req.user!.id,revision:result.session.revision,metadata:{...result.session.metadata,browserCommand:replaceCommand}});
      result.session={...result.session,...updated};
    }
    broadcastPlaybackSession(result.session);
    return res.json(result);
  }
  const stateActions=['play','pause','seek','stop','buffer','error'];
  if(isPendingPlaybackTransfer(current)&&['stop','error','disconnect'].includes(action)){
    const rolledBack=await abortPlaybackTransfer(current,action==='error'?'receiver-error':'transfer-cancelled');
    if(action==='error'){
      broadcastPlaybackSession(rolledBack.activeSession);
      return res.json({session:rolledBack.session,activeSession:rolledBack.activeSession,rolledBack:true});
    }
    let stoppedSource=rolledBack.activeSession;
    if(stoppedSource&&!stoppedSource.endedAt){
      await stopPlaybackReceiver(stoppedSource,action);
      stoppedSource=stopPlaybackSession({id:stoppedSource.id,userId:req.user!.id,revision:stoppedSource.revision,position:stoppedSource.position,duration:stoppedSource.duration,reason:action});
    }
    broadcastPlaybackSession(null);
    return res.json({session:rolledBack.session,activeSession:null,sourceSession:stoppedSource,rolledBack:true});
  }
  if(action==='error'){
    const session=stopPlaybackSession({id:current.id,userId:req.user!.id,revision,position:req.body?.position,duration:req.body?.duration,reason:'receiver-error'});
    broadcastPlaybackSession(session);
    return res.json({session});
  }
  let metadataUpdate:Record<string,unknown>|null=null;
  if(action==='volume'){
    const volume=Number(req.body?.value??req.body?.level);
    if(!Number.isFinite(volume)||volume<0||volume>1)return res.status(400).json({error:'Volume moet een getal tussen 0 en 1 zijn.'});
    metadataUpdate={...current.metadata,volume,...(browserCommand?{browserCommand}:{})};
  }else if(action==='subtitle-track'){
    const trackId=req.body?.trackId===null||req.body?.trackId===''?null:String(req.body?.trackId||'');
    if(trackId!==null&&trackId!=='external-subtitle')return res.status(400).json({error:'Onbekend ondertitelspoor.'});
    const hasSubtitle=Boolean((db.prepare('SELECT subtitle_path subtitlePath FROM media_items WHERE id=?').get(current.mediaId) as any)?.subtitlePath);
    if(trackId&&!hasSubtitle)return res.status(422).json({error:'Voor deze media is geen extern ondertitelspoor beschikbaar.'});
    metadataUpdate={...current.metadata,activeSubtitleTrackId:trackId,...(browserCommand?{browserCommand}:{})};
  }
  if(current.protocol==='dlna-upnp'){
    const controller=dlnaController(current.deviceId);
    if(action==='play')await controller.play();
    else if(action==='pause')await controller.pause();
    else if(action==='stop')await controller.stop();
    else if(action==='seek')await controller.seek(Number(req.body?.position??req.body?.value)||0);
    else if(action==='volume')await controller.setVolume(Number(req.body?.value));
    else return res.status(422).json({error:'Dit DLNA-apparaat ondersteunt deze opdracht niet via ThuisHub.'});
  }else if(current.protocol!=='google-cast'&&current.protocol!=='local-browser'&&!['buffer','error'].includes(action)){
    dispatchDeviceCommand(current.deviceId,action,{sessionId:current.id,position:req.body?.position,positionSeconds:req.body?.position,value:req.body?.value,level:req.body?.value,quality:req.body?.quality,trackId:req.body?.trackId});
  }
  if(!stateActions.includes(action)){
    const session=metadataUpdate?updatePlaybackSession({id:current.id,userId:req.user!.id,revision,metadata:metadataUpdate}):current;
    broadcastPlaybackSession(session);return res.json({session:{...session,...sessionControlPresentation(session)}})
  }
  let session=controlPlaybackSession({id:current.id,userId:req.user!.id,revision,action:action as any,position:req.body?.position,duration:req.body?.duration,controllerId:req.body?.controllerId,reason:req.body?.reason,metadata:browserCommand?{...current.metadata,browserCommand}:undefined});
  if(action==='play')session=await finalizePlaybackTransfer(session);
  broadcastPlaybackSession(session);
  res.json({session:{...session,...sessionControlPresentation(session)}});
}catch(error){next(error)}});
apiRouter.post('/playback-sessions/:id/renew',(req,res,next)=>{try{const session=getPlaybackSession(String(req.params.id),req.user!.id);if(!session||session.endedAt)return res.status(404).json({error:'Actieve afspeelsessie niet gevonden.'});const token=String(req.body?.token||'');if(!token)return res.status(400).json({error:'De huidige afspeelgrant ontbreekt.'});res.json({token:renewPlaybackGrant(token,session.id,req.user!.id,Number(req.body?.ttlSeconds)||600)})}catch(error){next(error)}});
apiRouter.delete('/playback-sessions/:id',async(req,res,next)=>{try{const current=getPlaybackSession(String(req.params.id),req.user!.id);if(!current)return res.status(404).json({error:'Afspeelsessie niet gevonden.'});if(current.endedAt){const activeSession=getActivePlaybackSession(req.user!.id);broadcastPlaybackSession(activeSession);return res.json({session:current,activeSession})}const reason=String(req.body?.reason||'transfer-cancelled');if(isPendingPlaybackTransfer(current)){const rolledBack=await abortPlaybackTransfer(current,reason);if(reason==='disconnect'||reason==='stop'){let stoppedSource=rolledBack.activeSession;if(stoppedSource&&!stoppedSource.endedAt){await stopPlaybackReceiver(stoppedSource,reason);stoppedSource=stopPlaybackSession({id:stoppedSource.id,userId:req.user!.id,revision:stoppedSource.revision,position:stoppedSource.position,duration:stoppedSource.duration,reason})}broadcastPlaybackSession(null);return res.json({session:rolledBack.session,activeSession:null,sourceSession:stoppedSource,rolledBack:true})}broadcastPlaybackSession(rolledBack.activeSession);return res.json({session:rolledBack.session,activeSession:rolledBack.activeSession,rolledBack:true})}if(current.protocol==='dlna-upnp')await dlnaController(current.deviceId).stop().catch(()=>undefined);else if(current.protocol!=='google-cast'&&current.protocol!=='local-browser')dispatchDeviceCommand(current.deviceId,'stop',{sessionId:current.id});const session=stopPlaybackSession({id:current.id,userId:req.user!.id,revision:req.body?.revision===undefined?undefined:Number(req.body.revision),position:req.body?.position,duration:req.body?.duration,reason:reason==='transfer-cancelled'?'disconnect':reason});broadcastPlaybackSession(session);res.json({session})}catch(error){next(error)}});
apiRouter.post('/playback/:id/decision',async(req,res,next)=>{try{
  const mediaId=Number(req.params.id);const row=db.prepare('SELECT * FROM media_items WHERE id=?').get(mediaId) as any;
  if(!row)return res.status(404).json({error:'Media niet gevonden.'});
  if(!ratingAllowed(row.content_rating,req.user!.maxContentRating,req.user!.role==='admin'))return res.status(403).json({error:'Dit profiel mag deze media niet afspelen.'});
  const requestedDeviceId=typeof req.body?.deviceId==='string'?req.body.deviceId:'';
  const supplied=req.body?.capabilities as DeviceCapabilities|undefined;
  const registeredTarget=requestedDeviceId?playbackTarget(requestedDeviceId,req.user!.id):null;
  const registered=registeredTarget?.device||null;
  const capabilities=requestedDeviceId?registeredTarget?.capabilities:supplied||(req.body?.target==='cast'?CAST_CAPABILITIES:BROWSER_CAPABILITIES);
  if(!capabilities)return res.status(404).json({error:'Afspeelapparaat niet gevonden of niet gekoppeld.'});
  const network=(['lan','tailscale','mobile','unknown'].includes(req.body?.network)?req.body.network:'unknown') as any;
  const decision=decisionEngine({media:mediaCapabilitiesFromRow(row),device:capabilities,quality:(req.body?.quality||'auto') as QualityId,customMaxBitrateMbps:Number(req.body?.customMaxBitrateMbps)||undefined,availableBandwidthMbps:Number(req.body?.availableBandwidthMbps)||undefined,network,forceSdr:Boolean(req.body?.forceSdr)});
  const needsLan=Boolean(registered&&registered.protocol!=='local-browser')||['cast','android-tv','google-tv','tizen','dlna'].includes(String(capabilities.platform||''));
  const lanBase=needsLan?lanPlaybackBaseUrl():null;
  if(needsLan&&!lanBase)return res.status(409).json({error:'De priv\u00e9-LAN-streamserver is niet actief. Kies een geldig LAN-adres, schakel thuisnetwerkstreaming in en start ThuisHub opnieuw.',localStreamingRequired:true});
  const base=lanBase||`${req.protocol}://${req.get('host')}`;
  const fileToken=createPlaybackToken({mediaId,resource:'file',userId:req.user!.id,deviceId:requestedDeviceId||undefined},600);
  const hlsToken=createPlaybackToken({mediaId,resource:'hls',userId:req.user!.id,deviceId:requestedDeviceId||undefined,options:{copyVideo:decision.copyVideo,copyAudio:decision.copyAudio,burnSubtitles:decision.burnSubtitles,targetBitrateMbps:decision.targetBitrateMbps,targetWidth:decision.targetWidth,targetHeight:decision.targetHeight}},3600);
  const subtitleToken=row.subtitle_path?createPlaybackToken({mediaId,resource:'subtitle',userId:req.user!.id,deviceId:requestedDeviceId||undefined},3600):'';
  res.json({decision,technical:{...mediaCapabilitiesFromRow(row),fileSize:row.size,duration:row.duration},urls:{playback:decision.mode==='direct_play'?`${base}/api/playback/${mediaId}/file?token=${encodeURIComponent(fileToken)}`:`${base}/api/playback/${mediaId}/hls/index.m3u8?token=${encodeURIComponent(hlsToken)}`,subtitle:subtitleToken?`${base}/api/playback/${mediaId}/subtitle?token=${encodeURIComponent(subtitleToken)}`:'',expiresInSeconds:decision.mode==='direct_play'?600:3600},device:capabilities,localStreamingRequired:false});
}catch(error){next(error)}});

apiRouter.get('/devices',requireAdmin,(_req,res)=>res.json({items:listDevices()}));
apiRouter.post('/devices/pair/approve',requireAdmin,pairingRateLimit(10),(req,res)=>{const ok=approvePairing(String(req.body?.code||''),req.user!.id);res.status(ok?200:400).json(ok?{message:'Afspeelapparaat gekoppeld aan dit profiel.'}:{error:'De koppelcode is ongeldig of verlopen.'})});
apiRouter.patch('/devices/:id',requireAdmin,(req,res)=>res.json({ok:setDeviceOverrides(String(req.params.id),req.body?.overrides||{})}));
apiRouter.delete('/devices/:id',requireAdmin,(req,res)=>res.json({ok:forgetDevice(String(req.params.id))}));
apiRouter.post('/devices/:id/commands',requireAdmin,(req,res,next)=>{try{res.status(201).json({id:dispatchDeviceCommand(String(req.params.id),String(req.body?.command||''),req.body?.payload)})}catch(error){next(error)}});

apiRouter.get('/library', (req, res) => {
  const kind = req.query.kind === 'movie' || req.query.kind === 'episode' ? req.query.kind : null;
  const search = typeof req.query.search === 'string' ? `%${req.query.search.trim()}%` : '%';
  const rows = db.prepare(`SELECT m.*, p.position, p.duration progress_duration, p.completed,
    us.favorite,us.watchlist,us.watched,us.rating user_rating
    FROM media_items m LEFT JOIN progress p ON p.media_id=m.id AND p.user_id=?
    LEFT JOIN media_user_state us ON us.media_id=m.id AND us.user_id=?
    WHERE (? IS NULL OR m.kind=?) AND (m.title LIKE ? OR COALESCE(m.series_title,'') LIKE ?)
    ORDER BY m.sort_title COLLATE NOCASE`).all(req.user!.id, req.user!.id, kind, kind, search, search) as any[];
  res.json(rows.filter(item=>ratingAllowed(item.content_rating,req.user!.maxContentRating,req.user!.role==='admin')).map(item => ({
    id: item.id, kind: item.kind, title: item.title, year: item.year, seriesTitle: item.series_title,
    season: item.season, episode: item.episode, duration: item.duration, size: item.size,
    videoCodec: item.video_codec, audioCodec: item.audio_codec, width: item.width, height: item.height,
    bitrate: item.bitrate, hdrType: item.hdr_type, dolbyVisionProfile: item.dolby_vision_profile,
    audioChannels: item.audio_channels, audioLayout: item.audio_layout, atmos: Boolean(item.atmos), dtsX: Boolean(item.dts_x),
    overview: item.overview, posterUrl:imageApiUrl(item.id,'poster'),backdropUrl:imageApiUrl(item.id,'backdrop'),
    hasSubtitle: Boolean(item.subtitle_path), directPlay: isDirectPlayable(item),
    progress: item.position ? { position: item.position, duration: item.progress_duration, completed: Boolean(item.completed) } : null,
    state: { favorite: Boolean(item.favorite), watchlist: Boolean(item.watchlist), watched: Boolean(item.watched || item.completed), rating: item.user_rating },
    contentRating: item.content_rating, originalContentRating:item.original_content_rating, genres: JSON.parse(item.genres || '[]'), edition: item.edition, tagline: item.tagline,metadataProvider:item.metadata_provider,metadataConfidence:item.metadata_match_confidence,metadataNeedsReview:Boolean(item.metadata_needs_review),
    originalTitle:item.original_title,sortTitle:item.sort_title,runtimeMinutes:item.metadata_runtime_minutes,language:item.metadata_language,country:item.metadata_country,studio:item.studio,directors:JSON.parse(item.directors||'[]'),writers:JSON.parse(item.writers||'[]'),cast:JSON.parse(item.cast_json||'[]'),ratings:JSON.parse(item.ratings_json||'[]'),premiered:item.premiered,officialUrl:item.official_url,absoluteEpisode:item.absolute_episode,aired:item.aired,
    hdr: item.hdr_type && item.hdr_type !== 'sdr', createdAt:item.created_at, updatedAt:item.updated_at
  })));
});

apiRouter.get('/media/:id', (req, res) => {
  const item = db.prepare(`SELECT m.*, p.position, p.duration progress_duration, p.completed,us.favorite,us.watchlist,us.watched,us.rating user_rating FROM media_items m
    LEFT JOIN progress p ON p.media_id=m.id AND p.user_id=? LEFT JOIN media_user_state us ON us.media_id=m.id AND us.user_id=? WHERE m.id=?`).get(req.user!.id, req.user!.id, Number(req.params.id)) as any;
  if (!item) return res.status(404).json({ error: 'Media niet gevonden.' });
  res.json({ ...item, file_path: undefined, subtitle_path: undefined, directPlay: isDirectPlayable(item) });
});

apiRouter.get('/media/:id/stream', (req, res) => {
  const item = db.prepare('SELECT file_path FROM media_items WHERE id=?').get(Number(req.params.id)) as { file_path: string } | undefined;
  if (!item || !fs.existsSync(item.file_path)) return res.status(404).json({ error: 'Videobestand niet gevonden.' });
  const stat = fs.statSync(item.file_path);
  const range = req.headers.range;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mime.lookup(item.file_path) || 'application/octet-stream');
  if (range) {
    const [startText, endText] = range.replace('bytes=', '').split('-');
    const start = Number(startText);
    const end = endText ? Math.min(Number(endText), stat.size - 1) : stat.size - 1;
    if (!Number.isFinite(start) || start > end || start >= stat.size) return res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) });
    fs.createReadStream(item.file_path, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(item.file_path).pipe(res);
  }
});

apiRouter.get('/media/:id/hls/:file', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = db.prepare('SELECT file_path,color_transfer FROM media_items WHERE id=?').get(id) as { file_path: string; color_transfer: string | null } | undefined;
    if (!item || !fs.existsSync(item.file_path)) return res.status(404).json({ error: 'Videobestand niet gevonden.' });
    if (req.params.file === 'index.m3u8') await ensureHls(id, item.file_path, item.color_transfer);
    const file = hlsFile(id, req.params.file);
    if (!file) return res.status(404).end();
    res.setHeader('Cache-Control', req.params.file.endsWith('.m3u8') ? 'no-store' : 'public, max-age=86400');
    res.sendFile(file);
  } catch (error) { next(error); }
});

apiRouter.get('/media/:id/subtitle', (req, res) => {
  const item = db.prepare('SELECT subtitle_path FROM media_items WHERE id=?').get(Number(req.params.id)) as { subtitle_path: string | null } | undefined;
  if (!item?.subtitle_path || !fs.existsSync(item.subtitle_path)) return res.status(404).end();
  let text = fs.readFileSync(item.subtitle_path, 'utf8').replace(/^\uFEFF/, '');
  if (path.extname(item.subtitle_path).toLowerCase() === '.srt') text = `WEBVTT\n\n${text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
  res.type('text/vtt; charset=utf-8').send(text);
});

apiRouter.put('/media/:id/progress', (req, res) => {
  const position = Math.max(0, Number(req.body.position) || 0);
  const duration = Math.max(0, Number(req.body.duration) || 0);
  const completed = duration > 0 && position / duration >= 0.92 ? 1 : 0;
  db.prepare(`INSERT INTO progress(user_id,media_id,position,duration,completed,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id,media_id) DO UPDATE SET position=excluded.position,duration=excluded.duration,completed=excluded.completed,updated_at=CURRENT_TIMESTAMP`).run(req.user!.id, Number(req.params.id), position, duration, completed);
  res.json({ position, duration, completed: Boolean(completed) });
  const media = db.prepare('SELECT title,series_title FROM media_items WHERE id=?').get(Number(req.params.id)) as any;
  const sessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId : '';
  const playerState = req.body.state === 'paused' ? 'paused' : 'playing';
  if (sessionId && media) {
    if (req.body.state === 'stopped') removeActivity(sessionId);
    else updateActivity({ sessionId, userId: req.user!.id, username: req.user!.username, mediaId: Number(req.params.id), title: media.series_title || media.title, state: playerState, position, duration, transcoding: Boolean(req.body.transcoding), address: req.ip || '', startedAt: req.body.startedAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  emitWebhook(req.body.state === 'paused' ? 'pause' : req.body.state === 'stopped' ? 'stop' : 'play', { mediaId: Number(req.params.id), user: req.user!.username, position, duration });
});

apiRouter.put('/media/:id/state', (req, res) => {
  const mediaId = Number(req.params.id);
  const current = db.prepare('SELECT * FROM media_user_state WHERE user_id=? AND media_id=?').get(req.user!.id, mediaId) as any || {};
  const favorite = req.body.favorite === undefined ? Number(current.favorite || 0) : Number(Boolean(req.body.favorite));
  const watchlist = req.body.watchlist === undefined ? Number(current.watchlist || 0) : Number(Boolean(req.body.watchlist));
  const watched = req.body.watched === undefined ? Number(current.watched || 0) : Number(Boolean(req.body.watched));
  const rating = req.body.rating === undefined ? current.rating ?? null : req.body.rating === null ? null : Math.min(10, Math.max(0, Number(req.body.rating)));
  db.prepare(`INSERT INTO media_user_state(user_id,media_id,favorite,watchlist,watched,rating,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id,media_id) DO UPDATE SET favorite=excluded.favorite,watchlist=excluded.watchlist,watched=excluded.watched,rating=excluded.rating,updated_at=CURRENT_TIMESTAMP`).run(req.user!.id, mediaId, favorite, watchlist, watched, rating);
  if (watched) db.prepare(`INSERT INTO progress(user_id,media_id,position,duration,completed,updated_at) SELECT ?,id,COALESCE(duration,0),COALESCE(duration,0),1,CURRENT_TIMESTAMP FROM media_items WHERE id=? ON CONFLICT(user_id,media_id) DO UPDATE SET position=excluded.position,duration=excluded.duration,completed=1,updated_at=CURRENT_TIMESTAMP`).run(req.user!.id, mediaId);
  audit(req.user!.id, 'media.state', { mediaId, favorite, watchlist, watched, rating });
  res.json({ favorite: Boolean(favorite), watchlist: Boolean(watchlist), watched: Boolean(watched), rating });
});

apiRouter.patch('/media/:id', requireAdmin, (req, res) => {
  const mediaId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM media_items WHERE id=?').get(mediaId) as any;
  if (!existing) return res.status(404).json({ error: 'Media niet gevonden.' });
  const title = typeof req.body.title === 'string' && req.body.title.trim() ? req.body.title.trim() : existing.title;
  const overview = typeof req.body.overview === 'string' ? req.body.overview.trim() : existing.overview;
  const year = req.body.year === null ? null : Number(req.body.year) || existing.year;
  const contentRating = typeof req.body.contentRating === 'string' ? req.body.contentRating.trim() : existing.content_rating;
  const edition = typeof req.body.edition === 'string' ? req.body.edition.trim() : existing.edition;
  const tagline = typeof req.body.tagline === 'string' ? req.body.tagline.trim() : existing.tagline;
  const genres = Array.isArray(req.body.genres) ? JSON.stringify(req.body.genres.map(String).slice(0, 20)) : existing.genres;
  const wholeNumber=(value:unknown,label:string,minimum=0)=>{if(value===undefined)return undefined;if(value===null||value==='')return null;const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<minimum)throw Object.assign(new Error(`${label} moet een geheel getal van minimaal ${minimum} zijn.`),{status:400});return parsed};
  const extra=applyManualMetadata(mediaId,{title,sortTitle:req.body.sortTitle,overview,year,contentRating,edition,tagline,genres:JSON.parse(genres),originalTitle:req.body.originalTitle,runtimeMinutes:req.body.runtimeMinutes,language:req.body.language,country:req.body.country,studio:req.body.studio,directors:req.body.directors,writers:req.body.writers,cast:req.body.cast,ratings:req.body.ratings,premiered:req.body.premiered,officialUrl:req.body.officialUrl,season:wholeNumber(req.body.season,'Seizoen'),episode:wholeNumber(req.body.episode,'Aflevering'),absoluteEpisode:wholeNumber(req.body.absoluteEpisode,'Absoluut afleveringsnummer',1),aired:req.body.aired,imdbId:req.body.imdbId,tvmazeId:req.body.tvmazeId});
  audit(req.user!.id, 'media.edit', { mediaId });
  res.json({ id: mediaId, title, overview, year, contentRating, edition, tagline, genres: JSON.parse(genres),...extra });
});

apiRouter.get('/media/:id/download', (req, res) => {
  if (req.user!.canDownload === false) return res.status(403).json({ error: 'Downloads zijn voor dit profiel uitgeschakeld.' });
  const item = db.prepare('SELECT file_path FROM media_items WHERE id=?').get(Number(req.params.id)) as { file_path: string } | undefined;
  if (!item || !fs.existsSync(item.file_path)) return res.status(404).json({ error: 'Bestand niet gevonden.' });
  audit(req.user!.id, 'media.download', { mediaId: Number(req.params.id) });
  res.download(item.file_path, path.basename(item.file_path));
});

apiRouter.get('/media/:id/thumbnail', async (req, res, next) => {
  try {
    const item = db.prepare('SELECT file_path,duration FROM media_items WHERE id=?').get(Number(req.params.id)) as any;
    if (!item || !fs.existsSync(item.file_path)) return res.status(404).end();
    const seconds = Math.min(Number(item.duration) || 0, Math.max(0, Number(req.query.t) || 0));
    res.sendFile(await previewThumbnail(Number(req.params.id), item.file_path, seconds));
  } catch (error) { next(error); }
});

apiRouter.get('/media/:id/markers', (req, res) => res.json(db.prepare('SELECT id,marker_type type,start_time startTime,end_time endTime,source FROM playback_markers WHERE media_id=? ORDER BY start_time').all(Number(req.params.id))));
apiRouter.post('/media/:id/markers', requireAdmin, (req, res) => {
  const type = ['intro','credits','commercial'].includes(req.body.type) ? req.body.type : null;
  const start = Math.max(0, Number(req.body.startTime) || 0); const end = Math.max(start, Number(req.body.endTime) || 0);
  if (!type || end <= start) return res.status(400).json({ error: 'Ongeldige marker.' });
  const result = db.prepare('INSERT INTO playback_markers(media_id,marker_type,start_time,end_time,source) VALUES(?,?,?,?,?)').run(Number(req.params.id), type, start, end, 'manual');
  res.status(201).json({ id: Number(result.lastInsertRowid), type, startTime: start, endTime: end, source: 'manual' });
});
apiRouter.post('/media/:id/markers/auto', requireAdmin, (req, res) => {
  const item = db.prepare('SELECT kind,duration FROM media_items WHERE id=?').get(Number(req.params.id)) as any;
  if (!item?.duration) return res.status(400).json({ error: 'De speelduur is nog niet bekend.' });
  db.prepare("DELETE FROM playback_markers WHERE media_id=? AND source='automatic'").run(Number(req.params.id));
  if (item.kind === 'episode' && item.duration > 600) db.prepare("INSERT INTO playback_markers(media_id,marker_type,start_time,end_time,source) VALUES(?,?,?,?, 'automatic')").run(Number(req.params.id), 'intro', Math.min(20,item.duration*.02), Math.min(110,item.duration*.09));
  if (item.duration > 300) db.prepare("INSERT INTO playback_markers(media_id,marker_type,start_time,end_time,source) VALUES(?,?,?,?, 'automatic')").run(Number(req.params.id), 'credits', item.duration*.94, item.duration);
  res.json(db.prepare('SELECT id,marker_type type,start_time startTime,end_time endTime,source FROM playback_markers WHERE media_id=? ORDER BY start_time').all(Number(req.params.id)));
});

apiRouter.get('/collections', (req, res) => res.json(db.prepare(`SELECT c.id,c.name,c.description,c.is_public isPublic,COUNT(ci.media_id) itemCount FROM collections c LEFT JOIN collection_items ci ON ci.collection_id=c.id WHERE c.owner_id=? OR c.is_public=1 GROUP BY c.id ORDER BY c.name`).all(req.user!.id)));
apiRouter.post('/collections', (req, res) => { const name=String(req.body.name||'').trim(); if(!name)return res.status(400).json({error:'Geef de collectie een naam.'}); const result=db.prepare('INSERT INTO collections(owner_id,name,description,is_public) VALUES(?,?,?,?)').run(req.user!.id,name,String(req.body.description||''),Number(Boolean(req.body.isPublic))); res.status(201).json({id:Number(result.lastInsertRowid),name,description:String(req.body.description||''),isPublic:Boolean(req.body.isPublic),itemCount:0}); });
apiRouter.put('/collections/:id/items/:mediaId', (req,res)=>{const collection=db.prepare('SELECT id FROM collections WHERE id=? AND owner_id=?').get(Number(req.params.id),req.user!.id);if(!collection)return res.status(404).json({error:'Collectie niet gevonden.'});db.prepare('INSERT OR IGNORE INTO collection_items(collection_id,media_id,position) VALUES(?,?,(SELECT COUNT(*) FROM collection_items WHERE collection_id=?))').run(Number(req.params.id),Number(req.params.mediaId),Number(req.params.id));res.status(204).end();});
apiRouter.get('/collections/:id/items', (req,res)=>{const rows=db.prepare(`SELECT m.id,m.kind,m.title,m.series_title seriesTitle,m.year,ci.position FROM collection_items ci JOIN media_items m ON m.id=ci.media_id JOIN collections c ON c.id=ci.collection_id WHERE ci.collection_id=? AND (c.owner_id=? OR c.is_public=1) ORDER BY ci.position`).all(Number(req.params.id),req.user!.id) as any[];res.json(rows.map(row=>({...row,posterUrl:imageApiUrl(row.id,'poster')})))});
apiRouter.delete('/collections/:id', (req,res)=>{db.prepare('DELETE FROM collections WHERE id=? AND owner_id=?').run(Number(req.params.id),req.user!.id);res.status(204).end();});

apiRouter.get('/playlists', (req,res)=>res.json(db.prepare('SELECT p.id,p.name,p.description,COUNT(pi.media_id) itemCount FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id=p.id WHERE p.user_id=? GROUP BY p.id ORDER BY p.updated_at DESC').all(req.user!.id)));
apiRouter.post('/playlists', (req,res)=>{const name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Geef de playlist een naam.'});const result=db.prepare('INSERT INTO playlists(user_id,name,description) VALUES(?,?,?)').run(req.user!.id,name,String(req.body.description||''));res.status(201).json({id:Number(result.lastInsertRowid),name,itemCount:0});});
apiRouter.put('/playlists/:id/items/:mediaId',(req,res)=>{const playlist=db.prepare('SELECT id FROM playlists WHERE id=? AND user_id=?').get(Number(req.params.id),req.user!.id);if(!playlist)return res.status(404).json({error:'Playlist niet gevonden.'});db.prepare('INSERT OR IGNORE INTO playlist_items(playlist_id,media_id,position) VALUES(?,?,(SELECT COUNT(*) FROM playlist_items WHERE playlist_id=?))').run(Number(req.params.id),Number(req.params.mediaId),Number(req.params.id));db.prepare('UPDATE playlists SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(Number(req.params.id));res.status(204).end();});
apiRouter.get('/playlists/:id/items',(req,res)=>{const rows=db.prepare(`SELECT m.id,m.kind,m.title,m.series_title seriesTitle,m.year,m.duration,pi.position FROM playlist_items pi JOIN media_items m ON m.id=pi.media_id JOIN playlists p ON p.id=pi.playlist_id WHERE pi.playlist_id=? AND p.user_id=? ORDER BY pi.position`).all(Number(req.params.id),req.user!.id) as any[];res.json(rows.map(row=>({...row,posterUrl:imageApiUrl(row.id,'poster')})))});
apiRouter.delete('/playlists/:id',(req,res)=>{db.prepare('DELETE FROM playlists WHERE id=? AND user_id=?').run(Number(req.params.id),req.user!.id);res.status(204).end();});

apiRouter.get('/optimizations', (_req,res)=>res.json(optimizationList()));
apiRouter.post('/media/:id/optimize', (req,res)=>{const profile=['mobile','1080p','original'].includes(req.body.profile)?req.body.profile:'1080p';res.status(202).json({id:queueOptimization(Number(req.params.id),profile)});});
apiRouter.get('/optimizations/:id/download',(req,res)=>{const file=optimizedFile(Number(req.params.id));if(!file)return res.status(404).json({error:'De geoptimaliseerde versie is nog niet gereed.'});res.download(file,path.basename(file));});

function cpuSnapshot(){
  return os.cpus().reduce((result,cpu)=>{
    const total=Object.values(cpu.times).reduce((sum,value)=>sum+value,0);
    return {idle:result.idle+cpu.times.idle,total:result.total+total};
  },{idle:0,total:0});
}

async function systemMetrics(){
  const before=cpuSnapshot();
  await new Promise(resolve=>setTimeout(resolve,120));
  const after=cpuSnapshot();
  const elapsed=Math.max(1,after.total-before.total);
  const cpuUsagePercent=Math.max(0,Math.min(100,Math.round((1-(after.idle-before.idle)/elapsed)*1000)/10));
  const memoryTotalBytes=os.totalmem();
  const memoryUsedBytes=Math.max(0,memoryTotalBytes-os.freemem());
  let disk:{totalBytes:number;freeBytes:number;usedBytes:number;usagePercent:number}|null=null;
  try{
    const stats=fs.statfsSync(appPaths.dataDir);
    const totalBytes=Number(stats.blocks)*Number(stats.bsize);
    const freeBytes=Number(stats.bavail)*Number(stats.bsize);
    const usedBytes=Math.max(0,totalBytes-freeBytes);
    disk={totalBytes,freeBytes,usedBytes,usagePercent:totalBytes?Math.round(usedBytes/totalBytes*1000)/10:0};
  }catch{/* Een onbekend bestandssysteem wordt als onbekend aan de interface doorgegeven. */}
  return {
    platform:{name:os.platform()==='win32'?'Windows':os.type(),release:os.release(),version:os.version(),hostname:os.hostname()},
    cpu:{usagePercent:cpuUsagePercent,model:os.cpus()[0]?.model||'Onbekend',cores:os.cpus().length},
    memory:{usedBytes:memoryUsedBytes,totalBytes:memoryTotalBytes,usagePercent:memoryTotalBytes?Math.round(memoryUsedBytes/memoryTotalBytes*1000)/10:0},
    disk,
    network:{downloadBytesPerSecond:null,uploadBytesPerSecond:null,available:false,interfaces:assignedPrivateAddresses()},
  };
}

apiRouter.get('/dashboard', requireAdmin, async (_req,res)=>{
  const stats=db.prepare(`SELECT COUNT(*) items,COALESCE(SUM(size),0) bytes,COALESCE(SUM(duration),0) duration FROM media_items`).get();
  const counts=db.prepare('SELECT kind,COUNT(*) count FROM media_items GROUP BY kind').all();
  const recent=db.prepare('SELECT event,details,created_at createdAt FROM audit_log ORDER BY id DESC LIMIT 20').all();
  const libraryCounts = {
    movies: (db.prepare("SELECT COUNT(*) count FROM media_items WHERE kind='movie'").get() as any).count,
    series: (db.prepare("SELECT COUNT(DISTINCT series_title) count FROM media_items WHERE kind='episode'").get() as any).count,
    albums: (db.prepare('SELECT COUNT(DISTINCT artist || char(0) || album) count FROM music_tracks').get() as any).count,
    photos: (db.prepare('SELECT COUNT(*) count FROM photos').get() as any).count,
  };
  const integrity=databaseIntegrity();
  const tailscale=await tailscaleStatus();
  const backups=listBackups();
  const lastUpdate=JSON.parse(getSetting('lastUpdateResult','{}')||'{}');
  const system=await systemMetrics();
  res.json({version:APP_VERSION,name:APP_NAME,uptimeSeconds:Math.round(process.uptime()),serverStatus:'online',database:{...integrity,file:appPaths.databaseFile},lastBackup:backups[0]||null,update:lastUpdate,tailscale,stats,counts,libraryCounts,metadata:metadataDashboard(),activity:listActivity(),gpus:detectedGpus(),encoder:videoEncoder(),recent,optimizations:optimizationList(),storage:{libraryBytes:(stats as any).bytes,dataBytes:directorySize(appPaths.dataDir),logBytes:logStorageBytes(),disk:system.disk},system,warnings:[...(!integrity.ok?['De database-integriteitscontrole meldt een probleem.']:[]),...(!tailscale.serveActive?['Externe toegang via Tailscale Serve is niet actief.']:[]),...(backups.length===0?['Er is nog geen back-up gemaakt.']:[])]});
});

function directorySize(directory:string):number{if(!fs.existsSync(directory))return 0;let total=0;for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);try{total+=entry.isDirectory()?directorySize(file):fs.statSync(file).size}catch{}}return total}

apiRouter.get('/backups', requireAdmin, (_req,res)=>res.json({items:listBackups(),settings:{mode:getSetting('automaticBackups','daily'),retention:Number(getSetting('backupRetention','14')),location:getSetting('backupLocation',appPaths.backupsDir)}}));
apiRouter.post('/backups', requireAdmin, async(_req,res,next)=>{try{res.status(201).json(await createBackup('manual'))}catch(error){next(error)}});
apiRouter.get('/backups/:name/download', requireAdmin, (req,res,next)=>{try{const file=resolveBackup(String(req.params.name));res.download(file,path.basename(file))}catch(error){next(error)}});
apiRouter.post('/backups/:name/verify', requireAdmin, (req,res)=>res.json(verifyBackup(String(req.params.name))));
apiRouter.post('/backups/:name/restore', requireAdmin, async(req,res,next)=>{try{if(req.body?.confirm!==true)return res.status(400).json({error:'Bevestig dat je deze back-up wilt terugzetten.'});res.json(await scheduleRestore(String(req.params.name)))}catch(error){next(error)}});

apiRouter.get('/database/status', requireAdmin, (_req,res)=>res.json({...databaseIntegrity(),file:appPaths.databaseFile,unexpectedShutdown:getSetting('cleanShutdown','true')!=='true'}));
apiRouter.post('/database/check', requireAdmin, (_req,res)=>{const result=databaseIntegrity();log(result.ok?'INFO':'CRITICAL','database','Handmatige database-integriteitscontrole uitgevoerd.',{details:result.details});res.json(result)});
apiRouter.post('/database/repair', requireAdmin, async(req,res,next)=>{try{if(req.body?.confirm!==true)return res.status(400).json({error:'Bevestig de herstelpoging.'});const emergency=await createBackup('emergency');const integrity=databaseIntegrity();res.json({ok:integrity.ok,emergencyBackup:emergency,message:integrity.ok?'De database is intact; er waren geen reparaties nodig.':'De database lijkt beschadigd. Er is een veiligheidskopie gemaakt. Zet de laatste gecontroleerde back-up terug.' ,technicalDetails:integrity.details})}catch(error){next(error)}});
apiRouter.post('/database/rebuild-library', requireAdmin, async(req,res)=>{if(req.body?.confirm!==true)return res.status(400).json({error:'Bevestig dat de bibliotheekindex opnieuw mag worden opgebouwd.'});await createBackup('emergency');void scanLibrary();res.status(202).json({message:'Veiligheidskopie gemaakt. De bibliotheek wordt opnieuw geïndexeerd; gebruikers en instellingen blijven behouden.'})});
apiRouter.get('/database/export', requireAdmin, async(_req,res,next)=>{try{const file=await exportDatabase();res.download(file,path.basename(file))}catch(error){next(error)}});

apiRouter.get('/logs', requireAdmin, (req,res)=>res.json({items:readLogs({category:String(req.query.category||''),level:String(req.query.level||''),search:String(req.query.search||''),date:String(req.query.date||''),limit:Number(req.query.limit||250)}),directory:appPaths.logsDir,bytes:logStorageBytes()}));
apiRouter.get('/logs/download', requireAdmin, (_req,res)=>{const file=path.join(appPaths.exportsDir,`ThuisHub-logboeken-${Date.now()}.json`);fs.mkdirSync(appPaths.exportsDir,{recursive:true});fs.writeFileSync(file,JSON.stringify(readLogs({limit:1000}),null,2));res.download(file,path.basename(file))});
apiRouter.delete('/logs', requireAdmin, (_req,res)=>{clearLogs();res.status(204).end()});
apiRouter.post('/logs/open-folder', requireAdmin, (_req,res)=>{if(process.platform==='win32')execFile('explorer.exe',[appPaths.logsDir],{windowsHide:false});res.status(204).end()});

apiRouter.get('/tailscale', requireAdmin, async(_req,res)=>res.json(await tailscaleStatus()));
apiRouter.get('/updates', requireAdmin, (_req,res)=>res.json({currentVersion:APP_VERSION,channel:getSetting('updateChannel','stable'),automatic:getSetting('automaticUpdateCheck','false')==='true',source:'GitHub Releases: kratje050/thuishub',lastCheckAt:getSetting('lastUpdateCheckAt',''),lastResult:JSON.parse(getSetting('lastUpdateResult','{}')||'{}'),downloaded:downloadedUpdateStatus()}));
apiRouter.post('/updates/check', requireAdmin, async(_req,res)=>res.json(await checkForUpdates()));
apiRouter.post('/updates/download', requireAdmin, async(req,res,next)=>{try{if(req.body?.confirm!==true)return res.status(400).json({error:'Bevestig dat je de update wilt downloaden.'});const trusted=JSON.parse(getSetting('lastUpdateResult','{}')||'{}');if(!trusted.available||!trusted.version||trusted.version!==req.body?.manifest?.version)return res.status(409).json({error:'Controleer eerst opnieuw op updates.'});res.json(await downloadUpdate(trusted))}catch(error){next(error)}});
apiRouter.post('/updates/install', requireAdmin, (req,res,next)=>{try{if(req.body?.confirm!==true)return res.status(400).json({error:'Bevestig dat ThuisHub mag afsluiten en de update-installer mag openen.'});res.status(202).json(requestUpdateInstall())}catch(error){next(error)}});

apiRouter.get('/webhooks', requireAdmin, (_req,res)=>res.json(db.prepare('SELECT id,url,events,enabled,created_at createdAt FROM webhooks ORDER BY id').all()));
apiRouter.post('/webhooks', requireAdmin, (req,res)=>{try{new URL(req.body.url);}catch{return res.status(400).json({error:'Ongeldige webhook-URL.'});}const events=Array.isArray(req.body.events)?req.body.events.join(','):String(req.body.events||'play,pause,stop,scan');const result=db.prepare('INSERT INTO webhooks(url,events) VALUES(?,?)').run(req.body.url,events);res.status(201).json({id:Number(result.lastInsertRowid),url:req.body.url,events,enabled:true});});
apiRouter.delete('/webhooks/:id', requireAdmin, (req,res)=>{db.prepare('DELETE FROM webhooks WHERE id=?').run(Number(req.params.id));res.status(204).end();});

apiRouter.get('/scan', (_req, res) => res.json(scanState));
apiRouter.post('/scan', requireAdmin, (_req, res) => {
  if (scanState.running) return res.status(409).json({ error: 'Er loopt al een scan.', scan: scanState });
  void scanLibrary();
  emitWebhook('scan', { status: 'started' });
  res.status(202).json(scanState);
});

apiRouter.get('/sources', (_req, res) => res.json(db.prepare('SELECT id,name,path,kind,created_at createdAt FROM sources ORDER BY name').all()));
apiRouter.post('/sources', requireAdmin, (req, res) => {
  const { name, path: sourcePath, kind } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Geef de bibliotheek een naam.' });
  if (typeof sourcePath !== 'string' || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) return res.status(400).json({ error: 'Deze map bestaat niet of is niet leesbaar.' });
  if (!['movies', 'series'].includes(kind)) return res.status(400).json({ error: 'Kies films of series.' });
  try {
    const result = db.prepare('INSERT INTO sources(name,path,kind) VALUES(?,?,?)').run(name.trim(), path.resolve(sourcePath), kind);
    res.status(201).json({ id: Number(result.lastInsertRowid), name: name.trim(), path: path.resolve(sourcePath), kind });
  } catch { res.status(409).json({ error: 'Deze map staat al in je bibliotheek.' }); }
});
apiRouter.delete('/sources/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM sources WHERE id=?').run(Number(req.params.id));
  res.status(204).end();
});

apiRouter.get('/extra-sources', (_req,res)=>res.json((db.prepare('SELECT id,name,path,kind,created_at createdAt FROM extra_sources ORDER BY name').all() as any[]).map(x=>({...x,id:`extra-${x.id}`}))));
apiRouter.post('/extra-sources', requireAdmin, (req,res)=>{const{name,path:sourcePath,kind}=req.body||{};if(typeof name!=='string'||!name.trim())return res.status(400).json({error:'Geef de bibliotheek een naam.'});if(typeof sourcePath!=='string'||!fs.existsSync(sourcePath)||!fs.statSync(sourcePath).isDirectory())return res.status(400).json({error:'Deze map bestaat niet of is niet leesbaar.'});if(!['music','photos'].includes(kind))return res.status(400).json({error:'Kies muziek of foto’s.'});try{const result=db.prepare('INSERT INTO extra_sources(name,path,kind) VALUES(?,?,?)').run(name.trim(),path.resolve(sourcePath),kind);res.status(201).json({id:`extra-${result.lastInsertRowid}`,name:name.trim(),path:path.resolve(sourcePath),kind})}catch{res.status(409).json({error:'Deze map staat al in je bibliotheek.'})}});
apiRouter.delete('/extra-sources/:id', requireAdmin, (req,res)=>{db.prepare('DELETE FROM extra_sources WHERE id=?').run(Number(req.params.id));res.status(204).end()});

apiRouter.get('/music', (req,res)=>{
  const search=typeof req.query.search==='string'?`%${req.query.search}%`:'%';
  const rows=db.prepare(`SELECT id,title,artist,album,album_artist albumArtist,track,disc,year,genre,duration,cover_path coverPath FROM music_tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? ORDER BY artist COLLATE NOCASE,album COLLATE NOCASE,disc,track,title`).all(search,search,search) as any[];
  res.json(rows.map(x=>({ id:x.id,title:x.title,artist:x.artist,album:x.album,albumArtist:x.albumArtist,track:x.track,disc:x.disc,year:x.year,duration:x.duration,genres:JSON.parse(x.genre||'[]'),coverUrl:x.coverPath?`/api/music/${x.id}/cover`:null })));
});
apiRouter.get('/music/:id/cover',(req,res)=>{const row=db.prepare('SELECT cover_path FROM music_tracks WHERE id=?').get(Number(req.params.id)) as any;if(!row?.cover_path||!fs.existsSync(row.cover_path))return res.status(404).end();res.sendFile(row.cover_path)});
apiRouter.get('/music/:id/stream',(req,res)=>{const row=db.prepare('SELECT file_path FROM music_tracks WHERE id=?').get(Number(req.params.id)) as any;if(!row||!fs.existsSync(row.file_path))return res.status(404).end();const stat=fs.statSync(row.file_path);const range=req.headers.range;res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Type',mime.lookup(row.file_path)||'audio/mpeg');if(range){const[startText,endText]=range.replace('bytes=','').split('-');const start=Number(startText);const end=endText?Math.min(Number(endText),stat.size-1):stat.size-1;res.status(206).set({'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Content-Length':String(end-start+1)});fs.createReadStream(row.file_path,{start,end}).pipe(res)}else{res.setHeader('Content-Length',stat.size);fs.createReadStream(row.file_path).pipe(res)}});
apiRouter.get('/music/:id/download',(req,res)=>{if(req.user!.canDownload===false)return res.status(403).json({error:'Downloads zijn voor dit profiel uitgeschakeld.'});const row=db.prepare('SELECT file_path FROM music_tracks WHERE id=?').get(Number(req.params.id)) as any;if(!row||!fs.existsSync(row.file_path))return res.status(404).end();res.download(row.file_path,path.basename(row.file_path))});

apiRouter.get('/photos',(_req,res)=>{
  const rows=db.prepare('SELECT id,title,width,height,taken_at takenAt,size FROM photos ORDER BY taken_at DESC,title').all() as any[];
  res.json(rows.map(x=>({...x,thumbnailUrl:`/api/photos/${x.id}/thumbnail`,originalUrl:`/api/photos/${x.id}/original`})));
});
apiRouter.get('/photos/:id/thumbnail',async(req,res,next)=>{try{const row=db.prepare('SELECT file_path FROM photos WHERE id=?').get(Number(req.params.id)) as any;if(!row||!fs.existsSync(row.file_path))return res.status(404).end();res.sendFile(await photoThumbnail(Number(req.params.id),row.file_path))}catch(error){next(error)}});
apiRouter.get('/photos/:id/original',(req,res)=>{const row=db.prepare('SELECT file_path FROM photos WHERE id=?').get(Number(req.params.id)) as any;if(!row||!fs.existsSync(row.file_path))return res.status(404).end();res.type(mime.lookup(row.file_path)||'application/octet-stream').sendFile(row.file_path)});

apiRouter.get('/tv/sources', requireAdmin, (_req,res)=>res.json(db.prepare('SELECT id,name,playlist_url playlistUrl,xmltv_url xmltvUrl,recording_path recordingPath,enabled FROM tv_sources ORDER BY name').all()));
apiRouter.post('/tv/sources', requireAdmin, async(req,res,next)=>{try{const{name,playlistUrl,xmltvUrl,recordingPath}=req.body||{};if(!String(name||'').trim()||!String(playlistUrl||'').trim())return res.status(400).json({error:'Naam en M3U-locatie zijn verplicht.'});if(!String(recordingPath||'').trim())return res.status(400).json({error:'Kies een map voor opnames.'});fs.mkdirSync(path.resolve(recordingPath),{recursive:true});const result=db.prepare('INSERT INTO tv_sources(name,playlist_url,xmltv_url,recording_path) VALUES(?,?,?,?)').run(String(name).trim(),String(playlistUrl).trim(),String(xmltvUrl||'').trim()||null,path.resolve(recordingPath));const id=Number(result.lastInsertRowid);await refreshTvSource(id);res.status(201).json({id,name,playlistUrl,xmltvUrl,recordingPath:path.resolve(recordingPath),enabled:true})}catch(error){next(error)}});
apiRouter.post('/tv/sources/:id/refresh', requireAdmin, async(req,res,next)=>{try{await refreshTvSource(Number(req.params.id));res.status(204).end()}catch(error){next(error)}});
apiRouter.delete('/tv/sources/:id', requireAdmin, (req,res)=>{db.prepare('DELETE FROM tv_sources WHERE id=?').run(Number(req.params.id));res.status(204).end()});
apiRouter.get('/tv/channels',(_req,res)=>{const now=new Date().toISOString();const rows=db.prepare(`SELECT c.id,c.name,c.channel_number channelNumber,c.logo_url logoUrl,(SELECT title FROM tv_programs p WHERE p.channel_id=c.id AND p.start_time<=? AND p.end_time>? ORDER BY p.start_time DESC LIMIT 1) nowTitle FROM tv_channels c WHERE c.enabled=1 ORDER BY CAST(c.channel_number AS INTEGER),c.name`).all(now,now) as any[];res.json(rows)});
apiRouter.get('/tv/guide',(req,res)=>{const start=typeof req.query.start==='string'?req.query.start:new Date().toISOString();const end=typeof req.query.end==='string'?req.query.end:new Date(Date.now()+6*3600000).toISOString();res.json(db.prepare(`SELECT p.id,p.channel_id channelId,p.start_time startTime,p.end_time endTime,p.title,p.description,p.category,p.episode,c.name channelName,c.logo_url logoUrl,EXISTS(SELECT 1 FROM tv_recordings r WHERE r.program_id=p.id) scheduled FROM tv_programs p JOIN tv_channels c ON c.id=p.channel_id WHERE p.end_time>? AND p.start_time<? ORDER BY c.name,p.start_time`).all(start,end))});
apiRouter.get('/tv/channels/:id/hls/:file',async(req,res,next)=>{try{const id=Number(req.params.id);const channel=db.prepare('SELECT stream_url FROM tv_channels WHERE id=? AND enabled=1').get(id) as any;if(!channel)return res.status(404).end();const cacheId=2_000_000+id;if(req.params.file==='index.m3u8')await ensureHls(cacheId,channel.stream_url);const file=hlsFile(cacheId,req.params.file);if(!file)return res.status(404).end();res.setHeader('Cache-Control',req.params.file.endsWith('.m3u8')?'no-store':'public,max-age=3600');res.sendFile(file)}catch(error){next(error)}});
apiRouter.post('/tv/recordings',(req,res)=>{const program=db.prepare('SELECT * FROM tv_programs WHERE id=?').get(Number(req.body.programId)) as any;if(!program)return res.status(404).json({error:'Programma niet gevonden.'});const duplicate=db.prepare("SELECT id FROM tv_recordings WHERE program_id=? AND status!='cancelled'").get(program.id) as any;if(duplicate)return res.json({id:duplicate.id});const result=db.prepare('INSERT INTO tv_recordings(program_id,channel_id,title,start_time,end_time) VALUES(?,?,?,?,?)').run(program.id,program.channel_id,program.title,program.start_time,program.end_time);res.status(201).json({id:Number(result.lastInsertRowid),status:'scheduled'})});
apiRouter.get('/tv/recordings',(_req,res)=>res.json(db.prepare('SELECT id,title,start_time startTime,end_time endTime,status,error FROM tv_recordings ORDER BY start_time DESC').all()));
apiRouter.delete('/tv/recordings/:id',(req,res)=>{db.prepare("UPDATE tv_recordings SET status='cancelled' WHERE id=? AND status='scheduled'").run(Number(req.params.id));res.status(204).end()});
apiRouter.get('/tv/recordings/:id/download',(req,res)=>{const row=db.prepare("SELECT file_path FROM tv_recordings WHERE id=? AND status='ready'").get(Number(req.params.id)) as any;if(!row?.file_path||!fs.existsSync(row.file_path))return res.status(404).end();res.download(row.file_path,path.basename(row.file_path))});

apiRouter.get('/folders', requireAdmin, async (req, res) => {
  let current = typeof req.query.path === 'string' ? req.query.path : '';
  if (!current) {
    if (process.platform === 'win32') {
      const drives = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `${letter}:\\`).filter(drive => fs.existsSync(drive));
      return res.json({ current: '', parent: null, folders: drives.map(drive => ({ name: drive, path: drive })) });
    }
    current = os.homedir();
  }
  try {
    current = path.resolve(current);
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    const folders = entries.filter(x => x.isDirectory() && !x.name.startsWith('$') && x.name !== 'System Volume Information').map(x => ({ name: x.name, path: path.join(current, x.name) })).sort((a,b) => a.name.localeCompare(b.name, 'nl'));
    const root = path.parse(current).root;
    res.json({ current, parent: current === root ? '' : path.dirname(current), folders });
  } catch { res.status(400).json({ error: 'Deze map kan niet worden geopend.' }); }
});

apiRouter.get('/settings', requireAdmin, (_req, res) => res.json(publicSettings()));
apiRouter.patch('/settings', requireAdmin, async (req, res, next) => {
  try {
    const { serverName, language, autoplay, rewindOnResume, skipIntro, skipCredits, hardwareTranscoding, toneMapping, maxTranscodes, uploadLimitMbps, automaticBackups, backupRetention, backupLocation, automaticUpdateCheck, updateChannel, developmentUpdatesEnabled, maxLogStorageMb,localStreamingEnabled,localStreamingAddress,localStreamingPort,automaticDeviceDiscovery,dlnaDiscoveryEnabled,deviceRetentionDays,castReceiverAppId,defaultQualityLan,defaultQualityTailscale,defaultQualityMobile,defaultQualityDownload,defaultQualityLiveTv,metadataCacheDays,omdbLocalDailyLimit,metadataStrategy } = req.body || {};
    if(localStreamingPort!==undefined&&!isValidLanStreamingPort(localStreamingPort,Number(process.env.PORT||APP_PORT)))return res.status(400).json({error:'Kies een streamingpoort tussen 1024 en 65535 die niet gelijk is aan de beheerpoort.'});
    if (typeof serverName === 'string' && serverName.trim()) setSetting('serverName', serverName.trim());
    if (typeof language === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(language)) setSetting('language', language);
    if(metadataCacheDays!==undefined)setSetting('metadataCacheDays',String(Math.min(365,Math.max(1,Number(metadataCacheDays)||14))));
    if(omdbLocalDailyLimit!==undefined)setSetting('omdbLocalDailyLimit',String(Math.min(100000,Math.max(1,Number(omdbLocalDailyLimit)||1000))));
    if(['local_first','online_first','local_only'].includes(metadataStrategy))setSetting('metadataStrategy',metadataStrategy);
    if (typeof autoplay === 'boolean') setSetting('autoplay', String(autoplay));
    if (rewindOnResume !== undefined) setSetting('rewindOnResume', String(Math.min(30, Math.max(0, Number(rewindOnResume) || 0))));
    if (typeof skipIntro === 'boolean') setSetting('skipIntro', String(skipIntro));
    if (typeof skipCredits === 'boolean') setSetting('skipCredits', String(skipCredits));
    if (['auto','software','nvidia','intel','amd'].includes(hardwareTranscoding)) setSetting('hardwareTranscoding', hardwareTranscoding);
    if (typeof toneMapping === 'boolean') setSetting('toneMapping', String(toneMapping));
    if (maxTranscodes !== undefined) setSetting('maxTranscodes', String(Math.min(10, Math.max(1, Number(maxTranscodes) || 2))));
    if (uploadLimitMbps !== undefined) setSetting('uploadLimitMbps', String(Math.max(0, Number(uploadLimitMbps) || 0)));
    if (['off','daily','weekly'].includes(automaticBackups)) setSetting('automaticBackups',automaticBackups);
    if (backupRetention !== undefined) setSetting('backupRetention',String(Math.min(100,Math.max(1,Number(backupRetention)||14))));
    if (typeof backupLocation==='string'&&backupLocation.trim()) setSetting('backupLocation',path.resolve(backupLocation.trim()));
    if (typeof automaticUpdateCheck==='boolean') setSetting('automaticUpdateCheck',String(automaticUpdateCheck));
    if (['stable','beta','development'].includes(updateChannel)) setSetting('updateChannel',updateChannel);
    if (typeof developmentUpdatesEnabled==='boolean') setSetting('developmentUpdatesEnabled',String(developmentUpdatesEnabled));
    if (maxLogStorageMb!==undefined) { const value=Math.min(2048,Math.max(10,Number(maxLogStorageMb)||100)); setSetting('maxLogStorageMb',String(value)); setMaxLogStorageMb(value); }
    if(typeof localStreamingEnabled==='boolean')setSetting('localStreamingEnabled',String(localStreamingEnabled));
    if(typeof localStreamingAddress==='string'&&(!localStreamingAddress||/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}$/.test(localStreamingAddress)))setSetting('localStreamingAddress',localStreamingAddress);
    if(localStreamingPort!==undefined)setSetting('localStreamingPort',String(Number(localStreamingPort)));
    if(typeof automaticDeviceDiscovery==='boolean')setSetting('automaticDeviceDiscovery',String(automaticDeviceDiscovery));
    if(typeof dlnaDiscoveryEnabled==='boolean')setSetting('dlnaDiscoveryEnabled',String(dlnaDiscoveryEnabled));
    if(deviceRetentionDays!==undefined)setSetting('deviceRetentionDays',String(Math.min(365,Math.max(1,Number(deviceRetentionDays)||30))));
    if(typeof castReceiverAppId==='string'&&/^[A-F0-9]{0,16}$/i.test(castReceiverAppId))setSetting('castReceiverAppId',castReceiverAppId);
    const qualityValues=QUALITY_PROFILES.map(item=>item.id);for(const[key,value]of Object.entries({defaultQualityLan,defaultQualityTailscale,defaultQualityMobile,defaultQualityDownload,defaultQualityLiveTv}))if(qualityValues.includes(value as any))setSetting(key,String(value));
    res.json(publicSettings());
  } catch(error) { next(error); }
});

apiRouter.get('/users', requireAdmin, (_req, res) => res.json(db.prepare('SELECT id,username,role,max_content_rating maxContentRating,can_download canDownload,created_at createdAt FROM users ORDER BY username').all()));
apiRouter.post('/users', requireAdmin, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || username.trim().length < 2 || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Gebruik minimaal 2 tekens voor de naam en 8 voor het wachtwoord.' });
  try { res.status(201).json(await createUser(username, password, 'user')); }
  catch { res.status(409).json({ error: 'Deze gebruikersnaam bestaat al.' }); }
});
apiRouter.patch('/users/:id', requireAdmin, (req,res)=>{
  const maxRating=typeof req.body.maxContentRating==='string'?req.body.maxContentRating:'ALL';
  const canDownload=req.body.canDownload===undefined?1:Number(Boolean(req.body.canDownload));
  db.prepare('UPDATE users SET max_content_rating=?,can_download=? WHERE id=?').run(maxRating,canDownload,Number(req.params.id));
  audit(req.user!.id,'user.permissions',{userId:Number(req.params.id),maxRating,canDownload:Boolean(canDownload)});
  res.status(204).end();
});

const providerIds=new Set<MetadataProviderId>(['tvmaze','omdb','local_nfo','embedded','manual']);
function providerId(value:unknown){const id=String(value||'') as MetadataProviderId;if(!providerIds.has(id))throw Object.assign(new Error('Onbekende metadataprovider.'),{status:400});return id}
apiRouter.get('/metadata/providers',requireAdmin,(_req,res)=>res.json({providers:Object.values(metadataProviders).map(provider=>provider.getProviderStatus()),secrets:secretsStatus(),movieOrder:providerOrder('movie'),seriesOrder:providerOrder('series'),cacheDays:Number(getSetting('metadataCacheDays','14')),omdbLocalDailyLimit:Number(getSetting('omdbLocalDailyLimit','1000')),metadataStrategy:getSetting('metadataStrategy','local_first')}));
apiRouter.patch('/metadata/providers/:provider',requireAdmin,(req,res,next)=>{try{const id=providerId(req.params.provider);if(typeof req.body?.enabled==='boolean')setProviderEnabled(id,req.body.enabled);res.json(metadataProviders[id].getProviderStatus())}catch(error){next(error)}});
apiRouter.put('/metadata/provider-order/:kind',requireAdmin,(req,res,next)=>{try{const kind=req.params.kind==='series'?'series':'movie';setProviderOrder(kind,(Array.isArray(req.body?.order)?req.body.order:[]).map(providerId));res.json({kind,order:providerOrder(kind)})}catch(error){next(error)}});
apiRouter.post('/metadata/providers/:provider/test',requireAdmin,async(req,res,next)=>{try{res.json(await metadataProviders[providerId(req.params.provider)].testConnection())}catch(error){next(error)}});
apiRouter.put('/metadata/omdb-key',requireAdmin,async(req,res,next)=>{const old=getOmdbApiKey();try{setOmdbApiKey(String(req.body?.key||''));const test=await metadataProviders.omdb.testConnection();if(!test.ok)throw Object.assign(new Error(test.message),{status:400});res.json({...test,...secretsStatus()})}catch(error){if(old)setOmdbApiKey(old);else clearOmdbApiKey();next(error)}});
apiRouter.delete('/metadata/omdb-key',requireAdmin,(_req,res)=>{clearOmdbApiKey();res.status(204).end()});
apiRouter.delete('/metadata/cache',requireAdmin,(req,res)=>{const provider=req.query.provider?providerId(req.query.provider):undefined;res.json({responses:clearProviderCache(provider),images:provider?0:clearMetadataImageCache()})});
apiRouter.get('/metadata/dashboard',requireAdmin,(_req,res)=>res.json(metadataDashboard()));
apiRouter.post('/metadata/queue/retry',requireAdmin,(_req,res)=>res.json({retried:retryMetadataQueue()}));
apiRouter.post('/metadata/migrate',requireAdmin,async(_req,res,next)=>{try{res.json(await migrateLegacyTmdbMetadata())}catch(error){next(error)}});
apiRouter.get('/metadata/images/:id',(req,res)=>{const image=metadataImageFile(Number(req.params.id));if(!image)return res.status(404).end();res.setHeader('Cache-Control','private,max-age=86400,immutable');res.type(image.contentType||'application/octet-stream').sendFile(image.localPath)});
apiRouter.get('/media/:id/metadata',requireAdmin,(req,res,next)=>{try{res.json(metadataStatusForMedia(Number(req.params.id)))}catch(error){next(error)}});
apiRouter.get('/media/:id/metadata/search',requireAdmin,async(req,res,next)=>{try{res.json(await searchMetadata(Number(req.params.id),req.query.provider?providerId(req.query.provider):undefined))}catch(error){next(error)}});
apiRouter.put('/media/:id/metadata/match',requireAdmin,async(req,res,next)=>{try{res.json(await applyProviderMatch(Number(req.params.id),providerId(req.body?.provider),String(req.body?.providerId||''),'very_certain'))}catch(error){next(error)}});
apiRouter.post('/media/:id/metadata/refresh',requireAdmin,async(req,res,next)=>{try{const id=Number(req.params.id);if(req.body?.mode==='local')return res.json(await applyLocalMetadata(id));res.json(await processMetadataMedia(id,req.body?.mode||'refresh',req.body?.provider?providerId(req.body.provider):undefined))}catch(error){next(error)}});
apiRouter.post('/media/:id/metadata/images',requireAdmin,async(req,res,next)=>{try{const id=Number(req.params.id);const type=String(req.body?.type||'poster');if(!['poster','backdrop','banner','logo','landscape','episode'].includes(type))return res.status(400).json({error:'Ongeldig afbeeldingstype.'});const context=metadataContext(id);if(typeof req.body?.url==='string'&&req.body.url.trim())return res.status(201).json(await cacheExternalImage(id,{type:type as any,url:req.body.url.trim()},'manual',fetch,true));if(typeof req.body?.localPath==='string'&&req.body.localPath.trim())return res.status(201).json(await cacheLocalImage(id,type as any,req.body.localPath.trim(),context.sourcePath!,true));res.status(400).json({error:'Geef een afbeeldings-URL of lokaal pad op.'})}catch(error){next(error)}});
apiRouter.put('/media/:id/metadata/images/:imageId/select',requireAdmin,(req,res,next)=>{try{res.json(selectMetadataImage(Number(req.params.id),Number(req.params.imageId)))}catch(error){next(error)}});
apiRouter.delete('/media/:id/metadata/images/:imageId',requireAdmin,(req,res)=>res.status(removeMetadataImage(Number(req.params.id),Number(req.params.imageId))?204:404).end());
apiRouter.get('/media/:id/metadata/history',requireAdmin,(req,res)=>res.json(metadataHistory(Number(req.params.id))));
apiRouter.get('/media/:id/metadata/fields',requireAdmin,(req,res)=>res.json(metadataFieldStates(Number(req.params.id))));
apiRouter.put('/media/:id/metadata/fields/:field/lock',requireAdmin,(req,res)=>{setMetadataFieldLock(Number(req.params.id),String(req.params.field),Boolean(req.body?.locked));res.status(204).end()});
apiRouter.post('/media/:id/metadata/history/:historyId/restore',requireAdmin,(req,res,next)=>{try{res.json(restoreMetadataHistory(Number(req.params.id),Number(req.params.historyId)))}catch(error){next(error)}});
