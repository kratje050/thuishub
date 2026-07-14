import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api, type MediaItem, type ScanState, type Settings, type User } from './api';

export type ReferenceView = 'home' | 'movies' | 'series' | 'music' | 'photos' | 'live' | 'continue' | 'watchlist' | 'downloads' | 'devices' | 'dashboard' | 'settings';

export type UiIconName = 'home' | 'library' | 'live' | 'history' | 'download' | 'devices' | 'dashboard' | 'settings' | 'search' | 'play' | 'plus' | 'info' | 'bell' | 'menu' | 'close' | 'chevron-right' | 'chevron-left' | 'storage' | 'globe' | 'heartbeat' | 'network' | 'backup' | 'cpu' | 'memory' | 'clock' | 'check' | 'movie' | 'series' | 'music' | 'photos' | 'list';

export function UiIcon({name,className=''}:{name:UiIconName;className?:string}){
  const paths:Record<UiIconName,ReactNode>={
    home:<><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/></>,
    library:<><path d="m4 5 8-3 8 3-8 3Z"/><path d="m4 10 8 3 8-3M4 15l8 3 8-3"/></>,
    live:<><rect x="3" y="6" width="18" height="14" rx="2"/><path d="m8 3 4 3 4-3M9 11l6 3-6 3Z"/></>,
    history:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M3 12H1m3-6L2.5 4.5"/></>,
    download:<><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 21h14"/></>,
    devices:<><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8m-4-3v3"/></>,
    dashboard:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    play:<path d="m8 5 11 7-11 7Z"/>,plus:<path d="M12 5v14M5 12h14"/>,
    info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
    bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    menu:<path d="M4 7h16M4 12h16M4 17h16"/>,close:<path d="M6 6l12 12M18 6 6 18"/>,
    'chevron-right':<path d="m9 18 6-6-6-6"/>,'chevron-left':<path d="m15 18-6-6 6-6"/>,
    storage:<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    globe:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    heartbeat:<path d="M3 12h4l2-7 4 14 2-7h6"/>,
    network:<><path d="M4 17h2v3H4zM9 13h2v7H9zM14 9h2v11h-2zM19 4h2v16h-2z"/></>,
    backup:<><path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
    cpu:<><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/></>,
    memory:<><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10v4m5-4v4m5-4v4M6 4v3m4-3v3m4-3v3m4-3v3"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,check:<path d="m5 12 4 4L19 6"/>,
    movie:<><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M7 5 9 2m3 3 2-3m3 3 2-3M3 10h18"/></>,
    series:<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m9 8 6 4-6 4Z"/></>,
    music:<><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
    photos:<><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 2-2 6 5"/></>,
    list:<><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></>,
  };
  return <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const sidebarEntries:Array<{id:ReferenceView;label:string;icon:UiIconName;divider?:boolean}>=[
  {id:'home',label:'Home',icon:'home'},
  {id:'movies',label:'Bibliotheek',icon:'library'},
  {id:'live',label:'Live TV',icon:'live'},
  {id:'continue',label:'Verder kijken',icon:'history'},
  {id:'downloads',label:'Downloads',icon:'download'},
  {id:'devices',label:'Apparaten',icon:'devices'},
  {id:'dashboard',label:'Dashboard',icon:'dashboard',divider:true},
  {id:'settings',label:'Instellingen',icon:'settings'},
];

export function isNavigationActive(current:ReferenceView,target:ReferenceView){
  if(target==='movies')return ['movies','series','music','photos','watchlist'].includes(current);
  return current===target;
}

export function Sidebar({view,serverName,isAdmin,open,onNavigate,onClose}:{view:ReferenceView;serverName:string;isAdmin:boolean;open:boolean;onNavigate:(view:ReferenceView)=>void;onClose:()=>void}){
  return <aside className={`reference-sidebar ${open?'mobile-open':''}`} aria-label="Hoofdnavigatie">
    <button className="reference-brand" onClick={()=>{onNavigate('home');onClose()}}><img src="/brand/thuishub-icon-128.png" alt=""/><strong>{serverName||'ThuisHub'}</strong></button>
    <nav>{sidebarEntries.filter(entry=>isAdmin||!['dashboard','devices'].includes(entry.id)).map(entry=><button key={entry.id} className={`${isNavigationActive(view,entry.id)?'active':''} ${entry.divider?'with-divider':''}`} aria-current={isNavigationActive(view,entry.id)?'page':undefined} onClick={()=>{onNavigate(entry.id);onClose()}}><UiIcon name={entry.icon}/><span>{entry.label}</span></button>)}</nav>
    <div className="sidebar-cinema-glow" aria-hidden="true"/>
  </aside>;
}

export function searchMedia(items:MediaItem[],query:string,limit=8){
  const needle=query.trim().toLocaleLowerCase('nl');
  if(!needle)return [];
  return items.filter(item=>[item.title,item.seriesTitle,item.originalTitle,...(item.cast||[]).map(person=>person.name)].filter(Boolean).join(' ').toLocaleLowerCase('nl').includes(needle)).slice(0,limit);
}

export function SearchBar({query,onQuery,library,onSelect}:{query:string;onQuery:(value:string)=>void;library:MediaItem[];onSelect:(item:MediaItem)=>void}){
  const inputRef=useRef<HTMLInputElement>(null);
  const [focused,setFocused]=useState(false);
  const results=useMemo(()=>searchMedia(library,query),[library,query]);
  useEffect(()=>{
    const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();inputRef.current?.focus()}if(event.key==='Escape'&&document.activeElement===inputRef.current){onQuery('');inputRef.current?.blur()}};
    window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);
  },[onQuery]);
  return <div className={`reference-search ${focused?'focused':''}`}><UiIcon name="search"/><input ref={inputRef} value={query} onFocus={()=>setFocused(true)} onBlur={()=>window.setTimeout(()=>setFocused(false),120)} onChange={event=>onQuery(event.target.value)} placeholder="Zoek films, series, personen..." aria-label="Zoek in de bibliotheek"/><kbd>Ctrl + K</kbd>{focused&&query.trim()&&<div className="search-results" role="listbox" aria-label="Zoekresultaten">{results.length?results.map(item=><button key={item.id} role="option" onMouseDown={event=>event.preventDefault()} onClick={()=>{onSelect(item);onQuery('')}}>{item.posterUrl?<img src={item.posterUrl} alt=""/>:<span className="search-result-fallback"><UiIcon name={item.kind==='movie'?'movie':'series'}/></span>}<span><strong>{item.seriesTitle||item.title}</strong><small>{item.kind==='episode'?`S${item.season||0} · A${item.episode||0} · ${item.title}`:[item.year,item.genres?.slice(0,2).join(', ')].filter(Boolean).join(' · ')}</small></span><UiIcon name="chevron-right"/></button>):<p>Geen resultaten voor “{query}”.</p>}</div>}</div>;
}

export function TopBar({query,onQuery,library,onSelect,user,scan,onMenu,systemOpen,onToggleSystem}:{query:string;onQuery:(value:string)=>void;library:MediaItem[];onSelect:(item:MediaItem)=>void;user:User;scan:ScanState;onMenu:()=>void;systemOpen:boolean;onToggleSystem:()=>void}){
  return <header className="reference-topbar">
    <button className="topbar-menu" onClick={onMenu} aria-label="Menu openen"><UiIcon name="menu"/></button>
    <SearchBar query={query} onQuery={onQuery} library={library} onSelect={onSelect}/>
    <div className="topbar-actions">{scan.running&&<span className="topbar-scan"><i/>Scannen {scan.scanned}/{scan.total||'?'}</span>}<button className="status-toggle" onClick={onToggleSystem} aria-pressed={systemOpen} aria-label="Systeemstatus tonen"><UiIcon name="heartbeat"/></button><button className="notification-button" title="Geen nieuwe meldingen" aria-label="Geen nieuwe meldingen"><UiIcon name="bell"/></button><div className="topbar-user" title={`${user.username} · ${user.role==='admin'?'Beheerder':'Gebruiker'}`}><span>{user.username.slice(0,1).toUpperCase()}</span><i/></div></div>
  </header>;
}

export function qualityBadges(item:MediaItem){
  const badges:string[]=[];
  if((item.height||0)>=2100||(item.width||0)>=3800)badges.push('4K');else if((item.height||0)>=1000)badges.push('HD');
  const hdr=String(item.hdrType||'').toLowerCase();
  if(item.dolbyVisionProfile)badges.push('Dolby Vision');
  else if(hdr.includes('hdr10plus')||hdr.includes('hdr10+'))badges.push('HDR10+');
  else if(item.hdr||hdr==='hdr10'||hdr==='pq')badges.push('HDR10');
  if(item.atmos)badges.push('Atmos');
  else if((item.audioChannels||0)>=7.1)badges.push('7.1');
  else if((item.audioChannels||0)>=5.1)badges.push('5.1');
  return badges;
}

export function QualityBadge({label}:{label:string}){return <span className={`quality-badge badge-${label.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`}>{label}</span>}
export function QualityBadges({item,limit=4}:{item:MediaItem;limit?:number}){const badges=qualityBadges(item).slice(0,limit);return badges.length?<span className="quality-badges">{badges.map(label=><QualityBadge key={label} label={label}/>)}</span>:null}

export function formatMediaDuration(seconds=0){const minutes=Math.max(1,Math.round(seconds/60));return minutes>=60?`${Math.floor(minutes/60)}u ${String(minutes%60).padStart(2,'0')}m`:`${minutes} min`}

export function HeroBanner({item,index,total,onIndex,onPlay,onInfo,onToggleList}:{item:MediaItem;index:number;total:number;onIndex:(index:number)=>void;onPlay:()=>void;onInfo:()=>void;onToggleList:()=>void}){
  const background=item.backdropUrl||item.posterUrl;
  return <section className="reference-hero" style={background?{'--hero-image':`url("${background.replace(/"/g,'%22')}")`} as CSSProperties:undefined} aria-label={`Aanbevolen: ${item.seriesTitle||item.title}`}>
    <div className="hero-copy"><p className="hero-label">AANBEVOLEN</p><h1>{item.seriesTitle||item.title}</h1><div className="hero-meta">{[item.year,item.duration?formatMediaDuration(item.duration):null,item.genres?.slice(0,3).join(', ')].filter(Boolean).map((value,i)=><span key={`${value}-${i}`}>{value}</span>)}</div><p className="hero-description">{item.overview||item.tagline||'Klaar om rechtstreeks uit je eigen bibliotheek af te spelen.'}</p><QualityBadges item={item}/><div className="hero-actions"><button className="hero-play" onClick={onPlay}><UiIcon name="play"/>Nu afspelen</button><button className={`hero-round ${item.state?.watchlist?'selected':''}`} onClick={onToggleList} aria-label={item.state?.watchlist?'Uit Mijn lijst verwijderen':'Aan Mijn lijst toevoegen'}><UiIcon name={item.state?.watchlist?'check':'plus'}/></button><button className="hero-round" onClick={onInfo} aria-label="Meer informatie"><UiIcon name="info"/></button></div></div>
    {total>1&&<div className="hero-dots" aria-label="Aanbevelingen">{Array.from({length:total},(_,dot)=><button key={dot} className={dot===index?'active':''} aria-label={`Aanbeveling ${dot+1}`} aria-current={dot===index?true:undefined} onClick={()=>onIndex(dot)}/>)}</div>}
  </section>;
}

function progressPercent(item:MediaItem){return item.progress?.duration?Math.max(0,Math.min(100,item.progress.position/item.progress.duration*100)):0}

export function ContinueWatchingCard({item,onPlay,onInfo}:{item:MediaItem;onPlay:()=>void;onInfo:()=>void}){
  const image=item.backdropUrl||item.posterUrl;
  const progress=progressPercent(item);
  return <article className="continue-card"><button className="continue-art" onClick={onPlay} aria-label={`${item.seriesTitle||item.title} verder kijken`}>{image?<img src={image} alt="" loading="lazy"/>:<span className="landscape-fallback"><UiIcon name="movie"/></span>}<span className="card-overlay-play"><UiIcon name="play"/></span><QualityBadges item={item} limit={3}/></button><div className="continue-copy"><button onClick={onInfo}><strong>{item.seriesTitle||item.title}</strong><small>{item.kind==='episode'?`S${item.season||0} · A${item.episode||0} · ${item.title}`:formatMediaDuration(item.duration||0)}</small></button><span>{Math.round(progress)}%</span></div><div className="continue-progress"><i style={{width:`${progress}%`}}/></div></article>;
}

export function PosterCard({item,subtitle,onPlay,onInfo}:{item:MediaItem;subtitle?:string;onPlay:()=>void;onInfo:()=>void}){
  return <article className="reference-poster-card"><div className="poster-art"><button className="poster-open" onClick={onInfo} aria-label={`Informatie over ${item.seriesTitle||item.title}`}>{item.posterUrl?<img src={item.posterUrl} alt="" loading="lazy"/>:<span className="poster-art-fallback"><small>{item.kind==='movie'?'FILM':'SERIE'}</small><strong>{item.seriesTitle||item.title}</strong></span>}</button><QualityBadges item={item} limit={3}/><span className="poster-hover"><button type="button" onClick={onPlay} aria-label={`${item.seriesTitle||item.title} afspelen`}><UiIcon name="play"/></button><button type="button" onClick={onInfo} aria-label={`Informatie over ${item.seriesTitle||item.title}`}><UiIcon name="info"/></button></span></div><strong>{item.seriesTitle||item.title}</strong><small>{subtitle||[item.year,item.duration?formatMediaDuration(item.duration):null].filter(Boolean).join(' · ')||'Klaar om af te spelen'}</small></article>;
}

export function MediaRow({title,onAll,variant='poster',children}:{title:string;onAll?:()=>void;variant?:'poster'|'landscape';children:ReactNode}){
  const rowRef=useRef<HTMLDivElement>(null);
  const move=(direction:number)=>rowRef.current?.scrollBy({left:direction*Math.max(280,rowRef.current.clientWidth*.78),behavior:'smooth'});
  return <section className={`reference-media-row ${variant==='landscape'?'landscape-row':''}`}><header><h2>{title}</h2><span>{onAll&&<button onClick={onAll}>Alles bekijken <UiIcon name="chevron-right"/></button>}<button className="row-arrow" onClick={()=>move(-1)} aria-label={`${title} naar links`}><UiIcon name="chevron-left"/></button><button className="row-arrow" onClick={()=>move(1)} aria-label={`${title} naar rechts`}><UiIcon name="chevron-right"/></button></span></header><div ref={rowRef} className="reference-row-scroller" tabIndex={0}>{children}</div></section>;
}

export type SystemHistory={cpu:number[];memory:number[];download:number[];upload:number[]};

export function useSystemStatus(enabled:boolean){
  const[data,setData]=useState<any>(null);const[error,setError]=useState('');const[history,setHistory]=useState<SystemHistory>({cpu:[],memory:[],download:[],upload:[]});
  const refresh=useCallback(async()=>{if(!enabled)return;try{const next=await api<any>('/dashboard');setData(next);setError('');setHistory(current=>({cpu:[...current.cpu,Number(next.system?.cpu?.usagePercent||0)].slice(-24),memory:[...current.memory,Number(next.system?.memory?.usagePercent||0)].slice(-24),download:[...current.download,Number(next.system?.network?.downloadBytesPerSecond||0)].slice(-24),upload:[...current.upload,Number(next.system?.network?.uploadBytesPerSecond||0)].slice(-24)}))}catch(caught){setError(caught instanceof Error?caught.message:'Systeemstatus niet beschikbaar.')}},[enabled]);
  useEffect(()=>{if(!enabled)return;void refresh();const timer=window.setInterval(()=>void refresh(),6000);return()=>window.clearInterval(timer)},[enabled,refresh]);
  return {data,error,history,refresh};
}

export function formatBytes(value=0){if(!Number.isFinite(value)||value<0)return'Onbekend';if(value<1024)return`${Math.round(value)} B`;const units=['KB','MB','GB','TB'];let amount=value;let unit='B';for(const candidate of units){amount/=1024;unit=candidate;if(amount<1024)break}return`${amount>=100?amount.toFixed(0):amount>=10?amount.toFixed(1):amount.toFixed(2)} ${unit}`}
export function formatRate(value:number|null|undefined){return value==null?'Onbekend':`${formatBytes(value)}/s`}
export function formatUptime(seconds=0){const days=Math.floor(seconds/86400);const hours=Math.floor(seconds%86400/3600);const minutes=Math.floor(seconds%3600/60);return days?`${days}d ${hours}u ${minutes}m`:`${hours}u ${minutes}m`}

export function MiniMetricChart({values,color='cyan'}:{values:number[];color?:'lime'|'cyan'|'blue'|'purple'}){
  const points=values.length>1?values.map((value,index)=>`${index/(values.length-1)*100},${30-Math.max(0,Math.min(100,value))/100*27}`).join(' '):'0,28 100,28';
  return <svg className={`mini-chart chart-${color}`} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points={points}/></svg>;
}

export function StatusCard({icon,color,title,children,onClick}:{icon:UiIconName;color:string;title:string;children:ReactNode;onClick?:()=>void}){
  const content=<><span className={`status-icon status-${color}`}><UiIcon name={icon}/></span><span className="status-card-copy"><small>{title}</small>{children}</span>{onClick&&<UiIcon name="chevron-right"/>}</>;
  return onClick?<button className="system-card" onClick={onClick}>{content}</button>:<div className="system-card">{content}</div>;
}

function nextBackupLabel(last:string|undefined,mode:string){if(mode==='off')return'Automatische back-ups uit';if(!last)return mode==='weekly'?'Wekelijks gepland':'Dagelijks gepland';const interval=mode==='weekly'?7*86400000:86400000;let next=new Date(last).getTime()+interval;while(next<Date.now())next+=interval;return`Volgende: ${new Date(next).toLocaleString('nl-NL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}`}

export function SystemStatusPanel({data,error,history,settings,open,onClose,onOpenSection}:{data:any;error:string;history:SystemHistory;settings:Settings;open:boolean;onClose:()=>void;onOpenSection:(section:string)=>void}){
  const activity=data?.activity||[];const disk=data?.storage?.disk;const network=data?.system?.network;const lastBackup=data?.lastBackup;
  return <aside className={`system-status-panel ${open?'open':''}`} aria-label="Systeemstatus"><header><span>SYSTEEMSTATUS</span><i className={data?.serverStatus==='online'?'online':'offline'}/><button onClick={onClose} aria-label="Systeemstatus sluiten"><UiIcon name="close"/></button></header>{!data&&<LoadingSkeleton rows={6}/>} {error&&<div className="system-error" role="alert">{error}</div>}{data&&<div className="system-card-stack">
    <StatusCard icon="devices" color="blue" title="Actieve streams" onClick={()=>onOpenSection('streams')}><strong>{activity.length}</strong><em>{activity.filter((item:any)=>String(item.address||'').includes('127.0.0.1')).length} intern · {activity.filter((item:any)=>!String(item.address||'').includes('127.0.0.1')).length} extern</em></StatusCard>
    <StatusCard icon="storage" color="lime" title="Opslag" onClick={()=>onOpenSection('libraries')}><strong>{disk?`${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`:formatBytes(data.storage?.libraryBytes)}</strong><em>{disk?`${Math.round(disk.usagePercent)}% gebruikt`:'Bibliotheekgrootte'}</em>{disk&&<span className="status-progress"><i style={{width:`${Math.min(100,disk.usagePercent)}%`}}/></span>}</StatusCard>
    <StatusCard icon="globe" color="cyan" title="Externe toegang" onClick={()=>onOpenSection('remote')}><strong className={data.tailscale?.serveActive?'success-text':'warning-text'}>{data.tailscale?.serveActive?'Actief':'Niet actief'}</strong><em>{data.tailscale?.httpsUrl?String(data.tailscale.httpsUrl).replace(/^https?:\/\//,'').slice(0,28):'Tailscale Serve'}</em></StatusCard>
    <StatusCard icon="heartbeat" color="lime" title="Serverstatus" onClick={()=>onOpenSection('overview')}><strong className={data.database?.ok?'success-text':'error-text'}>{data.database?.ok?'Gezond':'Controle nodig'}</strong><em>{data.database?.ok?'Alle systemen operationeel':'Databasewaarschuwing'}</em></StatusCard>
    <StatusCard icon="network" color="cyan" title="Netwerk"><strong>{network?.available?`${formatRate(network.downloadBytesPerSecond)} ↓  ${formatRate(network.uploadBytesPerSecond)} ↑`:'Snelheid onbekend'}</strong><em>{network?.interfaces?.[0]||'Geen LAN-adres'}</em><MiniMetricChart values={history.download} color="cyan"/></StatusCard>
    <StatusCard icon="backup" color="purple" title="Laatste back-up" onClick={()=>onOpenSection('backups')}><strong>{lastBackup?new Date(lastBackup.createdAt).toLocaleString('nl-NL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'Nog geen'}</strong><em>{nextBackupLabel(lastBackup?.createdAt,settings.automaticBackups)}</em></StatusCard>
  </div>}</aside>;
}

export function BottomStatusBar({data,history}:{data:any;history:SystemHistory}){
  const cpu=data?.system?.cpu?.usagePercent;const memory=data?.system?.memory?.usagePercent;const network=data?.system?.network;
  return <footer className="bottom-status-bar"><span className="server-foot"><i/>ThuisHub Server</span><span className="platform-foot">{data?.system?.platform?.name||'Windows'} {data?.system?.platform?.release||''} · v{data?.version||'…'}</span><span className="bottom-spacer"/><span className="bottom-metric"><UiIcon name="cpu"/>CPU {cpu==null?'…':`${cpu}%`}<MiniMetricChart values={history.cpu} color="lime"/></span><span className="bottom-metric"><UiIcon name="memory"/>RAM {memory==null?'…':`${memory}%`}<MiniMetricChart values={history.memory} color="blue"/></span><span className="bottom-metric"><UiIcon name="network"/>{network?.available?formatRate(network.downloadBytesPerSecond):'Netwerk onbekend'}<MiniMetricChart values={history.download} color="cyan"/></span><span className="uptime-foot"><UiIcon name="clock"/>Uptime {formatUptime(data?.uptimeSeconds||0)}</span></footer>;
}

export function AppShell({sidebar,topbar,status,bottom,children}:{sidebar:ReactNode;topbar:ReactNode;status:ReactNode;bottom:ReactNode;children:ReactNode}){return <div className="reference-app-shell">{sidebar}<div className="reference-main">{topbar}<main className="reference-content">{children}</main></div>{status}{bottom}</div>}
export function PlayerControls({children}:{children:ReactNode}){return <div className="player-actions">{children}</div>}

export function LibraryTabs({view,onNavigate}:{view:ReferenceView;onNavigate:(view:ReferenceView)=>void}){const tabs:Array<[ReferenceView,string,UiIconName]>=[['movies','Films','movie'],['series','Series','series'],['music','Muziek','music'],['photos','Foto’s','photos'],['watchlist','Mijn lijst','list']];return <nav className="library-tabs" aria-label="Bibliotheekonderdelen">{tabs.map(([id,label,icon])=><button key={id} className={view===id?'active':''} onClick={()=>onNavigate(id)}><UiIcon name={icon}/>{label}</button>)}</nav>}

export function DownloadsPage(){
  const[items,setItems]=useState<any[]|null>(null);const[error,setError]=useState('');
  useEffect(()=>{void api<any[]>('/optimizations').then(setItems).catch(caught=>setError(caught instanceof Error?caught.message:'Downloads konden niet worden geladen.'))},[]);
  return <section className="reference-page downloads-page"><PageTitle eyebrow="OFFLINE KIJKEN" title="Downloads" meta={items?`${items.length} taken`:'Laden…'}/>{error&&<ErrorState title="Downloads niet beschikbaar" message={error}/>} {!items&&<LoadingSkeleton rows={4}/>} {items&&items.length===0&&<EmptyState icon="download" title="Nog geen downloads" message="Maak vanuit een filmdetail een geoptimaliseerde versie voor offline gebruik."/>}{items&&items.length>0&&<div className="download-list">{items.map(item=><article key={item.id}><span className="status-icon status-blue"><UiIcon name="download"/></span><span><strong>{item.seriesTitle||item.title}</strong><small>{item.profile} · {item.status} · {Math.round(item.progress||0)}%</small>{item.error&&<em>{item.error}</em>}</span>{item.status==='completed'?<a className="primary" href={`/api/optimizations/${item.id}/download`}>Downloaden</a>:<span className={`download-state state-${item.status}`}>{item.status}</span>}</article>)}</div>}</section>;
}

export function PageTitle({eyebrow,title,meta,children}:{eyebrow:string;title:string;meta?:string;children?:ReactNode}){return <header className="reference-page-title"><div><p>{eyebrow}</p><h1>{title}</h1></div>{meta&&<span>{meta}</span>}{children}</header>}
export function LoadingSkeleton({rows=3}:{rows?:number}){return <div className="loading-skeleton" aria-label="Laden">{Array.from({length:rows},(_,index)=><span key={index}/>)}</div>}
export function EmptyState({icon='info',title,message,action}:{icon?:UiIconName;title:string;message:string;action?:ReactNode}){return <div className="reference-empty"><UiIcon name={icon}/><h2>{title}</h2><p>{message}</p>{action}</div>}
export function ErrorState({title,message,onRetry}:{title:string;message:string;onRetry?:()=>void}){return <div className="reference-error" role="alert"><UiIcon name="info"/><span><strong>{title}</strong><small>{message}</small></span>{onRetry&&<button onClick={onRetry}>Opnieuw proberen</button>}</div>}
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){return <div className="reference-modal-backdrop" onClick={event=>event.target===event.currentTarget&&onClose()}><section className="reference-modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label="Sluiten"><UiIcon name="close"/></button></header>{children}</section></div>}
export function Toast({message}:{message:string}){return <div className="reference-toast" role="status"><UiIcon name="check"/>{message}</div>}
export function SettingsSection({title,description,badge,children}:{title:string;description?:string;badge?:string;children:ReactNode}){return <section className="reference-settings-section"><header><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{badge&&<span>{badge}</span>}</header>{children}</section>}
