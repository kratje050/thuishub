import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { ApiError, api, patch, post, put, type Bootstrap, type MediaItem, type ScanState, type Settings, type Source, type User } from './api';
import ServerDashboard from './ServerDashboard';
import MetadataSettings from './MetadataSettings';
import { CastButton } from './TvPlayback';
import { localBrowserDeviceId, PlaybackDeviceLayer, PlaybackDeviceProvider } from './playback-devices';
import type { PlaybackSession } from './playback-devices';
import { confirmPlaybackReceiverStatus, controlPlaybackSession, createPlaybackSession, getActivePlaybackSession, stopPlaybackSessionAtLatestRevision, updatePlaybackSession } from './playback-devices/api';
import { describeCastEnvironment } from './cast';
import { localPlayerVolume } from './playback-devices/local-player-command';
import { AppShell, BottomStatusBar, ContinueWatchingCard, DownloadsPage, EmptyState, HeroBanner, LibraryTabs, MediaRow, PageTitle, PlayerControls, PosterCard, QualityBadges, Sidebar, SystemStatusPanel, Toast, TopBar, isNavigationActive, useSystemStatus, type ReferenceView } from './reference-ui';

type View = ReferenceView;
type MusicTrack={id:number;title:string;artist:string;album:string;albumArtist?:string;track?:number;disc?:number;year?:number;duration?:number;coverUrl?:string;genres:string[]};
type PhotoItem={id:number;title:string;width?:number;height?:number;takenAt?:string;size:number;thumbnailUrl:string;originalUrl:string};

function Icon({ name }: { name: 'home' | 'movie' | 'series' | 'music' | 'photos' | 'live' | 'watchlist' | 'settings' | 'search' | 'play' | 'close' | 'folder' | 'refresh' | 'download' | 'heart' | 'check' | 'plus' }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/></>,
    movie: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M7 5 9 2m3 3 2-3m3 3 2-3M3 10h18"/></>,
    series: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m9 8 6 4-6 4Z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>,
    close: <path d="M6 6l12 12M18 6 6 18"/>,
    folder: <path d="M3 6h7l2 2h9v11H3Z"/>,
    refresh: <><path d="M20 7v5h-5"/><path d="M18.5 16a8 8 0 1 1 .5-8l1 4"/></>,
    watchlist: <><path d="M5 5h14M5 12h9M5 19h14"/><path d="m17 10 4 2-4 2Z"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 21h14"/></>,
    heart: <path d="M20.8 5.7a5.4 5.4 0 0 0-7.6 0L12 6.9l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 22l8.8-8.7a5.4 5.4 0 0 0 0-7.6Z"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    music: <><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
    photos: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 2-2 6 5"/></>,
    live: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="m8 2 4 3 4-3M8 10l7 3-7 3Z"/></>
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function MediaCard({ item, subtitle, onClick }: { item: MediaItem; subtitle?: string; onClick: () => void }) {
  const progress = item.progress && item.progress.duration > 0 ? Math.min(100, item.progress.position / item.progress.duration * 100) : 0;
  return <button className="media-card" onClick={onClick}>
    <div className="poster">
      {item.posterUrl ? <img src={item.posterUrl} alt="" loading="lazy" /> : <div className="poster-fallback"><span>{item.kind === 'movie' ? 'FILM' : 'SERIE'}</span><strong>{item.seriesTitle || item.title}</strong></div>}
      <div className="poster-play"><span><Icon name="play" /></span></div>
      {item.height && <span className="quality">{item.height >= 2100 ? '4K' : item.height >= 1000 ? 'HD' : 'SD'}</span>}
      {progress > 0 && !item.progress?.completed && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}
    </div>
    <strong className="card-title">{item.seriesTitle || item.title}</strong>
    <span className="card-meta">{subtitle || [item.year, item.duration ? formatDuration(item.duration) : null].filter(Boolean).join(' · ') || 'Klaar om af te spelen'}</span>
  </button>;
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}u ${minutes % 60}m` : `${minutes} min`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Player({ item, settings, onClose, onProgress, onFinished }: { item: MediaItem; settings: Settings; onClose: () => void; onProgress: (id: number, progress: MediaItem['progress']) => void; onFinished: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [transcoding, setTranscoding] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  const lastSaved = useRef(0);
  const playbackSession = useRef<PlaybackSession | null>(null);
  const reportQueue = useRef<Promise<void>>(Promise.resolve());
  const closingSessions = useRef(new Set<string>());
  const restartPosition = useRef<{ mediaId: number; position: number } | null>(null);
  const [markers, setMarkers] = useState<{id:number;type:'intro'|'credits'|'commercial';startTime:number;endTime:number}[]>([]);
  const [activeMarker, setActiveMarker] = useState<typeof markers[number] | null>(null);
  const [speed, setSpeed] = useState(1);
  const [quality,setQuality]=useState(settings.defaultQualityLan||'auto');
  const [playbackInfo,setPlaybackInfo]=useState<any>(null);
  const [showTechnical,setShowTechnical]=useState(false);

  const report = useCallback((state: 'playing'|'paused'|'error' = 'playing') => {
    const video = videoRef.current;
    if (!video) return;
    const position = Math.max(0, Number(video.currentTime) || 0);
    const duration = Number.isFinite(video.duration) ? Math.max(0, Number(video.duration) || 0) : Math.max(0, Number(playbackSession.current?.duration) || 0);
    lastSaved.current = Date.now();
    reportQueue.current = reportQueue.current.then(async () => {
      let current = playbackSession.current;
      if (!current || current.mediaId !== item.id || current.state === 'stopped' || closingSessions.current.has(current.id)) return;
      const send = () => state === 'playing' || state === 'error'
        ? confirmPlaybackReceiverStatus(current!.id, Number(current!.revision || 0), state, position, duration)
        : updatePlaybackSession(current!.id, Number(current!.revision || 0), state, position, duration);
      try {
        let response;
        try { response = await send(); }
        catch (caught) {
          if (!(caught instanceof ApiError) || caught.status !== 409 || caught.code !== 'STALE_PLAYBACK_SESSION') throw caught;
          if (closingSessions.current.has(current.id)) return;
          const latest = await getActivePlaybackSession();
          if (!latest.session || latest.session.id !== current.id) {
            if (playbackSession.current?.id === current.id) playbackSession.current = null;
            video.pause();
            return;
          }
          current = latest.session;
          if (closingSessions.current.has(current.id)) return;
          response = await send();
        }
        if (closingSessions.current.has(current.id)) return;
        if (response.session && playbackSession.current?.id === current.id) playbackSession.current = response.session;
        if (state !== 'error') onProgress(item.id, { position, duration, completed: duration > 0 && position / duration >= .92 });
      } catch (caught) {
        if (state === 'error') setError(errorMessage(caught, 'De lokale afspeelsessie kon niet worden afgesloten.'));
      }
    }).catch(() => undefined);
  }, [item.id, onProgress]);

  const stopSession = useCallback((reason: string) => {
    const current = playbackSession.current;
    const video = videoRef.current;
    if (!current) return;
    closingSessions.current.add(current.id);
    playbackSession.current = null;
    const position = Math.max(0, Number(video?.currentTime) || Number(current.position) || 0);
    const duration = Number.isFinite(video?.duration) ? Math.max(0, Number(video?.duration) || 0) : Math.max(0, Number(current.duration) || 0);
    reportQueue.current = reportQueue.current.then(async () => {
      try {
        await stopPlaybackSessionAtLatestRevision(current.id, { position, duration, reason }, Number(current.revision || 0));
        onProgress(item.id, { position, duration, completed: duration > 0 && position / duration >= .92 });
      } catch { /* De sessie kan intussen door een succesvolle overdracht zijn gestopt. */ }
      finally { closingSessions.current.delete(current.id); }
    }).catch(() => undefined);
  }, [item.id, onProgress]);

  const useHls = useCallback((source:string,mode:string,onFatal?:()=>void) => {
    const video = videoRef.current;
    if (!video) return;
    setError(''); setTranscoding(mode==='transcode');
    if (Hls.isSupported()) {
      hlsRef.current?.destroy();
      const hls = new Hls({ maxBufferLength: 30, manifestLoadingMaxRetry: 4 });
      hlsRef.current = hls;
      hls.loadSource(source); hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) { setError('Deze video kon niet worden omgezet. Controleer het bestand en probeer opnieuw.'); onFatal?.(); } });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = source; }
  }, []);

  useEffect(() => {
    const video = videoRef.current!;let cancelled=false;
    hlsRef.current?.destroy();setError('');
    playbackSession.current=null;
    const requestedPosition = restartPosition.current?.mediaId !== item.id
      ? Math.max(0, Number(item.progress?.position || 0) - Number(settings.rewindOnResume || 0))
      : Math.max(0, restartPosition.current.position);
    restartPosition.current = null;
    let sessionCreated: PlaybackSession | null = null;
    void createPlaybackSession(item.id,localBrowserDeviceId(),requestedPosition,quality).then(result=>{
      if(!result.session)throw new Error('De centrale lokale afspeelsessie ontbreekt.');
      sessionCreated=result.session;
      if(cancelled){void controlPlaybackSession(result.session.id,'stop',{reason:'local-player-cancelled'},result.session.revision).catch(()=>undefined);return;}
      playbackSession.current=result.session;
      video.dataset.thuishubPlaybackSession=result.session.id;
      setPlaybackInfo(result);setTranscoding((result.decision as any)?.mode==='transcode');
      if((result.decision as any)?.mode==='direct_play')video.src=String(result.urls?.playback||'');
      else useHls(String(result.urls?.playback||''),String((result.decision as any)?.mode||''),()=>report('error'));
    }).catch(caught=>{if(!cancelled){setError(errorMessage(caught,'De lokale video kon niet starten.'));if(sessionCreated)report('error');}});
    const restore = () => { if (requestedPosition > 0 && requestedPosition < video.duration * .92) video.currentTime = requestedPosition; };
    const timer = window.setInterval(() => { if (!video.paused && Date.now() - lastSaved.current > 8000) report('playing'); }, 3000);
    video.addEventListener('loadedmetadata', restore, { once: true });
    return () => { cancelled=true;window.clearInterval(timer);restartPosition.current={mediaId:item.id,position:Math.max(0,Number(video.currentTime)||0)};stopSession('local-player-closed');hlsRef.current?.destroy();video.removeEventListener('loadedmetadata',restore);delete video.dataset.thuishubPlaybackSession;video.removeAttribute('src');video.load(); };
  }, [item.id,quality]);

  useEffect(()=>{void api<typeof markers>(`/media/${item.id}/markers`).then(setMarkers);},[item.id]);
  useEffect(()=>{const video=videoRef.current;if(!video)return;const track=()=>setActiveMarker(markers.find(marker=>video.currentTime>=marker.startTime&&video.currentTime<marker.endTime)||null);video.addEventListener('timeupdate',track);return()=>video.removeEventListener('timeupdate',track);},[markers]);
  useEffect(()=>{const transferred=(event:Event)=>{const detail=(event as CustomEvent<{mediaId:number}>).detail;if(detail?.mediaId!==item.id)return;videoRef.current?.pause();onClose();};window.addEventListener('thuishub-playback-transferred',transferred);return()=>window.removeEventListener('thuishub-playback-transferred',transferred);},[item.id,onClose]);
  useEffect(()=>{const commanded=(event:Event)=>{const detail=(event as CustomEvent<{sessionId:string;command:string;payload:Record<string,unknown>}>).detail;const current=playbackSession.current;const video=videoRef.current;if(!current||!video||detail?.sessionId!==current.id)return;if(detail.command==='play')void video.play();else if(detail.command==='pause')video.pause();else if(detail.command==='seek'){video.currentTime=Math.max(0,Number(detail.payload?.position)||0);report(video.paused?'paused':'playing');}else if(detail.command==='volume'){const volume=localPlayerVolume(detail.payload||{});if(volume!==null)video.volume=volume;}else if(detail.command==='stop')onClose();};window.addEventListener('thuishub-local-player-command',commanded);return()=>window.removeEventListener('thuishub-local-player-command',commanded);},[onClose,report]);
  function changeSpeed(value:number){setSpeed(value);if(videoRef.current)videoRef.current.playbackRate=value;}
  function finish(){stopSession('completed');onFinished();}

  return <div className="player-layer">
    <div className="player-top"><div><strong>{item.kind === 'episode' ? item.seriesTitle : item.title}</strong>{item.kind === 'episode' && <span>S{item.season} · A{item.episode} · {item.title}</span>}{playbackInfo&&<span className={`playback-mode ${playbackInfo.decision.mode}`}>{playbackInfo.decision.label}</span>}</div><PlayerControls><CastButton item={item} settings={settings} onError={setError} getStartPosition={()=>Number(videoRef.current?.currentTime || item.progress?.position || 0)}/><label>Kwaliteit <select value={quality} onChange={e=>setQuality(e.target.value)}><option value="auto">Automatisch</option><option value="original">Origineel</option><option value="4k-max">4K Maximum</option><option value="4k-high">4K Hoog</option><option value="4k-balanced">4K Gebalanceerd</option><option value="1080p-max">1080p Maximum</option><option value="1080p-high">1080p Hoog</option><option value="1080p-balanced">1080p Gebalanceerd</option><option value="720p">720p</option><option value="data-saver">Databesparing</option></select></label><label>Snelheid <select value={speed} onChange={e=>changeSpeed(Number(e.target.value))}>{[.5,.75,1,1.25,1.5,2].map(x=><option key={x} value={x}>{x}×</option>)}</select></label><button onClick={()=>setShowTechnical(!showTechnical)}>Technische informatie</button><button className="icon-button" onClick={onClose} aria-label="Sluiten"><Icon name="close" /></button></PlayerControls></div>
    <video ref={videoRef} controls autoPlay playsInline onPlaying={()=>report('playing')} onPause={()=>report('paused')} onError={()=>report('error')} onEnded={finish}>
      {item.hasSubtitle && playbackInfo?.urls.subtitle && <track default kind="subtitles" srcLang="nl" label="Nederlands" src={playbackInfo.urls.subtitle} />}
    </video>
    {transcoding && !error && <div className="player-status"><span className="spinner" /><strong>Video wordt klaargemaakt</strong><small>De eerste keer kan dit even duren</small></div>}
    {error && <div className="player-status"><strong>{error}</strong></div>}
    {showTechnical&&playbackInfo&&<aside className="technical-playback"><header><strong>Technische informatie</strong><button onClick={()=>setShowTechnical(false)}>Sluiten</button></header><div className="technical-grid"><span>Methode<b>{playbackInfo.decision.label}</b></span><span>Container<b>{playbackInfo.technical.container} → {playbackInfo.decision.outputContainer}</b></span><span>Video<b>{playbackInfo.technical.videoCodec} → {playbackInfo.decision.outputVideoCodec}</b></span><span>Beeld<b>{playbackInfo.technical.width}×{playbackInfo.technical.height} · {playbackInfo.technical.frameRate?.toFixed?.(3)||'?'} fps · {playbackInfo.technical.bitDepth}-bit</b></span><span>HDR<b>{playbackInfo.technical.hdr}{playbackInfo.technical.dolbyVisionProfile?` profiel ${playbackInfo.technical.dolbyVisionProfile}`:''}</b></span><span>Audio<b>{playbackInfo.technical.audioCodec} · {playbackInfo.technical.audioChannels||'?'} kanalen{playbackInfo.technical.atmos?' · Dolby Atmos':''}</b></span><span>Passthrough<b>{playbackInfo.decision.copyAudio?'Ja':'Nee'}</b></span><span>Netwerk<b>{playbackInfo.decision.network}</b></span></div>{playbackInfo.decision.reasons.length>0&&<ul>{playbackInfo.decision.reasons.map((reason:string)=><li key={reason}>{reason}</li>)}</ul>}<div className="codec-badges">{[playbackInfo.technical.height>=2160?'4K':null,playbackInfo.technical.hdr!=='sdr'?String(playbackInfo.technical.hdr).toUpperCase():null,playbackInfo.technical.atmos?'Dolby Atmos':null,playbackInfo.decision.label].filter(Boolean).map((badge:string)=><b key={badge}>{badge}</b>)}</div></aside>}
    {activeMarker && ((activeMarker.type==='intro'&&settings.skipIntro)||(activeMarker.type==='credits'&&settings.skipCredits)||activeMarker.type==='commercial') && <button className="skip-button" onClick={()=>{if(videoRef.current)videoRef.current.currentTime=activeMarker.endTime;}}>{activeMarker.type==='intro'?'Intro overslaan':activeMarker.type==='credits'?'Aftiteling overslaan':'Reclame overslaan'} →</button>}
  </div>;
}

function Detail({ item, episodes, playlists, settings, isAdmin, onClose, onPlay, onState, onEdit, onNotice }: { item: MediaItem; episodes?: MediaItem[]; playlists: {id:number;name:string}[];settings:Settings; isAdmin:boolean; onClose: () => void; onPlay: (item: MediaItem) => void; onState:(patch:Partial<MediaItem['state']>)=>void; onEdit:()=>void; onNotice:(message:string)=>void }) {
  const isSeries = Boolean(episodes?.length);
  const [playlistId,setPlaylistId]=useState('');
  const target=isSeries?episodes![0]:item;
  async function addPlaylist(){if(!playlistId)return;await put(`/playlists/${playlistId}/items/${target.id}`,{});onNotice('Toegevoegd aan de playlist.');}
  return <div className="detail-layer" onMouseDown={e => e.currentTarget === e.target && onClose()}>
    <article className="detail-card">
      <button className="icon-button detail-close" onClick={onClose}><Icon name="close" /></button>
      <div className="detail-hero" style={item.backdropUrl ? { backgroundImage: `linear-gradient(90deg, rgba(7,17,14,.98) 0%,rgba(7,17,14,.74) 48%,rgba(7,17,14,.1)), url(${item.backdropUrl})` } : undefined}>
        <div className="detail-copy"><p className="eyebrow">{isSeries ? 'SERIE' : 'FILM'}{item.edition?` · ${item.edition}`:''}</p><h2>{item.seriesTitle || item.title}</h2>{item.originalTitle&&item.originalTitle!==item.title&&<small className="original-title">{item.originalTitle}</small>}{item.tagline&&<em className="tagline">{item.tagline}</em>}<div className="detail-meta">{[item.year, item.contentRating,item.genres?.slice(0,3).join(', '),!isSeries && item.duration ? formatDuration(item.duration) : null].filter(Boolean).join(' · ')}</div><QualityBadges item={item}/><p>{item.overview || 'Geen beschrijving beschikbaar. Vernieuw de metadata of voeg een lokaal NFO-bestand toe.'}</p>{!isSeries && <div className="button-row"><button className="primary" onClick={() => onPlay(item)}><Icon name="play" /> Afspelen{item.progress?.position ? ' hervatten' : ''}</button><CastButton item={item} settings={settings} onError={onNotice}/></div>}</div>
      </div>
      <div className="detail-tools">
        <button className={item.state?.favorite?'tool-active':''} onClick={()=>onState({favorite:!item.state?.favorite})}><Icon name="heart"/>{item.state?.favorite?'Favoriet':'Favoriet maken'}</button>
        <button className={item.state?.watchlist?'tool-active':''} onClick={()=>onState({watchlist:!item.state?.watchlist})}><Icon name="watchlist"/>{item.state?.watchlist?'In Mijn lijst':'Mijn lijst'}</button>
        <button className={item.state?.watched?'tool-active':''} onClick={()=>onState({watched:!item.state?.watched})}><Icon name="check"/>{item.state?.watched?'Bekeken':'Markeer bekeken'}</button>
        {!isSeries&&<a href={`/api/media/${item.id}/download`}><Icon name="download"/>Download origineel</a>}
        {!isSeries&&<button onClick={async()=>{await post(`/media/${item.id}/optimize`,{profile:'1080p'});onNotice('Geoptimaliseerde versie staat in de wachtrij.');}}><Icon name="download"/>Optimaliseer 1080p</button>}
        <label className="rating-control">Jouw score <select value={item.state?.rating??''} onChange={e=>onState({rating:e.target.value?Number(e.target.value):null})}><option value="">–</option>{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n}/10</option>)}</select></label>
        {playlists.length>0&&<div className="add-playlist"><select value={playlistId} onChange={e=>setPlaylistId(e.target.value)}><option value="">Kies playlist…</option>{playlists.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={!playlistId} onClick={addPlaylist}><Icon name="plus"/></button></div>}
        {isAdmin&&<button onClick={onEdit}>Metadata bewerken</button>}
        {isAdmin&&<button onClick={async()=>{await post(`/media/${target.id}/metadata/refresh`,{mode:'refresh'});onNotice('Metadata is vernieuwd of staat klaar voor controle.');}}><Icon name="refresh"/>Metadata vernieuwen</button>}
        {isAdmin&&!isSeries&&<button onClick={async()=>{await post(`/media/${item.id}/markers/auto`);onNotice('Intro- en creditmarkers zijn aangemaakt.');}}>Intro/credits detecteren</button>}
      </div>
      <div className="detail-facts"><span><small>Regie</small><strong>{item.directors?.join(', ')||'Onbekend'}</strong></span><span><small>Cast</small><strong>{item.cast?.slice(0,4).map(person=>person.name).join(', ')||'Onbekend'}</strong></span><span><small>Audio</small><strong>{[item.audioCodec?.toUpperCase(),item.atmos?'Atmos':item.audioChannels?`${item.audioChannels} kanalen`:null].filter(Boolean).join(' · ')||'Onbekend'}</strong></span><span><small>Ondertiteling</small><strong>{item.hasSubtitle?'Beschikbaar':'Niet gevonden'}</strong></span></div>
      {isSeries && <div className="episode-list">
        <h3>Afleveringen</h3>
        {episodes!.map(ep => <button key={ep.id} className="episode" onClick={() => onPlay(ep)}>{ep.backdropUrl?<img src={ep.backdropUrl} alt="" loading="lazy"/>:<span className="episode-number">{ep.season}×{String(ep.episode || 0).padStart(2,'0')}</span>}<span><strong>S{ep.season||0} · A{ep.episode||0} · {ep.title}</strong><small>{ep.overview|| (ep.duration ? formatDuration(ep.duration) : 'Speelduur onbekend')}</small>{ep.progress?.duration&&<i className="episode-progress"><b style={{width:`${Math.min(100,ep.progress.position/ep.progress.duration*100)}%`}}/></i>}</span><Icon name="play" /></button>)}
      </div>}
    </article>
  </div>;
}

function MetadataEditor({item,onClose,onSaved}:{item:MediaItem;onClose:()=>void;onSaved:(item:MediaItem)=>void}){
  const list=(value:string)=>value.split(',').map(part=>part.trim()).filter(Boolean);const provider=item.kind==='movie'?'omdb':'tvmaze';
  const [form,setForm]=useState({title:item.title,originalTitle:item.originalTitle||'',sortTitle:item.sortTitle||item.title,year:item.year||'',runtimeMinutes:item.runtimeMinutes||'',overview:item.overview||'',contentRating:item.contentRating||'',edition:item.edition||'',tagline:item.tagline||'',genres:(item.genres||[]).join(', '),language:item.language||'',country:item.country||'',studio:item.studio||'',directors:(item.directors||[]).join(', '),writers:(item.writers||[]).join(', '),cast:(item.cast||[]).map(person=>person.name).join(', '),rating:'',premiered:item.premiered||'',officialUrl:item.officialUrl||'',season:item.season??'',episode:item.episode??'',absoluteEpisode:item.absoluteEpisode??'',aired:item.aired||'',imdbId:'',tvmazeId:''});
  const[status,setStatus]=useState<any>(null);const[results,setResults]=useState<any[]>([]);const[tab,setTab]=useState<'edit'|'search'|'artwork'|'history'>('edit');const[imageForm,setImageForm]=useState({type:'poster',url:'',localPath:''});const [error,setError]=useState('');const[message,setMessage]=useState('');
  const loadStatus=()=>api<any>(`/media/${item.id}/metadata`).then(value=>{setStatus(value);setForm(current=>({...current,imdbId:value.externalIds?.imdb||'',tvmazeId:value.externalIds?.tvmaze||''}))});useEffect(()=>{void loadStatus()},[item.id]);
  async function submit(e:React.FormEvent){e.preventDefault();try{const updated=await patch<any>(`/media/${item.id}`,{...form,year:Number(form.year)||null,runtimeMinutes:Number(form.runtimeMinutes)||null,genres:list(form.genres),directors:list(form.directors),writers:list(form.writers),cast:list(form.cast).map(name=>({name})),ratings:form.rating===''?undefined:[{source:'Handmatig',value:Number(form.rating),maxValue:10}],season:item.kind==='episode'?(form.season===''?null:Number(form.season)):undefined,episode:item.kind==='episode'?(form.episode===''?null:Number(form.episode)):undefined,absoluteEpisode:item.kind==='episode'?(form.absoluteEpisode===''?null:Number(form.absoluteEpisode)):undefined});onSaved({...item,...updated});onClose();}catch(e:any){setError(e.message)}}
  async function search(){setError('');setMessage('');try{const data=await api<any>(`/media/${item.id}/metadata/search?provider=${provider}`);setResults(data.results||[]);if(!data.results?.length)setMessage(provider==='omdb'?'Geen resultaat. Controleer de OMDb API-key of pas handmatig aan.':'Geen TVmaze-resultaat gevonden.')}catch(value:any){setError(value.message)}}
  async function choose(result:any){try{await put(`/media/${item.id}/metadata/match`,{provider,providerId:result.record.providerId});setMessage('Gekozen metadata is toegepast; handmatige en vergrendelde velden zijn behouden.');setResults([]);await loadStatus()}catch(value:any){setError(value.message)}}
  async function lock(field:any){try{await put(`/media/${item.id}/metadata/fields/${encodeURIComponent(field.fieldName)}/lock`,{locked:!field.manuallyModified});await loadStatus()}catch(value:any){setError(value.message)}}
  async function refresh(mode:string,text:string){try{await post(`/media/${item.id}/metadata/refresh`,{mode});setMessage(text);await loadStatus()}catch(value:any){setError(value.message)}}
  return <div className="modal-layer"><form className="editor-modal metadata-editor" onSubmit={submit}><header><div><p className="eyebrow">BIBLIOTHEEK</p><h2>Metadata bewerken</h2><small>{status?.provider||'Bestandsnaam'} · {status?.confidence||'nog niet gekoppeld'}{status?.needsReview?' · controle nodig':''}</small></div><button type="button" className="icon-button" onClick={onClose}><Icon name="close"/></button></header><nav className="metadata-tabs"><button type="button" className={tab==='edit'?'active':''} onClick={()=>setTab('edit')}>Velden</button><button type="button" className={tab==='search'?'active':''} onClick={()=>setTab('search')}>Zoeken en koppelen</button><button type="button" className={tab==='artwork'?'active':''} onClick={()=>setTab('artwork')}>Afbeeldingen</button><button type="button" className={tab==='history'?'active':''} onClick={()=>setTab('history')}>Herkomst en historie</button></nav>
    {tab==='edit'&&<div className="editor-grid"><label>Titel<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><label>Originele titel<input value={form.originalTitle} onChange={e=>setForm({...form,originalTitle:e.target.value})}/></label><label>Sorteertitel<input value={form.sortTitle} onChange={e=>setForm({...form,sortTitle:e.target.value})}/></label><label>Jaar<input type="number" value={form.year} onChange={e=>setForm({...form,year:e.target.value as any})}/></label><label>Speelduur (minuten)<input type="number" value={form.runtimeMinutes} onChange={e=>setForm({...form,runtimeMinutes:e.target.value as any})}/></label><label>Handmatige waardering (0-10)<input type="number" min="0" max="10" step="0.1" value={form.rating} placeholder={item.ratings?.[0]?`${item.ratings[0].value}/${item.ratings[0].maxValue}`:'Niet ingesteld'} onChange={e=>setForm({...form,rating:e.target.value})}/></label><label>Leeftijdsclassificatie<input value={form.contentRating} onChange={e=>setForm({...form,contentRating:e.target.value})} placeholder="AL, 6, 9, 12, 14, 16 of 18"/><small>Oorspronkelijk: {item.originalContentRating||'onbekend'}</small></label><label>Editie<input value={form.edition} onChange={e=>setForm({...form,edition:e.target.value})} placeholder="Director's Cut"/></label><label>IMDb-ID<input value={form.imdbId} onChange={e=>setForm({...form,imdbId:e.target.value})} placeholder="tt1234567"/></label><label>TVmaze-ID<input value={form.tvmazeId} onChange={e=>setForm({...form,tvmazeId:e.target.value})} placeholder="12345"/></label>{item.kind==='episode'&&<><label>Seizoen<input type="number" min="0" value={form.season} onChange={e=>setForm({...form,season:e.target.value as any})}/></label><label>Aflevering<input type="number" min="0" value={form.episode} onChange={e=>setForm({...form,episode:e.target.value as any})}/></label><label>Absoluut afleveringsnummer<input type="number" min="1" value={form.absoluteEpisode} onChange={e=>setForm({...form,absoluteEpisode:e.target.value as any})}/></label><label>Uitzenddatum<input type="date" value={form.aired} onChange={e=>setForm({...form,aired:e.target.value})}/></label></>}<label>Taal<input value={form.language} onChange={e=>setForm({...form,language:e.target.value})}/></label><label>Land<input value={form.country} onChange={e=>setForm({...form,country:e.target.value})}/></label><label className="span-2">Studio/netwerk<input value={form.studio} onChange={e=>setForm({...form,studio:e.target.value})}/></label><label className="span-2">Tagline<input value={form.tagline} onChange={e=>setForm({...form,tagline:e.target.value})}/></label><label className="span-2">Genres<input value={form.genres} onChange={e=>setForm({...form,genres:e.target.value})}/></label><label className="span-2">Regisseurs<input value={form.directors} onChange={e=>setForm({...form,directors:e.target.value})}/></label><label className="span-2">Schrijvers<input value={form.writers} onChange={e=>setForm({...form,writers:e.target.value})}/></label><label className="span-2">Cast<input value={form.cast} onChange={e=>setForm({...form,cast:e.target.value})}/></label><label>Première<input type="date" value={form.premiered} onChange={e=>setForm({...form,premiered:e.target.value})}/></label><label>Officiële URL<input type="url" value={form.officialUrl} onChange={e=>setForm({...form,officialUrl:e.target.value})}/></label><label className="span-2">Beschrijving<textarea value={form.overview} onChange={e=>setForm({...form,overview:e.target.value})}/></label></div>}
    {tab==='search'&&<div className="metadata-search"><p>Zoek bij <strong>{provider==='omdb'?'OMDb':'TVmaze'}</strong>. Er wordt nooit automatisch gekozen wanneer resultaten dubbelzinnig zijn.</p><div className="button-row"><button type="button" className="primary" onClick={search}><Icon name="search"/>Andere match kiezen</button><button type="button" className="secondary" onClick={()=>refresh('fill_missing','Ontbrekende velden zijn aangevuld.')}>Alleen ontbrekende velden</button><button type="button" className="secondary" onClick={()=>refresh('refresh','Metadata is vernieuwd; handmatige velden zijn behouden.')}>Alles verversen</button><button type="button" className="secondary" onClick={()=>refresh('images','Afbeeldingen zijn opnieuw gezocht en gecachet.')}>Afbeeldingen zoeken</button><button type="button" className="secondary" onClick={()=>refresh('local','Lokale NFO, artwork en bestandsmetadata zijn opnieuw gelezen.')}>Lokale metadata lezen</button></div><div className="metadata-results">{results.map(result=><article key={result.record.providerId}>{result.posterUrl?<img src={result.posterUrl} alt="" loading="lazy"/>:<div className="metadata-poster-placeholder"><Icon name="movie"/></div>}<span><strong>{result.record.title}</strong><small>{result.record.year||'Jaar onbekend'} · overeenkomst {Math.round(result.score*100)}%</small><small>{[result.record.language,result.record.network,result.record.streamingService].filter(Boolean).join(' · ')||'Taal, zender of dienst onbekend'}</small><small>{result.record.summary||'Geen beschrijving in zoekresultaat.'}</small>{result.record.providerUrl&&<a href={result.record.providerUrl} target="_blank" rel="noreferrer">Bronpagina openen ↗</a>}</span><button type="button" className="primary" onClick={()=>choose(result)}>Kiezen</button></article>)}</div></div>}
    {tab==='artwork'&&<div className="metadata-artwork"><div className="artwork-grid">{status?.images?.map((image:any)=><article className={image.selected?'selected':''} key={image.id}><img src={image.url} alt=""/><span><strong>{image.type}</strong><small>{image.provider}{image.manuallySelected?' · handmatig':''}</small></span><div><button type="button" className="secondary" onClick={async()=>{await put(`/media/${item.id}/metadata/images/${image.id}/select`,{});await loadStatus()}}>Kiezen</button><button type="button" className="text-danger" onClick={async()=>{await api(`/media/${item.id}/metadata/images/${image.id}`,{method:'DELETE'});await loadStatus()}}>Verwijderen</button></div></article>)}</div><div className="image-form"><select value={imageForm.type} onChange={e=>setImageForm({...imageForm,type:e.target.value})}><option value="poster">Poster</option><option value="backdrop">Achtergrond</option><option value="banner">Banner</option><option value="logo">Logo</option><option value="landscape">Liggend</option><option value="episode">Aflevering</option></select><input type="url" value={imageForm.url} placeholder="Openbare HTTPS-afbeeldings-URL" onChange={e=>setImageForm({...imageForm,url:e.target.value})}/><input value={imageForm.localPath} placeholder="Of volledig lokaal pad binnen de bibliotheek" onChange={e=>setImageForm({...imageForm,localPath:e.target.value})}/><button type="button" className="primary" onClick={async()=>{try{await post(`/media/${item.id}/metadata/images`,imageForm);setImageForm({...imageForm,url:'',localPath:''});await loadStatus()}catch(value:any){setError(value.message)}}}>Toevoegen en kiezen</button></div></div>}
    {tab==='history'&&<div className="metadata-history"><h3>Veldherkomst en vergrendeling</h3><div className="field-state-list">{status?.fields?.length?status.fields.map((field:any)=><button type="button" key={field.fieldName} onClick={()=>lock(field)}><span><strong>{field.fieldName}</strong><small>{field.provider} · {field.fetchedAt?new Date(field.fetchedAt).toLocaleString('nl-NL'):'onbekend'}</small></span><em>{field.manuallyModified?'Vergrendeld':'Automatisch'}</em></button>):<p>Nog geen veldherkomst opgeslagen.</p>}</div><h3>Wijzigingshistorie</h3><div className="history-list">{status?.history?.map((entry:any)=><div key={entry.id}><span><strong>{entry.fieldName}</strong><small>{entry.provider} · {new Date(entry.changedAt).toLocaleString('nl-NL')}</small></span><button type="button" className="secondary" onClick={async()=>{await post(`/media/${item.id}/metadata/history/${entry.id}/restore`);await loadStatus()}}>Herstellen</button></div>)}</div></div>}
    {(error||message)&&<div className={`alert ${error?'error':'success'}`}>{error||message}</div>}<footer><button type="button" className="secondary" onClick={onClose}>Sluiten</button>{tab==='edit'&&<button className="primary">Opslaan en vergrendelen</button>}</footer></form></div>
}

function MusicPage({tracks,onPlay}:{tracks:MusicTrack[];onPlay:(track:MusicTrack)=>void}){
  const albums=useMemo(()=>{const map=new Map<string,MusicTrack[]>();for(const track of tracks){const key=`${track.artist}\0${track.album}`;map.set(key,[...(map.get(key)||[]),track])}return [...map.values()]},[tracks]);
  return <section className="library-page"><header className="page-heading"><div><p className="eyebrow">AUDIOBIBLIOTHEEK</p><h1>Muziek</h1></div><span>{tracks.length} nummers · {albums.length} albums</span></header>{albums.length?<div className="album-grid">{albums.map(album=><article className="album-card" key={`${album[0].artist}-${album[0].album}`}><button className="album-cover" onClick={()=>onPlay(album[0])}>{album[0].coverUrl?<img src={album[0].coverUrl} alt=""/>:<div><Icon name="music"/></div>}<span><Icon name="play"/></span></button><strong>{album[0].album}</strong><small>{album[0].artist} · {album.length} nummers</small><div className="track-list">{album.map(track=><button key={track.id} onClick={()=>onPlay(track)}><span>{track.track||'•'}</span><strong>{track.title}</strong><em>{track.duration?formatDuration(track.duration):''}</em></button>)}</div></article>)}</div>:<div className="no-results"><Icon name="music"/><h2>Nog geen muziek</h2><p>Voeg een muziekmap toe bij Instellingen en start een scan.</p></div>}</section>
}

function AudioPlayer({track,onClose,onEnded}:{track:MusicTrack;onClose:()=>void;onEnded:()=>void}){const audio=useRef<HTMLAudioElement>(null);useEffect(()=>{audio.current?.play().catch(()=>{})},[track.id]);return <div className="audio-player">{track.coverUrl?<img src={track.coverUrl} alt=""/>:<div className="audio-cover"><Icon name="music"/></div>}<span><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></span><audio ref={audio} src={`/api/music/${track.id}/stream`} controls autoPlay onEnded={onEnded}/><a href={`/api/music/${track.id}/download`} title="Download"><Icon name="download"/></a><button onClick={onClose}><Icon name="close"/></button></div>}

function PhotosPage({photos}:{photos:PhotoItem[]}){const[selected,setSelected]=useState<PhotoItem|null>(null);return <section className="library-page"><header className="page-heading"><div><p className="eyebrow">FOTOBIBLIOTHEEK</p><h1>Foto’s</h1></div><span>{photos.length} foto’s</span></header>{photos.length?<div className="photo-grid">{photos.map(photo=><button key={photo.id} onClick={()=>setSelected(photo)}><img src={photo.thumbnailUrl} alt={photo.title} loading="lazy"/><span>{photo.title}</span></button>)}</div>:<div className="no-results"><Icon name="photos"/><h2>Nog geen foto’s</h2><p>Voeg een fotomap toe bij Instellingen en start een scan.</p></div>}{selected&&<div className="photo-viewer" onClick={()=>setSelected(null)}><button className="icon-button"><Icon name="close"/></button><img src={selected.originalUrl} alt={selected.title}/><span>{selected.title}{selected.takenAt?` · ${new Date(selected.takenAt).toLocaleDateString('nl-NL')}`:''}</span></div>}</section>}

function LiveTvPage(){
  const[channels,setChannels]=useState<any[]>([]);const[guide,setGuide]=useState<any[]>([]);const[recordings,setRecordings]=useState<any[]>([]);const[selected,setSelected]=useState<any>(null);const videoRef=useRef<HTMLVideoElement>(null);const hls=useRef<Hls|null>(null);
  const load=useCallback(async()=>{const[c,g,r]=await Promise.all([api<any[]>('/tv/channels'),api<any[]>('/tv/guide'),api<any[]>('/tv/recordings')]);setChannels(c);setGuide(g);setRecordings(r);setSelected((old:any)=>old||c[0]||null)},[]);useEffect(()=>{void load()},[]);
  useEffect(()=>{if(!selected||!videoRef.current)return;hls.current?.destroy();const src=`/api/tv/channels/${selected.id}/hls/index.m3u8`;if(Hls.isSupported()){const player=new Hls();hls.current=player;player.loadSource(src);player.attachMedia(videoRef.current);player.on(Hls.Events.MANIFEST_PARSED,()=>videoRef.current?.play().catch(()=>{}))}else videoRef.current.src=src;return()=>hls.current?.destroy()},[selected?.id]);
  const grouped=useMemo(()=>new Map(channels.map(c=>[c.id,guide.filter(p=>p.channelId===c.id)])),[channels,guide]);
  return <section className="library-page live-page"><header className="page-heading"><div><p className="eyebrow">LIVE TV & DVR</p><h1>Televisie</h1></div><span>{channels.length} zenders · {recordings.filter(x=>x.status==='scheduled'||x.status==='recording').length} opnames gepland</span></header>{channels.length?<><div className="live-layout"><aside>{channels.map(channel=><button className={selected?.id===channel.id?'active':''} key={channel.id} onClick={()=>setSelected(channel)}>{channel.logoUrl?<img src={channel.logoUrl} alt=""/>:<span>{channel.channelNumber||'TV'}</span>}<div><strong>{channel.name}</strong><small>{channel.nowTitle||'Live'}</small></div></button>)}</aside><div className="live-player"><video ref={videoRef} controls autoPlay/><div><strong>{selected?.name}</strong><span className="live-dot">● LIVE</span></div></div></div><div className="guide"><h2>Programmagids</h2>{channels.map(channel=><div className="guide-row" key={channel.id}><strong>{channel.name}</strong><div>{(grouped.get(channel.id)||[]).map(program=><article key={program.id}><time>{new Date(program.startTime).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}</time><span><b>{program.title}</b><small>{program.description}</small></span><button disabled={Boolean(program.scheduled)} onClick={async()=>{await post('/tv/recordings',{programId:program.id});await load()}}>{program.scheduled?'Gepland':'Opnemen'}</button></article>)}</div></div>)}</div></>:<div className="no-results"><Icon name="live"/><h2>Nog geen tv-bron</h2><p>Voeg bij Instellingen een M3U-playlist en optioneel XMLTV-gids toe.</p></div>}</section>
}

function FolderPicker({ value, onChoose, onClose }: { value: string; onChoose: (path: string) => void; onClose: () => void }) {
  const [state, setState] = useState<{ current: string; parent: string | null; folders: { name: string; path: string }[] }>({ current: '', parent: null, folders: [] });
  const [error, setError] = useState('');
  const load = useCallback(async (path = '') => { try { setState(await api(`/folders?path=${encodeURIComponent(path)}`)); setError(''); } catch(e:any) { setError(e.message); } }, []);
  useEffect(() => { void load(value); }, []);
  return <div className="modal-layer"><section className="folder-modal"><header><div><p className="eyebrow">MAP KIEZEN</p><h2>{state.current || 'Deze pc'}</h2></div><button className="icon-button" onClick={onClose}><Icon name="close" /></button></header>
    <div className="folder-list">{state.parent !== null && <button onClick={() => load(state.parent || '')}><span className="folder-icon">↰</span><strong>Een niveau omhoog</strong></button>}{state.folders.map(folder => <button key={folder.path} onClick={() => load(folder.path)}><Icon name="folder" /><span>{folder.name}</span></button>)}</div>
    {error && <div className="alert error">{error}</div>}
    <footer><button className="secondary" onClick={onClose}>Annuleren</button><button className="primary" disabled={!state.current} onClick={() => onChoose(state.current)}>Deze map gebruiken</button></footer>
  </section></div>;
}

function TvNetworkSettingsPanel({settings,reload}:{settings:Settings;reload:()=>Promise<void>}){
  const[state,setState]=useState({localStreamingEnabled:settings.localStreamingEnabled,localStreamingAddress:settings.localStreamingAddress,localStreamingPort:settings.localStreamingPort,automaticDeviceDiscovery:settings.automaticDeviceDiscovery,dlnaDiscoveryEnabled:settings.dlnaDiscoveryEnabled,deviceRetentionDays:settings.deviceRetentionDays,castReceiverAppId:settings.castReceiverAppId,defaultQualityLan:settings.defaultQualityLan,defaultQualityTailscale:settings.defaultQualityTailscale,defaultQualityMobile:settings.defaultQualityMobile,defaultQualityDownload:settings.defaultQualityDownload,defaultQualityLiveTv:settings.defaultQualityLiveTv});
  const[addresses,setAddresses]=useState<string[]>([]);const[diagnostics,setDiagnostics]=useState<any>(null);const[busy,setBusy]=useState(false);const[notice,setNotice]=useState('');const[error,setError]=useState('');
  const[cast,setCast]=useState(describeCastEnvironment);
  const load=useCallback(async()=>{const[network,status]=await Promise.all([api<any>('/network/interfaces'),api<any>('/playback-devices/diagnostics')]);setAddresses(network.addresses||[]);setDiagnostics(status)},[]);
  useEffect(()=>{void load().catch(caught=>setError(caught.message))},[load]);
  useEffect(()=>{const update=()=>setCast(describeCastEnvironment());window.addEventListener('thuishub-cast-ready',update);update();return()=>window.removeEventListener('thuishub-cast-ready',update)},[]);
  const save=async()=>{setBusy(true);setError('');setNotice('');try{await patch('/settings',state);await reload();await load();setNotice('Netwerk- en tv-instellingen opgeslagen. Herstart ThuisHub wanneer adres, poort of discovery is gewijzigd.')}catch(caught:any){setError(caught.message)}finally{setBusy(false)}};
  const scan=async()=>{setBusy(true);setError('');setNotice('');try{await post('/playback-devices/discover',{});await load();setNotice('Automatisch zoeken is afgerond.')}catch(caught:any){setError(caught.message)}finally{setBusy(false)}};
  const qualities=[['auto','Automatisch'],['original','Origineel'],['4k-max','4K Maximum · 80 Mbps'],['4k-high','4K Hoog · 40 Mbps'],['4k-balanced','4K Gebalanceerd · 25 Mbps'],['1080p-max','1080p Maximum · 20 Mbps'],['1080p-high','1080p Hoog · 12 Mbps'],['1080p-balanced','1080p Gebalanceerd · 8 Mbps'],['720p','720p · 4 Mbps'],['data-saver','Databesparing · 2 Mbps']];
  const firewallCommand=state.localStreamingAddress?`.\\scripts\\configure-private-streaming.ps1 -Action enable -Address ${state.localStreamingAddress} -Port ${state.localStreamingPort}`:'.\\scripts\\configure-private-streaming.ps1 -Action enable -Address <kies-eerst-een-adres> -Port 8788';
  return <section className="panel span-2 tv-network-settings"><div className="panel-heading"><div><h2>Netwerk en tv-streaming</h2><p>Apparaten worden automatisch gevonden; een tv-IP of Chromecast-ID invoeren is niet nodig.</p></div><span className="premium-badge">PRIVÉ-LAN</span></div>
    {(notice||error)&&<div className={`alert ${error?'error':'success'}`} role={error?'alert':'status'}>{error||notice}</div>}
    <div className="toggle-grid"><label><input type="checkbox" checked={state.localStreamingEnabled} onChange={event=>setState({...state,localStreamingEnabled:event.target.checked})}/><span><strong>Streamen binnen thuisnetwerk</strong><small>Tijdelijke ondertekende links; geen routerpoorten</small></span></label><label><input type="checkbox" checked={state.automaticDeviceDiscovery} onChange={event=>setState({...state,automaticDeviceDiscovery:event.target.checked})}/><span><strong>Automatisch apparaten zoeken</strong><small>Bij starten, netwerkverandering en openen van de kiezer</small></span></label><label><input type="checkbox" checked={state.dlnaDiscoveryEnabled} onChange={event=>setState({...state,dlnaDiscoveryEnabled:event.target.checked})}/><span><strong>DLNA en smart-tv's zoeken</strong><small>Alleen MediaRenderers op het gekozen privé-netwerk</small></span></label></div>
    <div className="tv-status-grid" aria-live="polite"><span><small>Google Cast</small><strong>{cast.available?'Beschikbaar':cast.message}</strong></span><span><small>DLNA en smart-tv's</small><strong>{diagnostics?`${diagnostics.counts?.dlna||0} gevonden`:'Controleren…'}</strong></span><span><small>Gekoppelde ThuisHub-apps</small><strong>{diagnostics?.counts?.pairedApps||0}</strong></span><span><small>Lokale streamserver</small><strong>{diagnostics?.streaming?.listening?`Actief op ${diagnostics.streaming.address}:${diagnostics.streaming.port}`:'Niet actief'}</strong></span></div>
    <div className="advanced-fields"><label>Privé-LAN-adres<select value={state.localStreamingAddress} onChange={event=>setState({...state,localStreamingAddress:event.target.value})}><option value="">Selecteer adres</option>{addresses.map(address=><option key={address}>{address}</option>)}</select></label><label>Streamingpoort<input type="number" min="1024" max="65535" value={state.localStreamingPort} onChange={event=>setState({...state,localStreamingPort:Number(event.target.value)})}/></label><label>Gevonden apparaten bewaren (dagen)<input type="number" min="1" max="365" value={state.deviceRetentionDays} onChange={event=>setState({...state,deviceRetentionDays:Number(event.target.value)})}/></label>{([['defaultQualityLan','Thuisnetwerk'],['defaultQualityTailscale','Tailscale'],['defaultQualityMobile','Mobiel internet'],['defaultQualityDownload','Downloads'],['defaultQualityLiveTv','Live TV']] as const).map(([key,label])=><label key={key}>Standaardkwaliteit {label}<select value={state[key]} onChange={event=>setState({...state,[key]:event.target.value})}>{qualities.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>)}</div>
    <div className="button-row"><button className="primary" disabled={busy} onClick={()=>void save()}>Opslaan</button><button className="secondary" disabled={busy} onClick={()=>void scan()}>{busy?'Bezig…':'Opnieuw zoeken'}</button><button className="secondary" onClick={()=>{location.href='/?view=dashboard&section=devices'}}>Problemen oplossen</button></div>
    <details className="developer-options"><summary>Geavanceerd · Ontwikkelaarsopties</summary><label>Google Cast Receiver App ID<input value={state.castReceiverAppId} onChange={event=>setState({...state,castReceiverAppId:event.target.value.toUpperCase()})} placeholder="Leeg = standaard Google Media Receiver"/></label><p>Alleen nodig voor een aangepaste ThuisHub Cast Receiver. Laat leeg om de standaard Google Media Receiver te gebruiken.</p></details>
    <p className="dashboard-note">Voer daarna bewust als administrator <code>{firewallCommand}</code> uit. De regels gelden uitsluitend voor profiel Privé, LocalSubnet en het gekozen lokale adres.</p>
  </section>;
}

function SettingsPanel({ bootstrap, reload, refreshLibrary }: { bootstrap: Bootstrap; reload: () => Promise<void>; refreshLibrary: () => Promise<void> }) {
  const [serverName, setServerName] = useState(bootstrap.settings.serverName);
  const [sourceForm, setSourceForm] = useState({ name: '', path: '', kind: 'movies' as 'movies'|'series' });
  const [picker, setPicker] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [userForm, setUserForm] = useState({ username: '', password: '' });
  const [advanced,setAdvanced]=useState({autoplay:bootstrap.settings.autoplay,rewindOnResume:bootstrap.settings.rewindOnResume,skipIntro:bootstrap.settings.skipIntro,skipCredits:bootstrap.settings.skipCredits,hardwareTranscoding:bootstrap.settings.hardwareTranscoding,toneMapping:bootstrap.settings.toneMapping,maxTranscodes:bootstrap.settings.maxTranscodes,uploadLimitMbps:bootstrap.settings.uploadLimitMbps});
  const [dashboard,setDashboard]=useState<any>(null);
  const [webhooks,setWebhooks]=useState<any[]>([]);
  const [hookUrl,setHookUrl]=useState('');
  const [playlists,setPlaylists]=useState<any[]>([]);
  const [playlistName,setPlaylistName]=useState('');
  const [collections,setCollections]=useState<any[]>([]);
  const [collectionName,setCollectionName]=useState('');
  const [extraSources,setExtraSources]=useState<any[]>([]);
  const [extraForm,setExtraForm]=useState({name:'',path:'',kind:'music' as 'music'|'photos'});
  const [extraPicker,setExtraPicker]=useState(false);
  const [tvSources,setTvSources]=useState<any[]>([]);
  const [tvForm,setTvForm]=useState({name:'',playlistUrl:'',xmltvUrl:'',recordingPath:''});
  const [tvPicker,setTvPicker]=useState(false);
  const isAdmin = bootstrap.user.role === 'admin';
  useEffect(() => { if (isAdmin) void Promise.all([api<User[]>('/users').then(setUsers),api('/dashboard').then(setDashboard),api<any[]>('/webhooks').then(setWebhooks),api<any[]>('/extra-sources').then(setExtraSources),api<any[]>('/tv/sources').then(setTvSources)]);void api<any[]>('/playlists').then(setPlaylists);void api<any[]>('/collections').then(setCollections); }, [isAdmin]);
  async function act(fn: () => Promise<any>, success: string) { setError(''); setMessage(''); try { await fn(); setMessage(success); await reload(); } catch(e:any) { setError(e.message); } }
  async function addSource(e: React.FormEvent) { e.preventDefault(); await act(() => post('/sources', sourceForm), 'Bibliotheek toegevoegd. Start nu een scan.'); setSourceForm({ name:'', path:'', kind:'movies' }); }
  async function startScan() { await act(() => post('/scan'), 'De scan is gestart.'); }
  if (!isAdmin) return <section className="settings-page"><h1>Instellingen</h1><div className="panel"><p>Alleen de beheerder kan bibliotheken en gebruikers aanpassen.</p></div></section>;
  return <section className="settings-page">
    <header className="page-heading"><div><p className="eyebrow">BEHEER</p><h1>Instellingen</h1></div></header>
    {(message || error) && <div className={`alert ${error ? 'error' : 'success'}`}>{error || message}</div>}
    <div className="settings-grid">
      <section className="panel span-2"><div className="panel-heading"><div><h2>Mediabibliotheken</h2><p>Mappen waarin je films en series staan.</p></div><button className="secondary" disabled={bootstrap.scan.running} onClick={startScan}><Icon name="refresh" /> {bootstrap.scan.running ? `${bootstrap.scan.scanned}/${bootstrap.scan.total || '?'}` : 'Alles scannen'}</button></div>
        <div className="source-list">{bootstrap.sources.length ? bootstrap.sources.map(source => <div className="source" key={source.id}><div className="source-icon"><Icon name={source.kind === 'movies' ? 'movie' : 'series'} /></div><div><strong>{source.name}</strong><span>{source.path}</span></div><em>{source.kind === 'movies' ? 'Films' : 'Series'}</em><button className="text-danger" onClick={() => act(() => api(`/sources/${source.id}`, {method:'DELETE'}), 'Bibliotheek verwijderd.')}>Verwijder</button></div>) : <p className="empty-inline">Nog geen mappen toegevoegd.</p>}</div>
        <form className="source-form" onSubmit={addSource}><input required placeholder="Naam, bijvoorbeeld Films" value={sourceForm.name} onChange={e => setSourceForm({...sourceForm,name:e.target.value})}/><select value={sourceForm.kind} onChange={e=>setSourceForm({...sourceForm,kind:e.target.value as any})}><option value="movies">Films</option><option value="series">Series</option></select><div className="path-input"><input required placeholder="C:\Media\Films" value={sourceForm.path} onChange={e=>setSourceForm({...sourceForm,path:e.target.value})}/><button type="button" className="small-button" onClick={()=>setPicker(true)}><Icon name="folder" /></button></div><button className="primary">Toevoegen</button></form>
      </section>
      <section className="panel span-2"><div className="panel-heading"><div><h2>Muziek- en fotobibliotheken</h2><p>ID3-tags, albumhoezen en fotominiaturen worden automatisch ingelezen.</p></div></div><div className="source-list">{extraSources.length?extraSources.map(source=><div className="source" key={source.id}><div className="source-icon"><Icon name={source.kind==='music'?'music':'photos'}/></div><div><strong>{source.name}</strong><span>{source.path}</span></div><em>{source.kind==='music'?'Muziek':'Foto’s'}</em><button className="text-danger" onClick={async()=>{await api(`/extra-sources/${String(source.id).replace('extra-','')}`,{method:'DELETE'});setExtraSources(extraSources.filter(x=>x.id!==source.id))}}>Verwijder</button></div>):<p className="empty-inline">Nog geen muziek- of fotomappen toegevoegd.</p>}</div><form className="source-form" onSubmit={async e=>{e.preventDefault();const source=await post<any>('/extra-sources',extraForm);setExtraSources([...extraSources,source]);setExtraForm({name:'',path:'',kind:'music'})}}><input required placeholder="Naam, bijvoorbeeld Muziek" value={extraForm.name} onChange={e=>setExtraForm({...extraForm,name:e.target.value})}/><select value={extraForm.kind} onChange={e=>setExtraForm({...extraForm,kind:e.target.value as any})}><option value="music">Muziek</option><option value="photos">Foto’s</option></select><div className="path-input"><input required placeholder="C:\Media\Muziek" value={extraForm.path} onChange={e=>setExtraForm({...extraForm,path:e.target.value})}/><button type="button" className="small-button" onClick={()=>setExtraPicker(true)}><Icon name="folder"/></button></div><button className="primary">Toevoegen</button></form></section>
      <section className="panel span-2"><div className="panel-heading"><div><h2>Live TV & DVR</h2><p>Koppel een eigen tunerapparaat of legale M3U-playlist met optioneel een XMLTV-programmagids.</p></div><span className="premium-badge">DVR</span></div><div className="source-list">{tvSources.length?tvSources.map(source=><div className="source" key={source.id}><div className="source-icon"><Icon name="live"/></div><div><strong>{source.name}</strong><span>{source.playlistUrl}</span></div><button className="secondary" onClick={()=>post(`/tv/sources/${source.id}/refresh`)}>Gids verversen</button><button className="text-danger" onClick={async()=>{await api(`/tv/sources/${source.id}`,{method:'DELETE'});setTvSources(tvSources.filter(x=>x.id!==source.id))}}>Verwijder</button></div>):<p className="empty-inline">Nog geen tv-bron gekoppeld.</p>}</div><form className="tv-form" onSubmit={async e=>{e.preventDefault();const source=await post<any>('/tv/sources',tvForm);setTvSources([...tvSources,source]);setTvForm({name:'',playlistUrl:'',xmltvUrl:'',recordingPath:''})}}><input required placeholder="Naam van tv-bron" value={tvForm.name} onChange={e=>setTvForm({...tvForm,name:e.target.value})}/><input required placeholder="M3U-URL of lokaal .m3u-bestand" value={tvForm.playlistUrl} onChange={e=>setTvForm({...tvForm,playlistUrl:e.target.value})}/><input placeholder="XMLTV-URL of lokaal .xml-bestand (optioneel)" value={tvForm.xmltvUrl} onChange={e=>setTvForm({...tvForm,xmltvUrl:e.target.value})}/><div className="path-input"><input required placeholder="Map voor tv-opnames" value={tvForm.recordingPath} onChange={e=>setTvForm({...tvForm,recordingPath:e.target.value})}/><button type="button" className="small-button" onClick={()=>setTvPicker(true)}><Icon name="folder"/></button></div><button className="primary">TV-bron koppelen</button></form></section>
      <section className="panel"><h2>Server</h2><p>ThuisHub {bootstrap.settings.version} · lokaal beveiligd op deze pc.</p><label>Servernaam<input value={serverName} onChange={e=>setServerName(e.target.value)}/></label><button className="primary" onClick={()=>act(()=>patch('/settings',{serverName}), 'Servernaam opgeslagen.')}>Opslaan</button>
        {bootstrap.networkUrls.length > 0 && <div className="network-box"><strong>Lokale toegang</strong><span>Voor toegang buitenshuis gebruik je Tailscale Serve:</span>{bootstrap.networkUrls.map(url=><code key={url}>{url}</code>)}</div>}
      </section>
      <MetadataSettings/>
      <section className="panel span-2"><div className="panel-heading"><div><h2>Geavanceerd afspelen</h2><p>Hardware-transcoding, HDR en automatisch doorspelen.</p></div><span className="premium-badge">LOKAAL BESCHIKBAAR</span></div><div className="toggle-grid"><label><input type="checkbox" checked={advanced.autoplay} onChange={e=>setAdvanced({...advanced,autoplay:e.target.checked})}/><span><strong>Autoplay</strong><small>Speel de volgende aflevering automatisch</small></span></label><label><input type="checkbox" checked={advanced.skipIntro} onChange={e=>setAdvanced({...advanced,skipIntro:e.target.checked})}/><span><strong>Intro overslaan</strong><small>Toon de knop binnen een intromarker</small></span></label><label><input type="checkbox" checked={advanced.skipCredits} onChange={e=>setAdvanced({...advanced,skipCredits:e.target.checked})}/><span><strong>Credits overslaan</strong><small>Ga sneller naar de volgende aflevering</small></span></label><label><input type="checkbox" checked={advanced.toneMapping} onChange={e=>setAdvanced({...advanced,toneMapping:e.target.checked})}/><span><strong>HDR-tone-mapping</strong><small>Correcte kleuren op SDR-schermen</small></span></label></div><div className="advanced-fields"><label>Transcoder<select value={advanced.hardwareTranscoding} onChange={e=>setAdvanced({...advanced,hardwareTranscoding:e.target.value})}><option value="auto">Automatisch (aanbevolen)</option><option value="nvidia">NVIDIA NVENC</option><option value="amd">AMD AMF</option><option value="intel">Intel Quick Sync</option><option value="software">Alleen processor</option></select></label><label>Terugspoelen bij hervatten<input type="number" min="0" max="30" value={advanced.rewindOnResume} onChange={e=>setAdvanced({...advanced,rewindOnResume:Number(e.target.value)})}/></label><label>Max. gelijktijdige transcodes<input type="number" min="1" max="10" value={advanced.maxTranscodes} onChange={e=>setAdvanced({...advanced,maxTranscodes:Number(e.target.value)})}/></label><label>Uploadlimiet (Mbps, 0 = onbeperkt)<input type="number" min="0" value={advanced.uploadLimitMbps} onChange={e=>setAdvanced({...advanced,uploadLimitMbps:Number(e.target.value)})}/></label></div><button className="primary" onClick={()=>act(()=>patch('/settings',advanced),'Afspeelinstellingen opgeslagen.')}>Instellingen opslaan</button></section>
      <TvNetworkSettingsPanel settings={bootstrap.settings} reload={reload}/>
      <section className="panel"><h2>Playlists</h2><p>Maak afspeellijsten en voeg media toe vanaf een detailpagina.</p><div className="compact-list">{playlists.map(p=><span key={p.id}><strong>{p.name}</strong><small>{p.itemCount} items</small></span>)}</div><form className="inline-form" onSubmit={async e=>{e.preventDefault();const p=await post<any>('/playlists',{name:playlistName});setPlaylists([...playlists,p]);setPlaylistName('')}}><input required placeholder="Nieuwe playlist" value={playlistName} onChange={e=>setPlaylistName(e.target.value)}/><button className="primary"><Icon name="plus"/></button></form></section>
      <section className="panel"><h2>Collecties</h2><p>Groepeer films en series in eigen verzamelingen.</p><div className="compact-list">{collections.map(c=><span key={c.id}><strong>{c.name}</strong><small>{c.itemCount} items</small></span>)}</div><form className="inline-form" onSubmit={async e=>{e.preventDefault();const c=await post<any>('/collections',{name:collectionName});setCollections([...collections,c]);setCollectionName('')}}><input required placeholder="Nieuwe collectie" value={collectionName} onChange={e=>setCollectionName(e.target.value)}/><button className="primary"><Icon name="plus"/></button></form></section>
      <section className="panel span-2"><h2>Gebruikers</h2><p>Ieder profiel houdt zijn eigen kijkvoortgang bij.</p><div className="user-chips">{users.map(user=><span key={user.id}>{user.username}<small>{user.role === 'admin' ? 'Beheerder' : 'Gebruiker'}</small></span>)}</div><form className="user-form" onSubmit={e=>{e.preventDefault(); act(()=>post<User>('/users',userForm).then(u=>setUsers([...users,u])), 'Gebruiker toegevoegd.'); setUserForm({username:'',password:''});}}><input required placeholder="Gebruikersnaam" value={userForm.username} onChange={e=>setUserForm({...userForm,username:e.target.value})}/><input required type="password" placeholder="Wachtwoord (min. 8 tekens)" value={userForm.password} onChange={e=>setUserForm({...userForm,password:e.target.value})}/><button className="primary">Gebruiker toevoegen</button></form></section>
      {dashboard&&<section className="panel span-2"><div className="panel-heading"><div><h2>Serverdashboard</h2><p>Live status, GPU en achtergrondtaken.</p></div><button className="secondary" onClick={()=>api('/dashboard').then(setDashboard)}><Icon name="refresh"/>Vernieuwen</button></div><div className="stat-grid"><span><strong>{dashboard.stats.items}</strong><small>Mediabestanden</small></span><span><strong>{(dashboard.stats.bytes/1073741824).toFixed(1)} GB</strong><small>Bibliotheekgrootte</small></span><span><strong>{dashboard.activity.length}</strong><small>Actieve streams</small></span><span><strong>{dashboard.encoder.hardware?'GPU':'CPU'}</strong><small>{dashboard.encoder.codec}</small></span></div><div className="dashboard-columns"><div><h3>Videokaarten</h3>{dashboard.gpus.map((gpu:string)=><code key={gpu}>{gpu}</code>)}</div><div><h3>Optimalisaties</h3>{dashboard.optimizations.length?dashboard.optimizations.slice(0,5).map((o:any)=><div className="job" key={o.id}><span>{o.seriesTitle||o.title} · {o.profile}</span><em>{o.status==='ready'?'Gereed':o.status==='error'?'Fout':`${Math.round(o.progress)}%`}</em></div>):<small>Geen achtergrondtaken.</small>}</div></div></section>}
      <section className="panel span-2"><h2>Webhooks</h2><p>Stuur gebeurtenissen naar Home Assistant, Discord of een eigen automatisering.</p><div className="source-list">{webhooks.map(h=><div className="source" key={h.id}><div className="source-icon">↗</div><div><strong>{h.url}</strong><span>{h.events}</span></div><button className="text-danger" onClick={async()=>{await api(`/webhooks/${h.id}`,{method:'DELETE'});setWebhooks(webhooks.filter(x=>x.id!==h.id))}}>Verwijder</button></div>)}</div><form className="inline-form wide-form" onSubmit={async e=>{e.preventDefault();const h=await post<any>('/webhooks',{url:hookUrl});setWebhooks([...webhooks,h]);setHookUrl('')}}><input type="url" required placeholder="https://jouw-server/webhook" value={hookUrl} onChange={e=>setHookUrl(e.target.value)}/><button className="primary">Toevoegen</button></form></section>
    </div>
    {picker && <FolderPicker value={sourceForm.path} onClose={()=>setPicker(false)} onChoose={path=>{setSourceForm({...sourceForm,path});setPicker(false);}}/>}
    {extraPicker&&<FolderPicker value={extraForm.path} onClose={()=>setExtraPicker(false)} onChoose={path=>{setExtraForm({...extraForm,path});setExtraPicker(false)}}/>}
    {tvPicker&&<FolderPicker value={tvForm.recordingPath} onClose={()=>setTvPicker(false)} onChoose={recordingPath=>{setTvForm({...tvForm,recordingPath});setTvPicker(false)}}/>}
  </section>;
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const initialView=(new URLSearchParams(location.search).get('view')||'home') as View;
  const [view, setView] = useState<View>(['home','movies','series','music','photos','live','continue','watchlist','downloads','devices','dashboard','settings'].includes(initialView)?initialView:'home');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ item: MediaItem; episodes?: MediaItem[] } | null>(null);
  const [playing, setPlaying] = useState<MediaItem | null>(null);
  const [playlists,setPlaylists]=useState<{id:number;name:string;itemCount:number}[]>([]);
  const [editor,setEditor]=useState<MediaItem|null>(null);
  const [notice,setNotice]=useState('');
  const [music,setMusic]=useState<MusicTrack[]>([]);
  const [photos,setPhotos]=useState<PhotoItem[]>([]);
  const [audioTrack,setAudioTrack]=useState<MusicTrack|null>(null);
  const [loadError, setLoadError] = useState('');
  const [heroIndex,setHeroIndex]=useState(0);
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const [systemOpen,setSystemOpen]=useState(false);
  const initialSection=new URLSearchParams(location.search).get('section')||'overview';
  const [dashboardSection,setDashboardSection]=useState(initialView==='devices'?'devices':initialSection);
  const systemStatus=useSystemStatus(Boolean(bootstrap?.user.role==='admin'));

  const loadBootstrap = useCallback(async () => { const data = await api<Bootstrap>('/bootstrap'); setBootstrap(data); }, []);
  const loadLibrary = useCallback(async () => { const data = await api<MediaItem[]>('/library'); setLibrary(data); }, []);
  const loadPlaylists=useCallback(async()=>setPlaylists(await api('/playlists')),[]);
  const loadExtras=useCallback(async()=>{const[tracks,pictures]=await Promise.all([api<MusicTrack[]>('/music'),api<PhotoItem[]>('/photos')]);setMusic(tracks);setPhotos(pictures)},[]);
  const initialize = useCallback(async () => { try { setLoadError(''); await Promise.all([loadBootstrap(),loadLibrary(),loadPlaylists(),loadExtras()]); } catch(e:any) { setLoadError(e.message || 'ThuisHub kon niet worden geladen.'); } }, [loadBootstrap,loadLibrary,loadPlaylists,loadExtras]);

  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    if (!bootstrap?.scan.running) return;
    const timer = setInterval(async()=>{ const scan=await api<ScanState>('/scan'); setBootstrap(b=>b?{...b,scan}:b); if(!scan.running){clearInterval(timer);await loadLibrary();}},1200);
    return()=>clearInterval(timer);
  },[bootstrap?.scan.running]);

  const movies = useMemo(()=>library.filter(x=>x.kind==='movie'),[library]);
  const series = useMemo(()=>{
    const groups = new Map<string,MediaItem[]>();
    for(const item of library.filter(x=>x.kind==='episode')) { const key=item.seriesTitle||'Onbekende serie'; groups.set(key,[...(groups.get(key)||[]),item]); }
    return [...groups.entries()].map(([title,episodes])=>({title,episodes:episodes.sort((a,b)=>(a.season||0)-(b.season||0)||(a.episode||0)-(b.episode||0)),item:{...episodes[0],title,seriesTitle:title}}));
  },[library]);
  const query=search.toLocaleLowerCase('nl');
  const filteredMovies=movies.filter(x=>x.title.toLocaleLowerCase('nl').includes(query));
  const filteredSeries=series.filter(x=>x.title.toLocaleLowerCase('nl').includes(query));
  const continueItems=library.filter(x=>x.progress?.position && !x.progress.completed).sort((a,b)=>(b.progress?.position||0)-(a.progress?.position||0)).slice(0,12);
  const watchlistItems=library.filter(x=>x.state?.watchlist);
  const recentItems=(()=>{const result:MediaItem[]=[];const seen=new Set<string>();for(const item of [...library].sort((a,b)=>new Date(b.createdAt||0).getTime()-new Date(a.createdAt||0).getTime())){const key=item.kind==='episode'&&item.seriesTitle?`series:${item.seriesTitle}`:`media:${item.id}`;if(seen.has(key))continue;seen.add(key);result.push(item.kind==='episode'&&item.seriesTitle?series.find(group=>group.title===item.seriesTitle)?.item||item:item);if(result.length===12)break}return result})();
  const recommendedItems=[...movies.filter(item=>!item.state?.watched),...series.map(group=>group.item)].slice(0,12);
  const heroItems=useMemo(()=>{
    const result:MediaItem[]=[];const seen=new Set<string>();
    for(const item of [...continueItems,...movies,...series.map(group=>group.item)]){const key=item.kind==='episode'&&item.seriesTitle?`series:${item.seriesTitle}`:`media:${item.id}`;if(seen.has(key)||(!item.backdropUrl&&!item.posterUrl))continue;seen.add(key);result.push(item);if(result.length===5)break}
    return result;
  },[library,series]);
  const hero=heroItems.length?heroItems[heroIndex%heroItems.length]:undefined;
  const openItem=(item:MediaItem)=>{if(item.kind==='episode'&&item.seriesTitle){const group=series.find(x=>x.title===item.seriesTitle);setSelected({item:group?.item||item,episodes:group?.episodes});}else setSelected({item});};
  const updateProgress=useCallback((id:number,progress:MediaItem['progress'])=>setLibrary(items=>items.map(x=>x.id===id?{...x,progress}:x)),[]);
  const updateMediaState=useCallback(async(id:number,state:Partial<MediaItem['state']>)=>{const updated=await put<MediaItem['state']>(`/media/${id}/state`,state);setLibrary(items=>items.map(x=>x.id===id?{...x,state:updated}:x));setSelected(current=>current?{...current,item:current.item.id===id?{...current.item,state:updated}:current.item,episodes:current.episodes?.map(x=>x.id===id?{...x,state:updated}:x)}:current);},[]);
  const saveEdited=useCallback((updated:MediaItem)=>{setLibrary(items=>items.map(x=>x.id===updated.id?updated:x));setSelected(current=>current?{...current,item:current.item.id===updated.id?updated:current.item}:current);},[]);
  const nextItem=useMemo(()=>{if(!playing)return null;if(playing.kind==='episode'&&playing.seriesTitle){const eps=series.find(x=>x.title===playing.seriesTitle)?.episodes||[];const index=eps.findIndex(x=>x.id===playing.id);return index>=0?eps[index+1]||null:null;}return null;},[playing,series]);
  useEffect(()=>{if(heroItems.length<2)return;const timer=window.setInterval(()=>setHeroIndex(index=>(index+1)%heroItems.length),9000);return()=>window.clearInterval(timer)},[heroItems.length]);

  if(!bootstrap) return <div className="splash"><img className="splash-logo" src="/brand/thuishub-icon-256.png" alt="ThuisHub"/>{loadError?<><div className="alert error">{loadError}</div><button className="primary" onClick={()=>void initialize()}>Opnieuw proberen</button></>:<span className="spinner" />}</div>;

  const nav=(next:View)=>{const section=next==='devices'?'devices':next==='dashboard'?'overview':dashboardSection;if(next==='devices'||next==='dashboard')setDashboardSection(section);setView(next);setSearch('');setSidebarOpen(false);const params=new URLSearchParams({view:next});if(next==='devices'||next==='dashboard')params.set('section',section);history.replaceState(null,'',`/?${params}`);window.scrollTo(0,0);};
  const openDashboardSection=(section:string)=>{setDashboardSection(section);setView(section==='devices'?'devices':'dashboard');setSystemOpen(false);history.replaceState(null,'',`/?view=dashboard&section=${encodeURIComponent(section)}`);window.scrollTo(0,0)};
  const libraryTabs=<LibraryTabs view={view} onNavigate={nav}/>;
  return <PlaybackDeviceProvider settings={bootstrap.settings} onPlayLocal={item=>{setSelected(null);setPlaying(item);}}><AppShell
    sidebar={<Sidebar view={view} serverName={bootstrap.settings.serverName} isAdmin={bootstrap.user.role==='admin'} open={sidebarOpen} onNavigate={nav} onClose={()=>setSidebarOpen(false)}/>}
    topbar={<TopBar query={search} onQuery={setSearch} library={library} onSelect={openItem} user={bootstrap.user} scan={bootstrap.scan} onMenu={()=>setSidebarOpen(true)} systemOpen={systemOpen} onToggleSystem={()=>setSystemOpen(open=>!open)}/>}
    status={bootstrap.user.role==='admin'?<SystemStatusPanel data={systemStatus.data} error={systemStatus.error} history={systemStatus.history} settings={bootstrap.settings} open={systemOpen} onClose={()=>setSystemOpen(false)} onOpenSection={openDashboardSection}/>:null}
    bottom={<BottomStatusBar data={systemStatus.data} history={systemStatus.history}/>}
  >
    {view==='home'&&<>
      {hero&&<HeroBanner item={hero} index={heroIndex%heroItems.length} total={heroItems.length} onIndex={setHeroIndex} onPlay={()=>setPlaying(hero)} onInfo={()=>openItem(hero)} onToggleList={()=>void updateMediaState(hero.id,{watchlist:!hero.state?.watchlist})}/>}
      {!library.length&&(
        <EmptyState icon="library" title="Breng je bibliotheek tot leven" message="Voeg bij Instellingen de mappen met je films en series toe. Daarna scant ThuisHub automatisch alle videobestanden." action={<button className="primary" onClick={()=>nav('settings')}>Bibliotheek instellen</button>}/>
      )}
      {continueItems.length>0&&<MediaRow title="Verder kijken" variant="landscape" onAll={()=>nav('continue')}>{continueItems.map(item=><ContinueWatchingCard key={item.id} item={item} onPlay={()=>setPlaying(item)} onInfo={()=>openItem(item)}/>)}</MediaRow>}
      {movies.length>0&&<MediaRow title="Films" onAll={()=>nav('movies')}>{movies.slice(0,12).map(item=><PosterCard key={item.id} item={item} onPlay={()=>setPlaying(item)} onInfo={()=>openItem(item)}/>)}</MediaRow>}
      {series.length>0&&<MediaRow title="Series" onAll={()=>nav('series')}>{series.slice(0,12).map(group=><PosterCard key={group.title} item={group.item} subtitle={`${group.episodes.length} aflevering${group.episodes.length===1?'':'en'}`} onPlay={()=>setPlaying(group.episodes.find(item=>item.progress?.position&&!item.progress.completed)||group.episodes[0])} onInfo={()=>setSelected({item:group.item,episodes:group.episodes})}/>)}</MediaRow>}
      {recentItems.length>0&&<MediaRow title="Recent toegevoegd">{recentItems.map(item=><PosterCard key={`recent-${item.id}`} item={item} onPlay={()=>setPlaying(item)} onInfo={()=>openItem(item)}/>)}</MediaRow>}
      {recommendedItems.length>0&&<MediaRow title="Aanbevolen">{recommendedItems.map(item=><PosterCard key={`recommended-${item.id}`} item={item} onPlay={()=>setPlaying(item)} onInfo={()=>openItem(item)}/>)}</MediaRow>}
      {watchlistItems.length>0&&<MediaRow title="Mijn lijst" onAll={()=>nav('watchlist')}>{watchlistItems.slice(0,12).map(item=><PosterCard key={`list-${item.id}`} item={item} onPlay={()=>setPlaying(item)} onInfo={()=>openItem(item)}/>)}</MediaRow>}
    </>}
    {view==='movies'&&<>{libraryTabs}<LibraryPage eyebrow="BIBLIOTHEEK" title="Films" count={filteredMovies.length}>{filteredMovies.map(item=><PosterCard key={item.id} item={item} onPlay={()=>setPlaying(item)} onInfo={()=>openItem(item)}/>)}</LibraryPage></>}
    {view==='series'&&<>{libraryTabs}<LibraryPage eyebrow="BIBLIOTHEEK" title="Series" count={filteredSeries.length}>{filteredSeries.map(group=><PosterCard key={group.title} item={group.item} subtitle={`${group.episodes.length} aflevering${group.episodes.length===1?'':'en'}`} onPlay={()=>setPlaying(group.episodes.find(item=>item.progress?.position&&!item.progress.completed)||group.episodes[0])} onInfo={()=>setSelected({item:group.item,episodes:group.episodes})}/>)}</LibraryPage></>}
    {view==='music'&&<>{libraryTabs}<MusicPage tracks={music.filter(x=>`${x.title} ${x.artist} ${x.album}`.toLowerCase().includes(query))} onPlay={setAudioTrack}/></>}
    {view==='photos'&&<>{libraryTabs}<PhotosPage photos={photos.filter(x=>x.title.toLowerCase().includes(query))}/></>}
    {view==='live'&&<LiveTvPage/>}
    {view==='continue'&&<section className="reference-page"><PageTitle eyebrow="KIJKGESCHIEDENIS" title="Verder kijken" meta={`${continueItems.length} titels`}/>{continueItems.length?<div className="continue-page-grid">{continueItems.map(item=><ContinueWatchingCard key={item.id} item={item} onPlay={()=>setPlaying(item)} onInfo={()=>openItem(item)}/>)}</div>:<EmptyState icon="history" title="Nog niets om te hervatten" message="Titels die je gedeeltelijk hebt bekeken verschijnen hier automatisch."/>}</section>}
    {view==='watchlist'&&<>{libraryTabs}<LibraryPage eyebrow="PERSOONLIJK" title="Mijn lijst" count={watchlistItems.length}>{watchlistItems.map(item=><PosterCard key={item.id} item={item} subtitle={item.kind==='episode'?`S${item.season} · A${item.episode}`:undefined} onPlay={()=>setPlaying(item)} onInfo={()=>openItem(item)}/>)}</LibraryPage></>}
    {view==='downloads'&&<DownloadsPage/>}
    {(view==='dashboard'||view==='devices')&&bootstrap.user.role==='admin'&&<ServerDashboard key={dashboardSection} initialSection={dashboardSection as any} settings={bootstrap.settings} onSettingsChanged={loadBootstrap}/>}
    {view==='settings'&&<SettingsPanel bootstrap={bootstrap} reload={loadBootstrap} refreshLibrary={loadLibrary}/>}
  </AppShell>
    <nav className="bottom-nav">{([['home','home','Home'],['movies','movie','Bibliotheek'],['live','live','Live'],['continue','watchlist','Verder'],['settings','settings','Instellingen']] as [View,any,string][]).map(([id,icon,label])=><button key={id} className={isNavigationActive(view,id)?'active':''} onClick={()=>nav(id)}><Icon name={icon}/><span>{label}</span></button>)}</nav>
    {selected&&<Detail item={selected.item} episodes={selected.episodes} playlists={playlists} settings={bootstrap.settings} isAdmin={bootstrap.user.role==='admin'} onClose={()=>setSelected(null)} onPlay={item=>{setSelected(null);setPlaying(item);}} onState={state=>updateMediaState(selected.item.id,state)} onEdit={()=>setEditor(selected.item)} onNotice={message=>{setNotice(message);setTimeout(()=>setNotice(''),3500)}}/>}
    {playing&&<Player item={playing} settings={bootstrap.settings} onClose={()=>setPlaying(null)} onProgress={updateProgress} onFinished={()=>{if(bootstrap.settings.autoplay&&nextItem)setPlaying(nextItem);else setPlaying(null);}}/>} 
    {editor&&<MetadataEditor item={editor} onClose={()=>setEditor(null)} onSaved={saveEdited}/>} 
    {notice&&(
      <Toast message={notice}/>
    )}
    {audioTrack&&<AudioPlayer track={audioTrack} onClose={()=>setAudioTrack(null)} onEnded={()=>{const index=music.findIndex(x=>x.id===audioTrack.id);setAudioTrack(music[index+1]||null)}}/>}
    <PlaybackDeviceLayer/>
  </PlaybackDeviceProvider>;
}

function Shelf({title,action,children}:{title:string;action?:()=>void;children:React.ReactNode}) { return <section className="shelf"><div className="section-title"><h2>{title}</h2>{action&&<button onClick={action}>Alles bekijken →</button>}</div><div className="card-row">{children}</div></section>; }
function LibraryPage({eyebrow,title,count,children}:{eyebrow:string;title:string;count:number;children:React.ReactNode}) { return <section className="library-page"><header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><span>{count} {count===1?'titel':'titels'}</span></header>{count?<div className="card-grid">{children}</div>:<div className="no-results"><Icon name="search"/><h2>Niets gevonden</h2><p>Probeer een andere zoekterm of scan je bibliotheek opnieuw.</p></div>}</section>; }
