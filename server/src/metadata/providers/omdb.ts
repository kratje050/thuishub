import { requestProviderJson } from '../http.js';
import { getProviderStatus as storedStatus, providerEnabled, recordProviderResult } from '../store.js';
import { getOmdbApiKey } from '../secrets.js';
import { parseFiniteNumber, parseYear, safeStringArray, sanitizeExternalText } from '../sanitize.js';
import type { MetadataExternalIds, MetadataImage, MetadataPerson, MetadataProvider, MetadataRating, MetadataRecord, MetadataSearchQuery } from '../types.js';

const BASE='https://www.omdbapi.com/';
type OmdbOptions={fetcher?:typeof fetch;sleep?:(ms:number)=>Promise<void>};
function asObject(value:unknown):Record<string,any>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};}
function validImdb(value:unknown){const id=String(value??'');return /^tt\d{7,10}$/i.test(id)?id.toLowerCase():''}
function valueOrUndefined(value:unknown,max=2000){const clean=sanitizeExternalText(value,max);return clean&&clean!=='N/A'?clean:undefined}
function parseRuntime(value:unknown){const match=String(value??'').match(/(\d+)\s*min/i);return match?Number(match[1]):undefined}
function parseRatings(data:any):MetadataRating[]{
  const ratings:MetadataRating[]=[];const imdb=parseFiniteNumber(data.imdbRating);if(imdb!==undefined)ratings.push({source:'IMDb',value:imdb,maxValue:10,votes:Number(String(data.imdbVotes||'').replace(/[^0-9]/g,''))||undefined});
  const meta=parseFiniteNumber(data.Metascore);if(meta!==undefined)ratings.push({source:'Metacritic',value:meta,maxValue:100});
  for(const row of Array.isArray(data.Ratings)?data.Ratings:[]){const item=asObject(row);if(!item.Source||!item.Value||ratings.some(r=>r.source===item.Source))continue;const match=String(item.Value).match(/^([\d.]+)\s*\/\s*([\d.]+)/);const percent=String(item.Value).match(/^(\d+)%$/);if(match)ratings.push({source:sanitizeExternalText(item.Source,100),value:Number(match[1]),maxValue:Number(match[2])});else if(percent)ratings.push({source:sanitizeExternalText(item.Source,100),value:Number(percent[1]),maxValue:100})}
  return ratings;
}
function people(value:unknown,role?:string):MetadataPerson[]{return safeStringArray(value).map((name,index)=>({name,role,order:index}))}
function mapOmdb(input:unknown):MetadataRecord|null{
  const data=asObject(input);if(String(data.Response).toLowerCase()==='false')return null;const id=validImdb(data.imdbID);const title=valueOrUndefined(data.Title,500);if(!id||!title)return null;const type=String(data.Type).toLowerCase();const mediaType=type==='series'?'series':type==='episode'?'episode':'movie';const poster=valueOrUndefined(data.Poster,2000);const images:MetadataImage[]=poster?[{type:mediaType==='episode'?'episode':'poster',url:poster,primary:true}]:[];
  return{mediaType,title,originalTitle:title,year:parseYear(data.Year),premiered:valueOrUndefined(data.Released,100),summary:valueOrUndefined(data.Plot,20_000),runtimeMinutes:parseRuntime(data.Runtime),genres:safeStringArray(data.Genre),cast:people(data.Actors),crew:[...people(data.Director,'Director'),...people(data.Writer,'Writer')],ratings:parseRatings(data),contentRating:valueOrUndefined(data.Rated,100),originalContentRating:valueOrUndefined(data.Rated,100),language:valueOrUndefined(data.Language,200),country:valueOrUndefined(data.Country,300),studio:valueOrUndefined(data.Production,300),awards:valueOrUndefined(data.Awards,1000),season:Number.isInteger(Number(data.Season))?Number(data.Season):undefined,episode:Number.isInteger(Number(data.Episode))?Number(data.Episode):undefined,images,externalIds:{imdb:id,omdb:id},provider:'omdb',providerId:id,providerUrl:`https://www.imdb.com/title/${id}/`};
}

export class OmdbProvider implements MetadataProvider{
  readonly id='omdb' as const;readonly label='OMDb';readonly attribution='Filmgegevens geleverd door OMDb';readonly informationUrl='https://www.omdbapi.com/';
  constructor(private options:OmdbOptions={}){}
  private async request(params:Record<string,string>,cacheKey:string){
    const key=getOmdbApiKey();if(!key)throw Object.assign(new Error('OMDb is optioneel en er is geen API-key ingesteld.'),{status:409});const status=this.getProviderStatus();if(status.remainingLocalRequests===0)throw Object.assign(new Error('De lokale OMDb-daglimiet is bereikt.'),{status:429});
    const url=new URL(BASE);url.searchParams.set('apikey',key);for(const[name,value]of Object.entries(params))if(value)url.searchParams.set(name,value);
    const data=await requestProviderJson<any>({provider:this.id,url,cacheKey,fetcher:this.options.fetcher,sleep:this.options.sleep});
    if(String(data?.Response).toLowerCase()==='false'){const message=valueOrUndefined(data?.Error,500)||'OMDb heeft geen resultaat gevonden.';if(/api key|limit/i.test(message))recordProviderResult(this.id,{error:message});throw Object.assign(new Error(message),{status:/limit/i.test(message)?429:/api key/i.test(message)?401:404})}
    return data;
  }
  async searchMovies(query:MetadataSearchQuery){return this.search(query,'movie')}
  async searchSeries(query:MetadataSearchQuery){return this.search(query,'series')}
  private async search(query:MetadataSearchQuery,type:'movie'|'series'){
    if(!providerEnabled(this.id)||!getOmdbApiKey())return[];if(query.imdbId){const item=await this.findByExternalId({imdb:query.imdbId});return item?[item]:[]}
    const params:Record<string,string>={s:query.title,type};if(query.year)params.y=String(query.year);const data=await this.request(params,`search:${type}:${query.title.toLocaleLowerCase()}:${query.year||''}`);if(!Array.isArray(data.Search))throw new Error('OMDb gaf een ongeldige zoekresponse.');return data.Search.map((item:any)=>mapOmdb({...item,Response:'True'})).filter((item:any):item is MetadataRecord=>Boolean(item)).slice(0,10);
  }
  async getMovie(providerId:string){const id=validImdb(providerId);if(!id)return null;return mapOmdb(await this.request({i:id,type:'movie',plot:'full'},`title:${id}`))}
  async getSeries(providerId:string){const id=validImdb(providerId);if(!id)return null;return mapOmdb(await this.request({i:id,type:'series',plot:'full'},`title:${id}`))}
  async getSeason(seriesId:string,season:number){const id=validImdb(seriesId);if(!id)return[];const data=await this.request({i:id,Season:String(season)},`season:${id}:${season}`);if(!Array.isArray(data.Episodes))return[];return data.Episodes.map((episode:any)=>mapOmdb({...episode,Type:'episode',Response:'True'})).filter((item:any):item is MetadataRecord=>Boolean(item))}
  async getEpisode(seriesId:string,season:number,episode:number){const id=validImdb(seriesId);if(!id)return null;return mapOmdb(await this.request({i:id,Season:String(season),Episode:String(episode),plot:'full'},`episode:${id}:${season}:${episode}`))}
  async getCast(providerId:string){const item=await this.getByType(providerId);return item?.cast||[]}
  async getCrew(providerId:string){const item=await this.getByType(providerId);return item?.crew||[]}
  async getImages(providerId:string){const item=await this.getByType(providerId);return item?.images||[]}
  async getRatings(providerId:string){const item=await this.getByType(providerId);return item?.ratings||[]}
  private async getByType(providerId:string){const id=validImdb(providerId);if(!id)return null;return mapOmdb(await this.request({i:id,plot:'full'},`title:${id}`))}
  async findByExternalId(ids:MetadataExternalIds){const id=validImdb(ids.imdb||ids.omdb);return id?this.getByType(id):null}
  async testConnection(){if(!getOmdbApiKey())return{ok:false,message:'Voeg eerst lokaal een OMDb API-key toe.'};try{const item=await this.getMovie('tt0133093');return item?{ok:true,message:'OMDb is bereikbaar en de API-key werkt.'}:{ok:false,message:'OMDb gaf geen geldig testresultaat.'}}catch(error){return{ok:false,message:error instanceof Error?error.message:'OMDb is niet bereikbaar.'}}}
  getProviderStatus(){const configured=Boolean(getOmdbApiKey());return storedStatus(this.id,configured,configured&&providerEnabled(this.id))}
}

export const omdbInternals={mapOmdb,parseRatings,validImdb,parseRuntime};
