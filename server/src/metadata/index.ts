import { db, getSetting, setSetting } from '../db.js';
import { createBackup } from '../backup.js';
import { log } from '../logger.js';
import { applyMetadataRecord, metadataFieldStates, metadataHistory } from './apply.js';
import { cacheExternalImage, cacheLocalImage, findLocalArtwork, imageApiUrl, metadataImages } from './images.js';
import { chooseMetadataMatch, rankMetadataMatches } from './matching.js';
import { EmbeddedMetadataProvider } from './providers/embedded.js';
import { LocalNfoProvider } from './providers/local-nfo.js';
import { ManualMetadataProvider } from './providers/manual.js';
import { OmdbProvider } from './providers/omdb.js';
import { TvmazeProvider } from './providers/tvmaze.js';
import { metadataOperationalStatus, providerEnabled, providerOrder } from './store.js';
import type { MetadataExternalIds, MetadataItemContext, MetadataProvider, MetadataProviderId, MetadataRecord } from './types.js';

export const metadataProviders={
  tvmaze:new TvmazeProvider(),omdb:new OmdbProvider(),local_nfo:new LocalNfoProvider(),embedded:new EmbeddedMetadataProvider(),manual:new ManualMetadataProvider(),
} satisfies Record<MetadataProviderId,MetadataProvider>;

type MediaContext=MetadataItemContext&{mediaId:number;kind:'movie'|'episode';seriesTitle?:string;sourceId:number};

export function metadataContext(mediaId:number):MediaContext{
  const row=db.prepare(`SELECT m.id mediaId,m.kind,m.title,m.year,m.series_title seriesTitle,m.season,m.episode,m.absolute_episode absoluteEpisode,m.aired,m.file_path filePath,m.source_id sourceId,s.path sourcePath
    FROM media_items m JOIN sources s ON s.id=m.source_id WHERE m.id=?`).get(mediaId) as any;
  if(!row)throw Object.assign(new Error('Media niet gevonden.'),{status:404});
  return{...row,mediaType:row.kind==='movie'?'movie':undefined,title:row.kind==='episode'?row.seriesTitle||row.title:row.title,year:row.year||undefined,season:row.season??undefined,episode:row.episode??undefined};
}

function externalIds(mediaId:number){const ids:MetadataExternalIds={};for(const row of db.prepare('SELECT provider,external_id externalId FROM metadata_external_ids WHERE media_id=?').all(mediaId) as any[]){if(row.provider==='imdb')ids.imdb=row.externalId;else if(row.provider==='tvmaze')ids.tvmaze=row.externalId;else if(row.provider==='thetvdb')ids.thetvdb=row.externalId;else if(row.provider==='omdb')ids.omdb=row.externalId;else if(row.provider==='legacy_tmdb')ids.legacyTmdb=row.externalId}return ids}

async function hydrate(provider:MetadataProvider,record:MetadataRecord){
  const detailed=record.mediaType==='movie'?await provider.getMovie(record.providerId):await provider.getSeries(record.providerId);const value=detailed||record;
  const[cast,crew,images,ratings]=await Promise.all([provider.getCast(value.providerId),provider.getCrew(value.providerId),provider.getImages(value.providerId),provider.getRatings(value.providerId)]);
  return{...value,cast:cast.length?cast:value.cast,crew:crew.length?crew:value.crew,images:images.length?images:value.images,ratings:ratings.length?ratings:value.ratings};
}

export async function searchMetadata(mediaId:number,preferred?:MetadataProviderId){
  const context=metadataContext(mediaId);const ids=externalIds(mediaId);const query={title:context.title,year:context.year,mediaType:context.kind==='movie'?'movie' as const:'series' as const,imdbId:ids.imdb||undefined,tvmazeId:ids.tvmaze||undefined,thetvdbId:ids.thetvdb||undefined};
  const providerId=preferred||(context.kind==='movie'?'omdb':'tvmaze');const provider=metadataProviders[providerId];if(!provider||!providerEnabled(providerId))return{provider:providerId,query,results:[]};
  const records=context.kind==='movie'?await provider.searchMovies(query):await provider.searchSeries(query);const ranked=rankMetadataMatches(query,records);
  const results=await Promise.all(ranked.slice(0,10).map(async({item,...rank})=>{
    const candidate=item.images.find(image=>image.type==='poster'&&image.url)||item.images.find(image=>Boolean(image.url));let posterUrl:string|undefined;
    if(candidate)try{const cached=await cacheExternalImage(mediaId,candidate,item.provider,fetch,false,false);posterUrl=`/api/metadata/images/${cached.id}`}catch{/* Een onbereikbare poster mag zoeken en handmatig kiezen niet blokkeren. */}
    return{record:{...item,images:[]},posterUrl,...rank};
  }));
  return{provider:providerId,query,results};
}

async function applySeriesMatch(context:MediaContext,record:MetadataRecord,confidence:string,mode:'missing'|'refresh'='refresh'){
  const provider:MetadataProvider=metadataProviders[record.provider];const show=await hydrate(provider,record);const rows=db.prepare('SELECT id,season,episode,absolute_episode absoluteEpisode,aired FROM media_items WHERE kind=\'episode\' AND source_id=? AND series_title=? ORDER BY season,episode,id').all(context.sourceId,context.seriesTitle) as any[];
  for(let index=0;index<rows.length;index++)await applyMetadataRecord(rows[index].id,{...show,images:index===0?show.images:[]},{mode,preserveTitle:true,context:metadataContext(rows[index].id),confidence});
  const bySeason=new Map<number,MetadataRecord[]>();let allEpisodes:MetadataRecord[]|null=null;
  for(const row of rows){let episode:MetadataRecord|undefined;if(Number.isInteger(row.season)&&Number.isInteger(row.episode)){if(!bySeason.has(row.season))bySeason.set(row.season,await provider.getSeason(show.providerId,row.season));episode=bySeason.get(row.season)!.find(item=>item.episode===row.episode)}else if(provider.getAllEpisodes){if(!allEpisodes)allEpisodes=await provider.getAllEpisodes(show.providerId);episode=row.aired?allEpisodes.find(item=>item.aired===row.aired):row.absoluteEpisode?allEpisodes[row.absoluteEpisode-1]:undefined}if(episode)await applyMetadataRecord(row.id,episode,{mode,context:metadataContext(row.id),confidence})}
  return{matched:rows.length,provider:show.provider,providerId:show.providerId};
}

export async function applyProviderMatch(mediaId:number,providerId:MetadataProviderId,providerRecordId:string,confidence='very_certain',mode:'missing'|'refresh'='refresh'){
  const context=metadataContext(mediaId);const provider=metadataProviders[providerId];if(!provider||!providerEnabled(providerId))throw Object.assign(new Error('Deze metadataprovider is niet beschikbaar.'),{status:409});
  const record=context.kind==='movie'?await provider.getMovie(providerRecordId):await provider.getSeries(providerRecordId);if(!record)throw Object.assign(new Error('Het gekozen metadataresultaat bestaat niet meer.'),{status:404});
  if(context.kind==='episode')return applySeriesMatch(context,record,confidence,mode);const detailed=await hydrate(provider,record);return applyMetadataRecord(mediaId,detailed,{mode,context,confidence});
}

async function cacheDiscoveredArtwork(context:MediaContext){
  const local=findLocalArtwork({filePath:context.filePath!,sourcePath:context.sourcePath!,kind:context.kind,season:context.season});
  for(const[type,file]of Object.entries(local))try{await cacheLocalImage(context.mediaId,type as any,file,context.sourcePath!)}catch{/* Een ongeldige afbeelding blokkeert de scan niet. */}
}

export async function applyLocalMetadata(mediaId:number,nfoMode:'missing'|'refresh'='refresh'){
  const context=metadataContext(mediaId);const nfo=await metadataProviders.local_nfo.readForContext(context);let applied=0;
  if(nfo.seriesRecord&&context.kind==='episode'){const rows=db.prepare('SELECT id FROM media_items WHERE source_id=? AND series_title=?').all(context.sourceId,context.seriesTitle) as any[];for(const row of rows){await applyMetadataRecord(row.id,{...nfo.seriesRecord,images:row.id===mediaId?nfo.seriesRecord.images:[]},{mode:nfoMode,preserveTitle:true,context:metadataContext(row.id),confidence:'very_certain'});applied++}}
  if(nfo.record){await applyMetadataRecord(mediaId,nfo.record,{mode:nfoMode,context,confidence:'very_certain'});applied++}
  const embedded=metadataProviders.embedded.readForContext(context);if(embedded){await applyMetadataRecord(mediaId,embedded,{mode:'missing',context,confidence:'very_certain'});applied++}
  await cacheDiscoveredArtwork(context);return{mediaId,applied,files:nfo.files};
}

function queued(mediaId:number){return Boolean(db.prepare("SELECT 1 FROM metadata_queue WHERE media_id=? AND status IN ('queued','processing')").get(mediaId))}
export function enqueueMetadata(mediaId:number,operation='fill_missing',preferredProvider?:MetadataProviderId){if(queued(mediaId))return false;db.prepare("DELETE FROM metadata_queue WHERE media_id=? AND operation=? AND status='completed'").run(mediaId,operation);const reusable=db.prepare("SELECT id FROM metadata_queue WHERE media_id=? AND status IN ('error','review') ORDER BY id DESC LIMIT 1").get(mediaId) as any;if(reusable)db.prepare("UPDATE metadata_queue SET operation=?,preferred_provider=?,status='queued',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(operation,preferredProvider||null,reusable.id);else db.prepare('INSERT INTO metadata_queue(media_id,operation,preferred_provider) VALUES(?,?,?)').run(mediaId,operation,preferredProvider||null);return true}

export async function enqueueMissingMetadata(){
  const rows=db.prepare(`SELECT m.id,m.kind,m.source_id sourceId,m.series_title seriesTitle FROM media_items m
    WHERE m.metadata_provider IS NULL OR m.metadata_last_refreshed IS NULL ORDER BY m.kind,m.series_title,m.id`).all() as any[];const series=new Set<string>();let local=0,online=0;const strategy=getSetting('metadataStrategy','local_first');
  for(const row of rows){if(strategy!=='online_first'){await applyLocalMetadata(row.id);local++}if(strategy==='local_only')continue;if(row.kind==='episode'){const key=`${row.sourceId}:${row.seriesTitle}`;if(series.has(key))continue;series.add(key)}if(enqueueMetadata(row.id))online++}
  return{local,online};
}

async function processQueueItem(queue:any){
  const context=metadataContext(queue.media_id);const choices=(queue.preferred_provider?[queue.preferred_provider as MetadataProviderId]:providerOrder(context.kind==='movie'?'movie':'series')).filter(id=>id==='omdb'||id==='tvmaze');const ids=externalIds(context.mediaId);const query={title:context.title,year:context.year,mediaType:context.kind==='movie'?'movie' as const:'series' as const,imdbId:ids.imdb||undefined,tvmazeId:ids.tvmaze||undefined,thetvdbId:ids.thetvdb||undefined};let lastReason='Geen providerresultaat gevonden.';
  for(const preferred of choices){
    const provider=metadataProviders[preferred];if(!providerEnabled(preferred)||!provider.getProviderStatus().configured)continue;
    try{
      const candidates=context.kind==='movie'?await provider.searchMovies(query):await provider.searchSeries(query);const choice=chooseMetadataMatch(query,candidates);lastReason=choice.reason;if(!choice.match||choice.confidence==='none')continue;
      if(choice.confidence==='review'){db.prepare("UPDATE metadata_queue SET status='review',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(choice.reason,queue.id);db.prepare('UPDATE media_items SET metadata_needs_review=1,metadata_match_confidence=? WHERE id=?').run(choice.confidence,context.mediaId);return{status:'review',reason:choice.reason}}
      await applyProviderMatch(context.mediaId,preferred,choice.match.providerId,choice.confidence,queue.operation==='fill_missing'||queue.operation==='images'?'missing':'refresh');if(getSetting('metadataStrategy','local_first')==='online_first')await applyLocalMetadata(context.mediaId,'missing');db.prepare("UPDATE metadata_queue SET status='completed',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(queue.id);return{status:'completed'};
    }catch(error){lastReason=error instanceof Error?error.message:String(error);log('WARNING','application','Metadataprovider tijdelijk overgeslagen; fallback wordt geprobeerd.',{mediaId:context.mediaId,provider:preferred,error:lastReason.slice(0,500)})}
  }
  const fallback=await applyLocalMetadata(context.mediaId);if(fallback.applied){db.prepare("UPDATE metadata_queue SET status='completed',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(queue.id);return{status:'completed',fallback:'local'}}db.prepare("UPDATE metadata_queue SET status='review',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(lastReason,queue.id);db.prepare("UPDATE media_items SET metadata_needs_review=1,metadata_match_confidence='none' WHERE id=?").run(context.mediaId);return{status:'review',reason:lastReason};
}

let processing=false;
export async function processMetadataQueue(limit=20){if(processing)return{processed:0,busy:true};processing=true;let processed=0,errors=0;try{const rows=db.prepare("SELECT * FROM metadata_queue WHERE status='queued' ORDER BY id LIMIT ?").all(Math.max(1,Math.min(100,limit))) as any[];for(const row of rows){db.prepare("UPDATE metadata_queue SET status='processing',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);try{await processQueueItem(row)}catch(error){errors++;db.prepare("UPDATE metadata_queue SET status='error',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run((error instanceof Error?error.message:String(error)).slice(0,500),row.id);log('WARNING','application','Metadatawachtrij-item mislukt.',{mediaId:row.media_id,provider:row.preferred_provider||undefined,error:error instanceof Error?error.message:String(error)})}processed++}return{processed,errors}}finally{processing=false}}

let worker:NodeJS.Timeout|null=null;
export function startMetadataQueueWorker(){if(worker)return;worker=setInterval(()=>void processMetadataQueue(10),60_000);worker.unref();setTimeout(()=>void processMetadataQueue(10),5_000).unref()}

export function retryMetadataQueue(){const rows=db.prepare("SELECT id,media_id mediaId FROM metadata_queue WHERE status IN ('error','review') ORDER BY id DESC").all() as any[];let changed=0;for(const row of rows){if(queued(row.mediaId))db.prepare('DELETE FROM metadata_queue WHERE id=?').run(row.id);else{db.prepare("UPDATE metadata_queue SET status='queued',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);changed++}}void processMetadataQueue(20);return changed}

export async function processMetadataMedia(mediaId:number,operation='refresh',preferred?:MetadataProviderId){enqueueMetadata(mediaId,operation,preferred);const row=db.prepare("SELECT * FROM metadata_queue WHERE media_id=? AND status='queued' ORDER BY id DESC LIMIT 1").get(mediaId) as any;if(!row)return{status:'busy'};db.prepare("UPDATE metadata_queue SET status='processing',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);try{return await processQueueItem(row)}catch(error){db.prepare("UPDATE metadata_queue SET status='error',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run((error instanceof Error?error.message:String(error)).slice(0,500),row.id);throw error}}

export function metadataStatusForMedia(mediaId:number){const row=db.prepare('SELECT metadata_provider provider,metadata_last_refreshed lastRefreshed,metadata_match_confidence confidence,metadata_needs_review needsReview FROM media_items WHERE id=?').get(mediaId) as any;if(!row)throw Object.assign(new Error('Media niet gevonden.'),{status:404});return{...row,needsReview:Boolean(row.needsReview),externalIds:externalIds(mediaId),fields:metadataFieldStates(mediaId),history:metadataHistory(mediaId),images:metadataImages(mediaId),posterUrl:imageApiUrl(mediaId,'poster'),backdropUrl:imageApiUrl(mediaId,'backdrop'),episodeImageUrl:imageApiUrl(mediaId,'episode')}}

export async function migrateLegacyTmdbMetadata(){
  if(getSetting('metadataProviderMigrationCompleted')==='true')return{status:'already-completed'};const run=db.prepare("INSERT INTO metadata_migration_runs(status) VALUES('running')").run();const runId=Number(run.lastInsertRowid);
  try{const backup=await createBackup('emergency');const rows=db.prepare('SELECT id,tmdb_id,overview,poster_path,backdrop_path FROM media_items WHERE tmdb_id IS NOT NULL OR overview IS NOT NULL OR poster_path IS NOT NULL OR backdrop_path IS NOT NULL').all() as any[];let ids=0,fields=0;
    const transaction=db.transaction(()=>{for(const row of rows){if(row.tmdb_id){db.prepare(`INSERT INTO metadata_external_ids(media_id,provider,external_id,legacy) VALUES(?,?,?,1) ON CONFLICT(media_id,provider) DO UPDATE SET external_id=excluded.external_id,legacy=1`).run(row.id,'legacy_tmdb',String(row.tmdb_id));ids++}for(const[field,value]of [['summary',row.overview],['legacyPosterPath',row.poster_path],['legacyBackdropPath',row.backdrop_path]] as const)if(value){db.prepare(`INSERT INTO metadata_field_state(media_id,field_name,provider,value_json,manually_modified,auto_overwrite) VALUES(?,?, 'legacy_tmdb',?,0,1) ON CONFLICT(media_id,field_name) DO NOTHING`).run(row.id,field,JSON.stringify(value));fields++}}db.prepare("DELETE FROM settings WHERE key='tmdbToken'").run()});transaction();
    const staged=await enqueueMissingMetadata();setSetting('metadataProviderMigrationCompleted','true');const preservedLocalImages=Number((db.prepare('SELECT COUNT(*) count FROM metadata_images WHERE local_path IS NOT NULL').get() as any).count||0);const needsReview=Number((db.prepare('SELECT COUNT(*) count FROM media_items WHERE metadata_needs_review=1').get() as any).count||0);const totalMediaItems=Number((db.prepare('SELECT COUNT(*) count FROM media_items').get() as any).count||0);const report={status:'completed',backup:backup.name,items:rows.length,totalMediaItems,legacyIds:ids,preservedFields:fields,moviesLinkedToOmdb:0,seriesLinkedToTvmaze:0,episodesLinked:0,itemsWithExistingMetadataOnly:rows.length,needsReview,failedRequests:0,preservedLocalImages,stagedForMatching:staged.online,locallyInspected:staged.local,tmdbRequests:0};db.prepare("UPDATE metadata_migration_runs SET status='completed',report_json=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(report),runId);return report;
  }catch(error){const report={status:'error',error:error instanceof Error?error.message:String(error)};db.prepare("UPDATE metadata_migration_runs SET status='error',report_json=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(report),runId);throw error}
}

export function metadataDashboard(){return{...metadataOperationalStatus(),providers:Object.values(metadataProviders).map(provider=>provider.getProviderStatus()),recentErrors:db.prepare("SELECT q.id,q.media_id mediaId,m.title,q.error,q.updated_at updatedAt FROM metadata_queue q JOIN media_items m ON m.id=q.media_id WHERE q.status='error' ORDER BY q.updated_at DESC LIMIT 20").all()}}
