import { useEffect, useState } from 'react';
import { post, type MediaItem, type Settings } from './api';
import { castAvailable, castController, castMedia, disconnectCast, initializeCast } from './cast';

export function CastButton({item,settings,onError}:{item:MediaItem;settings:Settings;onError:(message:string)=>void}) {
  const [ready,setReady]=useState(castAvailable());const[busy,setBusy]=useState(false);
  useEffect(()=>{const update=()=>{setReady(initializeCast(settings.castReceiverAppId))};window.addEventListener('thuishub-cast-ready',update);update();return()=>window.removeEventListener('thuishub-cast-ready',update)},[settings.castReceiverAppId]);
  async function start(){setBusy(true);try{const result=await post<any>(`/playback/${item.id}/decision`,{target:'cast',quality:settings.defaultQualityLan,network:'lan'});if(result.localStreamingRequired)throw new Error('Schakel eerst Instellingen → Netwerk → Streamen binnen thuisnetwerk in en herstart ThuisHub.');await castMedia(item,result.urls,result.decision);window.dispatchEvent(new Event('thuishub-cast-session'))}catch(error:any){onError(error.message||'Cast kon niet starten.')}finally{setBusy(false)}}
  return <button className="tv-play-button" disabled={!ready||busy} onClick={()=>void start()} title={ready?'Zoek Google Cast-apparaten':'Cast is beschikbaar in Chrome of Edge'}>{busy?'Verbinden…':'▣ Afspelen op tv'}</button>;
}

export function CastRemote(){const[active,setActive]=useState(false);const[playing,setPlaying]=useState(false);const[volume,setVolume]=useState(1);
  useEffect(()=>{const refresh=()=>{const remote=castController();setActive(Boolean(remote));if(remote){setPlaying(!remote.player.isPaused);setVolume(remote.player.volumeLevel)}};window.addEventListener('thuishub-cast-session',refresh);const timer=setInterval(refresh,2000);refresh();return()=>{clearInterval(timer);window.removeEventListener('thuishub-cast-session',refresh)}},[]);
  if(!active)return null;function remote(){return castController()}
  return <aside className="cast-remote"><strong>Afspelen op tv</strong><div><button onClick={()=>{const r=remote();if(r){r.controller.playOrPause();setPlaying(!playing)}}}>{playing?'Pauzeren':'Afspelen'}</button><button onClick={()=>{const r=remote();if(r){r.player.currentTime=Math.max(0,r.player.currentTime-30);r.controller.seek()}}}>−30s</button><button onClick={()=>{const r=remote();if(r){r.player.currentTime+=30;r.controller.seek()}}}>+30s</button><button onClick={()=>{const r=remote();r?.controller.stop()}}>Stop</button></div><label>Volume <input type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>{const value=Number(e.target.value);setVolume(value);const r=remote();if(r){r.player.volumeLevel=value;r.controller.setVolumeLevel()}}}/></label><button onClick={()=>void disconnectCast().then(()=>setActive(false))}>Verbinding verbreken</button></aside>}
