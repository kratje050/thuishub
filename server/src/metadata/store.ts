import { db, getSetting, setSetting } from '../db.js';
import type { MetadataProviderId, ProviderStatus } from './types.js';

const LABELS:Record<MetadataProviderId,string>={tvmaze:'TVmaze',omdb:'OMDb',local_nfo:'Lokale NFO',embedded:'Ingebedde metadata',manual:'Handmatige metadata'};
const ATTRIBUTION:Partial<Record<MetadataProviderId,string>>={tvmaze:'Metadata voor series geleverd door TVmaze',omdb:'Filmgegevens geleverd door OMDb'};
const INFORMATION:Partial<Record<MetadataProviderId,string>>={tvmaze:'https://www.tvmaze.com/api',omdb:'https://www.omdbapi.com/',local_nfo:'https://kodi.wiki/view/NFO_files'};
const today=()=>new Date().toISOString().slice(0,10);

export function providerEnabled(provider:MetadataProviderId){
  if(provider==='manual')return true;
  return getSetting(`metadataProvider.${provider}.enabled`,'true')==='true';
}

export function setProviderEnabled(provider:MetadataProviderId,enabled:boolean){
  if(provider==='manual'&&!enabled)throw Object.assign(new Error('Handmatige metadata kan niet worden uitgeschakeld.'),{status:400});
  setSetting(`metadataProvider.${provider}.enabled`,String(enabled));
  db.prepare(`INSERT INTO metadata_provider_state(provider,enabled) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET enabled=excluded.enabled,updated_at=CURRENT_TIMESTAMP`).run(provider,Number(enabled));
}

export function recordProviderResult(provider:MetadataProviderId,result:{success?:boolean;error?:string;cacheHit?:boolean;cacheMiss?:boolean;rateLimitedUntil?:string|null}){
  db.prepare(`INSERT INTO metadata_provider_usage(provider,usage_date,requests,cache_hits,cache_misses,failures) VALUES(?,?,?,?,?,?)
    ON CONFLICT(provider,usage_date) DO UPDATE SET requests=requests+excluded.requests,cache_hits=cache_hits+excluded.cache_hits,cache_misses=cache_misses+excluded.cache_misses,failures=failures+excluded.failures`).run(provider,today(),result.cacheHit?0:result.cacheMiss?1:0,Number(Boolean(result.cacheHit)),Number(Boolean(result.cacheMiss)),Number(Boolean(result.error)));
  if(result.success)db.prepare(`INSERT INTO metadata_provider_state(provider,enabled,last_success_at,last_error,last_error_at,rate_limited_until) VALUES(?,1,CURRENT_TIMESTAMP,NULL,NULL,NULL)
    ON CONFLICT(provider) DO UPDATE SET last_success_at=CURRENT_TIMESTAMP,last_error=NULL,last_error_at=NULL,rate_limited_until=NULL,updated_at=CURRENT_TIMESTAMP`).run(provider);
  if(result.error)db.prepare(`INSERT INTO metadata_provider_state(provider,enabled,last_error_at,last_error,rate_limited_until) VALUES(?,1,CURRENT_TIMESTAMP,?,?)
    ON CONFLICT(provider) DO UPDATE SET last_error_at=CURRENT_TIMESTAMP,last_error=excluded.last_error,rate_limited_until=excluded.rate_limited_until,updated_at=CURRENT_TIMESTAMP`).run(provider,result.error.slice(0,500),result.rateLimitedUntil||null);
}

export function getProviderStatus(provider:MetadataProviderId,configured=true,available=true):ProviderStatus{
  const state=db.prepare('SELECT * FROM metadata_provider_state WHERE provider=?').get(provider) as any;
  const usage=db.prepare('SELECT requests,cache_hits cacheHits,cache_misses cacheMisses,failures FROM metadata_provider_usage WHERE provider=? AND usage_date=?').get(provider,today()) as any||{};
  const localDailyLimit=provider==='omdb'?Number(getSetting('omdbLocalDailyLimit','1000')):undefined;
  return{id:provider,label:LABELS[provider],enabled:providerEnabled(provider),configured,available,attribution:ATTRIBUTION[provider],informationUrl:INFORMATION[provider],lastSuccessAt:state?.last_success_at,lastErrorAt:state?.last_error_at,lastError:state?.last_error,rateLimitedUntil:state?.rate_limited_until,requestsToday:Number(usage.requests||0),cacheHits:Number(usage.cacheHits||0),cacheMisses:Number(usage.cacheMisses||0),failures:Number(usage.failures||0),localDailyLimit,remainingLocalRequests:localDailyLimit===undefined?undefined:Math.max(0,localDailyLimit-Number(usage.requests||0))};
}

export function cachedProviderPayload(provider:MetadataProviderId,key:string,allowExpired=false){
  const row=db.prepare('SELECT payload_json payloadJson,etag,last_modified lastModified,expires_at expiresAt FROM metadata_provider_cache WHERE provider=? AND cache_key=?').get(provider,key) as any;
  if(!row)return null;
  const expired=Date.parse(row.expiresAt)<=Date.now();if(expired&&!allowExpired)return null;
  try{return{payload:JSON.parse(row.payloadJson),etag:row.etag||undefined,lastModified:row.lastModified||undefined,expired}}catch{return null}
}

export function storeProviderPayload(provider:MetadataProviderId,key:string,payload:unknown,headers:Headers,cacheDays=Number(getSetting('metadataCacheDays','14'))){
  const expiresAt=new Date(Date.now()+Math.max(1,Math.min(365,cacheDays))*86_400_000).toISOString();
  db.prepare(`INSERT INTO metadata_provider_cache(provider,cache_key,payload_json,etag,last_modified,status_code,stored_at,expires_at) VALUES(?,?,?,?,?,200,CURRENT_TIMESTAMP,?)
    ON CONFLICT(provider,cache_key) DO UPDATE SET payload_json=excluded.payload_json,etag=excluded.etag,last_modified=excluded.last_modified,status_code=200,stored_at=CURRENT_TIMESTAMP,expires_at=excluded.expires_at`).run(provider,key,JSON.stringify(payload),headers.get('etag'),headers.get('last-modified'),expiresAt);
}

export function refreshCachedProviderPayload(provider:MetadataProviderId,key:string,cacheDays=Number(getSetting('metadataCacheDays','14'))){
  const expiresAt=new Date(Date.now()+Math.max(1,Math.min(365,cacheDays))*86_400_000).toISOString();
  db.prepare('UPDATE metadata_provider_cache SET stored_at=CURRENT_TIMESTAMP,expires_at=? WHERE provider=? AND cache_key=?').run(expiresAt,provider,key);
}

export function clearProviderCache(provider?:MetadataProviderId){return provider?db.prepare('DELETE FROM metadata_provider_cache WHERE provider=?').run(provider).changes:db.prepare('DELETE FROM metadata_provider_cache').run().changes}

export function metadataOperationalStatus(){
  const counts=db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN metadata_needs_review=1 THEN 1 ELSE 0 END) review,SUM(CASE WHEN metadata_provider IS NULL THEN 1 ELSE 0 END) unmatched FROM media_items`).get() as any;
  const queue=db.prepare(`SELECT SUM(CASE WHEN status IN ('queued','processing') THEN 1 ELSE 0 END) pending,SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) errors FROM metadata_queue`).get() as any;
  return{items:Number(counts.total||0),unmatched:Number(counts.unmatched||0),needsReview:Number(counts.review||0),queue:Number(queue.pending||0),queueErrors:Number(queue.errors||0)};
}

export function providerOrder(kind:'movie'|'series'){
  const fallback=kind==='movie'?['manual','local_nfo','omdb','embedded']:['manual','local_nfo','tvmaze','embedded','omdb'];
  try{
    const parsed=JSON.parse(getSetting(`metadataProviderOrder.${kind}`,JSON.stringify(fallback)));
    const valid=(Array.isArray(parsed)?parsed:[]).filter((value):value is MetadataProviderId=>fallback.includes(value));
    return [...new Set([...valid,...fallback])] as MetadataProviderId[];
  }catch{return fallback as MetadataProviderId[]}
}

export function setProviderOrder(kind:'movie'|'series',order:MetadataProviderId[]){
  const allowed:MetadataProviderId[]=kind==='movie'?['manual','local_nfo','omdb','embedded']:['manual','local_nfo','tvmaze','embedded','omdb'];
  const clean=[...new Set(order.filter(item=>allowed.includes(item)))];if(clean.length!==allowed.length)throw Object.assign(new Error('De provider-volgorde is onvolledig.'),{status:400});
  setSetting(`metadataProviderOrder.${kind}`,JSON.stringify(clean));
}
