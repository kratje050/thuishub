import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { api, patch, post, put, type Bootstrap, type MediaItem, type ScanState, type Settings, type Source, type User } from './api';
import ServerDashboard from './ServerDashboard';
import { CastButton, CastRemote } from './TvPlayback';

type View = 'home' | 'movies' | 'series' | 'music' | 'photos' | 'live' | 'watchlist' | 'dashboard' | 'settings';
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

function Player({ item, settings, onClose, onProgress, onFinished }: { item: MediaItem; settings: Settings; onClose: () => void; onProgress: (id: number, progress: MediaItem['progress']) => void; onFinished: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [transcoding, setTranscoding] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  const lastSaved = useRef(0);
  const sessionId = useRef(crypto.randomUUID());
  const startedAt = useRef(new Date().toISOString());
  const [markers, setMarkers] = useState<{id:number;type:'intro'|'credits'|'commercial';startTime:number;endTime:number}[]>([]);
  const [activeMarker, setActiveMarker] = useState<typeof markers[number] | null>(null);
  const [speed, setSpeed] = useState(1);
  const [quality,setQuality]=useState(settings.defaultQualityLan||'auto');
  const [playbackInfo,setPlaybackInfo]=useState<any>(null);
  const [showTechnical,setShowTechnical]=useState(false);

  const save = useCallback((state: 'playing'|'paused'|'stopped' = 'playing') => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const payload = { position: video.currentTime, duration: video.duration, state, sessionId: sessionId.current, startedAt: startedAt.current, transcoding };
    lastSaved.current = Date.now();
    void put<MediaItem['progress']>(`/media/${item.id}/progress`, payload).then(progress => onProgress(item.id, progress)).catch(() => {});
  }, [item.id, onProgress, transcoding]);

  const useHls = useCallback((source:string,mode:string) => {
    const video = videoRef.current;
    if (!video) return;
    setError(''); setTranscoding(mode==='transcode');
    if (Hls.isSupported()) {
      hlsRef.current?.destroy();
      const hls = new Hls({ maxBufferLength: 30, manifestLoadingMaxRetry: 4 });
      hlsRef.current = hls;
      hls.loadSource(source); hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setError('Deze video kon niet worden omgezet. Controleer het bestand en probeer opnieuw.'); });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = source; }
  }, []);

  useEffect(() => {
    const video = videoRef.current!;let cancelled=false;
    hlsRef.current?.destroy();setError('');
    void post<any>(`/playback/${item.id}/decision`,{quality,network:'lan'}).then(result=>{if(cancelled)return;setPlaybackInfo(result);setTranscoding(result.decision.mode==='transcode');if(result.decision.mode==='direct_play')video.src=result.urls.playback;else useHls(result.urls.playback,result.decision.mode)}).catch(e=>setError(e.message));
    const restore = () => { if (item.progress?.position && item.progress.position < video.duration * .92) video.currentTime = Math.max(0, item.progress.position - settings.rewindOnResume); };
    const timer = window.setInterval(() => { if (!video.paused && Date.now() - lastSaved.current > 8000) save(); }, 3000);
    video.addEventListener('loadedmetadata', restore, { once: true });
    return () => { cancelled=true;window.clearInterval(timer); save('stopped'); hlsRef.current?.destroy();video.removeAttribute('src');video.load(); };
  }, [item.id,quality]);

  useEffect(()=>{void api<typeof markers>(`/media/${item.id}/markers`).then(setMarkers);},[item.id]);
  useEffect(()=>{const video=videoRef.current;if(!video)return;const track=()=>setActiveMarker(markers.find(marker=>video.currentTime>=marker.startTime&&video.currentTime<marker.endTime)||null);video.addEventListener('timeupdate',track);return()=>video.removeEventListener('timeupdate',track);},[markers]);
  function changeSpeed(value:number){setSpeed(value);if(videoRef.current)videoRef.current.playbackRate=value;}
  function finish(){save('stopped');onFinished();}

  return <div className="player-layer">
    <div className="player-top"><div><strong>{item.kind === 'episode' ? item.seriesTitle : item.title}</strong>{item.kind === 'episode' && <span>S{item.season} · A{item.episode} · {item.title}</span>}{playbackInfo&&<span className={`playback-mode ${playbackInfo.decision.mode}`}>{playbackInfo.decision.label}</span>}</div><div className="player-actions"><CastButton item={item} settings={settings} onError={setError}/><label>Kwaliteit <select value={quality} onChange={e=>setQuality(e.target.value)}><option value="auto">Automatisch</option><option value="original">Origineel</option><option value="4k-max">4K Maximum</option><option value="4k-high">4K Hoog</option><option value="4k-balanced">4K Gebalanceerd</option><option value="1080p-max">1080p Maximum</option><option value="1080p-high">1080p Hoog</option><option value="1080p-balanced">1080p Gebalanceerd</option><option value="720p">720p</option><option value="data-saver">Databesparing</option></select></label><label>Snelheid <select value={speed} onChange={e=>changeSpeed(Number(e.target.value))}>{[.5,.75,1,1.25,1.5,2].map(x=><option key={x} value={x}>{x}×</option>)}</select></label><button onClick={()=>setShowTechnical(!showTechnical)}>Technische informatie</button><button className="icon-button" onClick={onClose} aria-label="Sluiten"><Icon name="close" /></button></div></div>
    <video ref={videoRef} controls autoPlay playsInline onPlay={()=>save('playing')} onPause={()=>save('paused')} onEnded={finish}>
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
        <div className="detail-copy"><p className="eyebrow">{isSeries ? 'SERIE' : 'FILM'}{item.edition?` · ${item.edition}`:''}</p><h2>{item.seriesTitle || item.title}</h2>{item.tagline&&<em className="tagline">{item.tagline}</em>}<div className="detail-meta">{[item.year, item.contentRating, item.hdr?'HDR':null,item.height ? `${item.height}p` : null, !isSeries && item.duration ? formatDuration(item.duration) : null].filter(Boolean).join(' · ')}</div><p>{item.overview || 'Geen beschrijving beschikbaar. Voeg een TMDB-sleutel toe bij Instellingen om metadata op te halen.'}</p>{!isSeries && <div className="button-row"><button className="primary" onClick={() => onPlay(item)}><Icon name="play" /> Afspelen{item.progress?.position ? ' hervatten' : ''}</button><CastButton item={item} settings={settings} onError={onNotice}/></div>}</div>
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
        {isAdmin&&!isSeries&&<button onClick={async()=>{await post(`/media/${item.id}/markers/auto`);onNotice('Intro- en creditmarkers zijn aangemaakt.');}}>Intro/credits detecteren</button>}
      </div>
      {isSeries && <div className="episode-list">
        <h3>Afleveringen</h3>
        {episodes!.map(ep => <button key={ep.id} className="episode" onClick={() => onPlay(ep)}><span className="episode-number">{ep.season}×{String(ep.episode || 0).padStart(2,'0')}</span><span><strong>{ep.title}</strong><small>{ep.duration ? formatDuration(ep.duration) : 'Speelduur onbekend'}</small></span><Icon name="play" /></button>)}
      </div>}
    </article>
  </div>;
}

function MetadataEditor({item,onClose,onSaved}:{item:MediaItem;onClose:()=>void;onSaved:(item:MediaItem)=>void}){
  const [form,setForm]=useState({title:item.title,year:item.year||'',overview:item.overview||'',contentRating:item.contentRating||'',edition:item.edition||'',tagline:item.tagline||'',genres:(item.genres||[]).join(', ')});
  const [error,setError]=useState('');
  async function submit(e:React.FormEvent){e.preventDefault();try{const updated=await patch<any>(`/media/${item.id}`,{...form,genres:form.genres.split(',').map(x=>x.trim()).filter(Boolean)});onSaved({...item,...updated});onClose();}catch(e:any){setError(e.message)}}
  return <div className="modal-layer"><form className="editor-modal" onSubmit={submit}><header><div><p className="eyebrow">BIBLIOTHEEK</p><h2>Metadata bewerken</h2></div><button type="button" className="icon-button" onClick={onClose}><Icon name="close"/></button></header><div className="editor-grid"><label>Titel<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><label>Jaar<input type="number" value={form.year} onChange={e=>setForm({...form,year:e.target.value as any})}/></label><label>Leeftijdsclassificatie<input value={form.contentRating} onChange={e=>setForm({...form,contentRating:e.target.value})} placeholder="Bijv. 12"/></label><label>Editie<input value={form.edition} onChange={e=>setForm({...form,edition:e.target.value})} placeholder="Director's Cut"/></label><label className="span-2">Tagline<input value={form.tagline} onChange={e=>setForm({...form,tagline:e.target.value})}/></label><label className="span-2">Genres<input value={form.genres} onChange={e=>setForm({...form,genres:e.target.value})} placeholder="Drama, Sciencefiction"/></label><label className="span-2">Beschrijving<textarea value={form.overview} onChange={e=>setForm({...form,overview:e.target.value})}/></label></div>{error&&<div className="alert error">{error}</div>}<footer><button type="button" className="secondary" onClick={onClose}>Annuleren</button><button className="primary">Opslaan</button></footer></form></div>
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

function SettingsPanel({ bootstrap, reload, refreshLibrary }: { bootstrap: Bootstrap; reload: () => Promise<void>; refreshLibrary: () => Promise<void> }) {
  const [serverName, setServerName] = useState(bootstrap.settings.serverName);
  const [tmdbToken, setTmdbToken] = useState(bootstrap.settings.tmdbTokenMasked);
  const [sourceForm, setSourceForm] = useState({ name: '', path: '', kind: 'movies' as 'movies'|'series' });
  const [picker, setPicker] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [userForm, setUserForm] = useState({ username: '', password: '' });
  const [advanced,setAdvanced]=useState({autoplay:bootstrap.settings.autoplay,rewindOnResume:bootstrap.settings.rewindOnResume,skipIntro:bootstrap.settings.skipIntro,skipCredits:bootstrap.settings.skipCredits,hardwareTranscoding:bootstrap.settings.hardwareTranscoding,toneMapping:bootstrap.settings.toneMapping,maxTranscodes:bootstrap.settings.maxTranscodes,uploadLimitMbps:bootstrap.settings.uploadLimitMbps});
  const [networkSettings,setNetworkSettings]=useState({localStreamingEnabled:bootstrap.settings.localStreamingEnabled,localStreamingAddress:bootstrap.settings.localStreamingAddress,localStreamingPort:bootstrap.settings.localStreamingPort,castReceiverAppId:bootstrap.settings.castReceiverAppId,defaultQualityLan:bootstrap.settings.defaultQualityLan,defaultQualityTailscale:bootstrap.settings.defaultQualityTailscale,defaultQualityMobile:bootstrap.settings.defaultQualityMobile,defaultQualityDownload:bootstrap.settings.defaultQualityDownload,defaultQualityLiveTv:bootstrap.settings.defaultQualityLiveTv});
  const [lanAddresses,setLanAddresses]=useState<string[]>([]);
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
  useEffect(() => { if (isAdmin) void Promise.all([api<User[]>('/users').then(setUsers),api('/dashboard').then(setDashboard),api<any[]>('/webhooks').then(setWebhooks),api<any[]>('/extra-sources').then(setExtraSources),api<any[]>('/tv/sources').then(setTvSources),api<any>('/network/interfaces').then(result=>setLanAddresses(result.addresses))]);void api<any[]>('/playlists').then(setPlaylists);void api<any[]>('/collections').then(setCollections); }, [isAdmin]);
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
      <section className="panel"><h2>TMDB-metadata</h2><p>Voor posters, achtergronden en Nederlandse beschrijvingen.</p><label>API-sleutel of Read Access Token<input type="password" value={tmdbToken} onChange={e=>setTmdbToken(e.target.value)} placeholder="Plak je TMDB-sleutel"/></label><button className="primary" onClick={()=>act(()=>patch('/settings',{tmdbToken}), 'TMDB is gekoppeld; ontbrekende metadata wordt opgehaald.')}>{bootstrap.settings.tmdbConfigured ? 'Sleutel wijzigen' : 'Koppelen'}</button><a className="help-link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">Gratis sleutel aanvragen bij TMDB ↗</a></section>
      <section className="panel span-2"><div className="panel-heading"><div><h2>Premium afspelen</h2><p>Hardware-transcoding, HDR en automatisch doorspelen.</p></div><span className="premium-badge">THUISHUB PRO · INBEGREPEN</span></div><div className="toggle-grid"><label><input type="checkbox" checked={advanced.autoplay} onChange={e=>setAdvanced({...advanced,autoplay:e.target.checked})}/><span><strong>Autoplay</strong><small>Speel de volgende aflevering automatisch</small></span></label><label><input type="checkbox" checked={advanced.skipIntro} onChange={e=>setAdvanced({...advanced,skipIntro:e.target.checked})}/><span><strong>Intro overslaan</strong><small>Toon de knop binnen een intromarker</small></span></label><label><input type="checkbox" checked={advanced.skipCredits} onChange={e=>setAdvanced({...advanced,skipCredits:e.target.checked})}/><span><strong>Credits overslaan</strong><small>Ga sneller naar de volgende aflevering</small></span></label><label><input type="checkbox" checked={advanced.toneMapping} onChange={e=>setAdvanced({...advanced,toneMapping:e.target.checked})}/><span><strong>HDR-tone-mapping</strong><small>Correcte kleuren op SDR-schermen</small></span></label></div><div className="advanced-fields"><label>Transcoder<select value={advanced.hardwareTranscoding} onChange={e=>setAdvanced({...advanced,hardwareTranscoding:e.target.value})}><option value="auto">Automatisch (aanbevolen)</option><option value="nvidia">NVIDIA NVENC</option><option value="amd">AMD AMF</option><option value="intel">Intel Quick Sync</option><option value="software">Alleen processor</option></select></label><label>Terugspoelen bij hervatten<input type="number" min="0" max="30" value={advanced.rewindOnResume} onChange={e=>setAdvanced({...advanced,rewindOnResume:Number(e.target.value)})}/></label><label>Max. gelijktijdige transcodes<input type="number" min="1" max="10" value={advanced.maxTranscodes} onChange={e=>setAdvanced({...advanced,maxTranscodes:Number(e.target.value)})}/></label><label>Uploadlimiet (Mbps, 0 = onbeperkt)<input type="number" min="0" value={advanced.uploadLimitMbps} onChange={e=>setAdvanced({...advanced,uploadLimitMbps:Number(e.target.value)})}/></label></div><button className="primary" onClick={()=>act(()=>patch('/settings',advanced),'Premium afspeelinstellingen opgeslagen.')}>Instellingen opslaan</button></section>
      <section className="panel span-2"><div className="panel-heading"><div><h2>Netwerk en tv-streaming</h2><p>De beheerinterface blijft op 127.0.0.1. Alleen beperkte, ondertekende afspeelroutes worden op het gekozen privé-adres aangeboden.</p></div><span className="premium-badge">PRIVÉ-LAN</span></div><div className="toggle-grid"><label><input type="checkbox" checked={networkSettings.localStreamingEnabled} onChange={e=>setNetworkSettings({...networkSettings,localStreamingEnabled:e.target.checked})}/><span><strong>Streamen binnen thuisnetwerk</strong><small>Geen routerpoorten en geen openbare netwerkprofielen</small></span></label></div><div className="advanced-fields"><label>Privé-LAN-adres<select value={networkSettings.localStreamingAddress} onChange={e=>setNetworkSettings({...networkSettings,localStreamingAddress:e.target.value})}><option value="">Selecteer adres</option>{lanAddresses.map(address=><option key={address}>{address}</option>)}</select></label><label>Streamingpoort<input type="number" min="1024" max="65535" value={networkSettings.localStreamingPort} onChange={e=>setNetworkSettings({...networkSettings,localStreamingPort:Number(e.target.value)})}/></label><label>Google Cast Receiver App ID<input value={networkSettings.castReceiverAppId} onChange={e=>setNetworkSettings({...networkSettings,castReceiverAppId:e.target.value.toUpperCase()})} placeholder="Leeg = standaardreceiver"/></label>{([['defaultQualityLan','Thuisnetwerk'],['defaultQualityTailscale','Tailscale'],['defaultQualityMobile','Mobiel internet'],['defaultQualityDownload','Downloads'],['defaultQualityLiveTv','Live TV']] as const).map(([key,label])=><label key={key}>Standaardkwaliteit {label}<select value={networkSettings[key]} onChange={e=>setNetworkSettings({...networkSettings,[key]:e.target.value})}>{[['auto','Automatisch'],['original','Origineel'],['4k-max','4K Maximum · 80 Mbps'],['4k-high','4K Hoog · 40 Mbps'],['4k-balanced','4K Gebalanceerd · 25 Mbps'],['1080p-max','1080p Maximum · 20 Mbps'],['1080p-high','1080p Hoog · 12 Mbps'],['1080p-balanced','1080p Gebalanceerd · 8 Mbps'],['720p','720p · 4 Mbps'],['data-saver','Databesparing · 2 Mbps']].map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>)}</div><div className="button-row"><button className="primary" onClick={()=>act(()=>patch('/settings',networkSettings),'Netwerkinstellingen opgeslagen. Herstart ThuisHub om de streamingpoort toe te passen.')}>Opslaan</button></div><p className="dashboard-note">Voer daarna bewust als administrator <code>scripts\configure-private-streaming.ps1 enable</code> uit voor een firewallregel die uitsluitend op het Windows-profiel Privé en LocalSubnet geldt.</p></section>
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
  const [view, setView] = useState<View>(['home','movies','series','music','photos','live','watchlist','dashboard','settings'].includes(initialView)?initialView:'home');
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
  const hero=continueItems[0]||movies[0]||series[0]?.item;
  const openItem=(item:MediaItem)=>{if(item.kind==='episode'&&item.seriesTitle){const group=series.find(x=>x.title===item.seriesTitle);setSelected({item:group?.item||item,episodes:group?.episodes});}else setSelected({item});};
  const updateProgress=useCallback((id:number,progress:MediaItem['progress'])=>setLibrary(items=>items.map(x=>x.id===id?{...x,progress}:x)),[]);
  const updateMediaState=useCallback(async(id:number,state:Partial<MediaItem['state']>)=>{const updated=await put<MediaItem['state']>(`/media/${id}/state`,state);setLibrary(items=>items.map(x=>x.id===id?{...x,state:updated}:x));setSelected(current=>current?{...current,item:current.item.id===id?{...current.item,state:updated}:current.item,episodes:current.episodes?.map(x=>x.id===id?{...x,state:updated}:x)}:current);},[]);
  const saveEdited=useCallback((updated:MediaItem)=>{setLibrary(items=>items.map(x=>x.id===updated.id?updated:x));setSelected(current=>current?{...current,item:current.item.id===updated.id?updated:current.item}:current);},[]);
  const nextItem=useMemo(()=>{if(!playing)return null;if(playing.kind==='episode'&&playing.seriesTitle){const eps=series.find(x=>x.title===playing.seriesTitle)?.episodes||[];const index=eps.findIndex(x=>x.id===playing.id);return index>=0?eps[index+1]||null:null;}return null;},[playing,series]);

  if(!bootstrap) return <div className="splash"><img className="splash-logo" src="/brand/thuishub-icon-256.png" alt="ThuisHub"/>{loadError?<><div className="alert error">{loadError}</div><button className="primary" onClick={()=>void initialize()}>Opnieuw proberen</button></>:<span className="spinner" />}</div>;

  const nav=(next:View)=>{setView(next);setSearch('');window.scrollTo(0,0);};
  return <div className="app-shell">
    <aside className="sidebar"><button className="brand" onClick={()=>nav('home')}><img className="sidebar-logo" src="/brand/thuishub-icon-128.png" alt=""/><span>{bootstrap.settings.serverName}</span></button><nav>{([['home','home','Start'],['movies','movie','Films'],['series','series','Series'],['music','music','Muziek'],['photos','photos','Foto’s'],['live','live','Live TV'],['watchlist','watchlist','Mijn lijst'],...(bootstrap.user.role==='admin'?[['dashboard','settings','Dashboard']]:[]),['settings','settings','Instellingen']] as [View,any,string][]).map(([id,icon,label])=><button key={id} className={view===id?'active':''} onClick={()=>nav(id)}><Icon name={icon}/><span>{label}</span></button>)}</nav><div className="sidebar-user"><div className="avatar">{bootstrap.user.username.slice(0,1).toUpperCase()}</div><span><strong>{bootstrap.user.username}</strong><small>{bootstrap.user.role==='admin'?'Beheerder':'Gebruiker'}</small></span></div></aside>
    <main className="content">
      {!['settings','dashboard'].includes(view)&&<header className="topbar"><button className="mobile-brand" onClick={()=>nav('home')}><img className="sidebar-logo" src="/brand/thuishub-icon-128.png" alt="ThuisHub"/></button><div className="search"><Icon name="search"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Zoek in je bibliotheek…"/></div>{bootstrap.scan.running&&<div className="scan-pill"><span className="spinner tiny"/>Scannen {bootstrap.scan.scanned}/{bootstrap.scan.total||'?'}</div>}</header>}
      {view==='home'&&<>
        {hero&&<section className="hero" style={hero.backdropUrl?{backgroundImage:`linear-gradient(90deg, #07110e 1%,rgba(7,17,14,.82) 43%,rgba(7,17,14,.18)),linear-gradient(0deg,#07110e,transparent 35%),url(${hero.backdropUrl})`}:undefined}><div><p className="eyebrow">{hero.progress?.position?'GA VERDER WAAR JE WAS':'UIT JE BIBLIOTHEEK'}</p><h1>{hero.seriesTitle||hero.title}</h1><p>{hero.overview||'Jouw eigen films en series, rechtstreeks vanaf deze pc.'}</p><button className="primary" onClick={()=>hero.kind==='episode'?setPlaying(hero):openItem(hero)}><Icon name="play"/>{hero.progress?.position?'Verder kijken':'Bekijken'}</button></div></section>}
        {!library.length&&<section className="welcome-empty"><div className="empty-art"><Icon name="folder"/></div><p className="eyebrow">EERSTE STAP</p><h1>Breng je bibliotheek tot leven</h1><p>Voeg bij Instellingen de mappen met je films en series toe. Daarna scant ThuisHub automatisch alle videobestanden.</p><button className="primary" onClick={()=>nav('settings')}><Icon name="settings"/>Bibliotheek instellen</button></section>}
        {continueItems.length>0&&<Shelf title="Verder kijken">{continueItems.map(item=><MediaCard key={item.id} item={item} subtitle={item.kind==='episode'?`S${item.season} · A${item.episode} · ${item.title}`:undefined} onClick={()=>setPlaying(item)}/>)}</Shelf>}
        {movies.length>0&&<Shelf title="Films" action={()=>nav('movies')}>{movies.slice(0,12).map(item=><MediaCard key={item.id} item={item} onClick={()=>openItem(item)}/>)}</Shelf>}
        {series.length>0&&<Shelf title="Series" action={()=>nav('series')}>{series.slice(0,12).map(group=><MediaCard key={group.title} item={group.item} subtitle={`${group.episodes.length} aflevering${group.episodes.length===1?'':'en'}`} onClick={()=>setSelected({item:group.item,episodes:group.episodes})}/>)}</Shelf>}
      </>}
      {view==='movies'&&<LibraryPage eyebrow="BIBLIOTHEEK" title="Films" count={filteredMovies.length}>{filteredMovies.map(item=><MediaCard key={item.id} item={item} onClick={()=>openItem(item)}/>)}</LibraryPage>}
      {view==='series'&&<LibraryPage eyebrow="BIBLIOTHEEK" title="Series" count={filteredSeries.length}>{filteredSeries.map(group=><MediaCard key={group.title} item={group.item} subtitle={`${group.episodes.length} aflevering${group.episodes.length===1?'':'en'}`} onClick={()=>setSelected({item:group.item,episodes:group.episodes})}/>)}</LibraryPage>}
      {view==='music'&&<MusicPage tracks={music.filter(x=>`${x.title} ${x.artist} ${x.album}`.toLowerCase().includes(query))} onPlay={setAudioTrack}/>} 
      {view==='photos'&&<PhotosPage photos={photos.filter(x=>x.title.toLowerCase().includes(query))}/>} 
      {view==='live'&&<LiveTvPage/>}
      {view==='watchlist'&&<LibraryPage eyebrow="PERSOONLIJK" title="Mijn lijst" count={watchlistItems.length}>{watchlistItems.map(item=><MediaCard key={item.id} item={item} subtitle={item.kind==='episode'?`S${item.season} · A${item.episode}`:undefined} onClick={()=>openItem(item)}/>)}</LibraryPage>}
      {view==='dashboard'&&bootstrap.user.role==='admin'&&<ServerDashboard settings={bootstrap.settings} onSettingsChanged={loadBootstrap}/>}
      {view==='settings'&&<SettingsPanel bootstrap={bootstrap} reload={loadBootstrap} refreshLibrary={loadLibrary}/>} 
    </main>
    <nav className="bottom-nav">{([['home','home','Start'],['movies','movie','Films'],['series','series','Series'],['music','music','Muziek'],['photos','photos','Foto’s'],['live','live','Live'],['watchlist','watchlist','Mijn lijst'],...(bootstrap.user.role==='admin'?[['dashboard','settings','Dashboard']]:[]),['settings','settings','Instellingen']] as [View,any,string][]).map(([id,icon,label])=><button key={id} className={view===id?'active':''} onClick={()=>nav(id)}><Icon name={icon}/><span>{label}</span></button>)}</nav>
    {selected&&<Detail item={selected.item} episodes={selected.episodes} playlists={playlists} settings={bootstrap.settings} isAdmin={bootstrap.user.role==='admin'} onClose={()=>setSelected(null)} onPlay={item=>{setSelected(null);setPlaying(item);}} onState={state=>updateMediaState(selected.item.id,state)} onEdit={()=>setEditor(selected.item)} onNotice={message=>{setNotice(message);setTimeout(()=>setNotice(''),3500)}}/>}
    {playing&&<Player item={playing} settings={bootstrap.settings} onClose={()=>setPlaying(null)} onProgress={updateProgress} onFinished={()=>{if(bootstrap.settings.autoplay&&nextItem)setPlaying(nextItem);else setPlaying(null);}}/>} 
    {editor&&<MetadataEditor item={editor} onClose={()=>setEditor(null)} onSaved={saveEdited}/>} 
    {notice&&<div className="toast">{notice}</div>}
    {audioTrack&&<AudioPlayer track={audioTrack} onClose={()=>setAudioTrack(null)} onEnded={()=>{const index=music.findIndex(x=>x.id===audioTrack.id);setAudioTrack(music[index+1]||null)}}/>}
    <CastRemote/>
  </div>;
}

function Shelf({title,action,children}:{title:string;action?:()=>void;children:React.ReactNode}) { return <section className="shelf"><div className="section-title"><h2>{title}</h2>{action&&<button onClick={action}>Alles bekijken →</button>}</div><div className="card-row">{children}</div></section>; }
function LibraryPage({eyebrow,title,count,children}:{eyebrow:string;title:string;count:number;children:React.ReactNode}) { return <section className="library-page"><header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><span>{count} {count===1?'titel':'titels'}</span></header>{count?<div className="card-grid">{children}</div>:<div className="no-results"><Icon name="search"/><h2>Niets gevonden</h2><p>Probeer een andere zoekterm of scan je bibliotheek opnieuw.</p></div>}</section>; }
