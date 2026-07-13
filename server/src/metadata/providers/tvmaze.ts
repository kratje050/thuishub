import { requestProviderJson } from '../http.js';
import { getProviderStatus as storedStatus, providerEnabled } from '../store.js';
import { parseFiniteNumber, parseYear, safeStringArray, sanitizeExternalText } from '../sanitize.js';
import type { MetadataExternalIds, MetadataImage, MetadataPerson, MetadataProvider, MetadataRating, MetadataRecord, MetadataSearchQuery, MetadataSeasonInfo } from '../types.js';

const BASE='https://api.tvmaze.com';
type TvmazeOptions={fetcher?:typeof fetch;sleep?:(ms:number)=>Promise<void>};

function asObject(value:unknown):Record<string,any>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};}
function validId(value:unknown){const id=Number(value);return Number.isInteger(id)&&id>0?String(id):''}
function tvImage(show:any):MetadataImage[]{const image=asObject(show?.image);return image.original?[{type:'poster',url:String(image.original),primary:true}]:image.medium?[{type:'poster',url:String(image.medium),primary:true}]:[]}
function ratingsFromShow(show:any):MetadataRating[]{const value=parseFiniteNumber(asObject(show?.rating).average);return value===undefined?[]:[{source:'TVmaze',value,maxValue:10}]}
function externalIds(show:any):MetadataExternalIds{const externals=asObject(show?.externals);return{imdb:typeof externals.imdb==='string'?externals.imdb:null,tvmaze:validId(show?.id)||null,thetvdb:validId(externals.thetvdb)||null}}
function mapShow(input:unknown):MetadataRecord|null{
  const show=asObject(input);const id=validId(show.id);const title=sanitizeExternalText(show.name,500);if(!id||!title)return null;
  const network=asObject(show.network);const web=asObject(show.webChannel);const premiered=typeof show.premiered==='string'?show.premiered:undefined;
  return{mediaType:'series',title,originalTitle:title,year:parseYear(premiered),premiered,summary:sanitizeExternalText(show.summary),runtimeMinutes:parseFiniteNumber(show.averageRuntime??show.runtime),genres:safeStringArray(show.genres),cast:[],crew:[],ratings:ratingsFromShow(show),language:sanitizeExternalText(show.language,100)||undefined,status:sanitizeExternalText(show.status,100)||undefined,network:sanitizeExternalText(network.name,200)||undefined,streamingService:sanitizeExternalText(web.name,200)||undefined,officialUrl:typeof show.officialSite==='string'?show.officialSite:undefined,images:tvImage(show),externalIds:externalIds(show),provider:'tvmaze',providerId:id,providerUrl:typeof show.url==='string'?show.url:undefined};
}
function mapEpisode(input:unknown,seriesId:string):MetadataRecord|null{
  const episode=asObject(input);const id=validId(episode.id);const title=sanitizeExternalText(episode.name,500);if(!id||!title)return null;const image=asObject(episode.image);const images:MetadataImage[]=image.original?[{type:'episode',url:String(image.original),primary:true}]:image.medium?[{type:'episode',url:String(image.medium),primary:true}]:[];
  return{mediaType:'episode',title,year:parseYear(episode.airdate),premiered:typeof episode.airdate==='string'?episode.airdate:undefined,aired:typeof episode.airdate==='string'?episode.airdate:undefined,summary:sanitizeExternalText(episode.summary),runtimeMinutes:parseFiniteNumber(episode.runtime),genres:[],cast:[],crew:[],ratings:parseFiniteNumber(asObject(episode.rating).average)===undefined?[]:[{source:'TVmaze',value:parseFiniteNumber(asObject(episode.rating).average)!,maxValue:10}],season:Number.isInteger(Number(episode.season))?Number(episode.season):undefined,episode:Number.isInteger(Number(episode.number))?Number(episode.number):undefined,images,externalIds:{tvmaze:seriesId},provider:'tvmaze',providerId:id,providerUrl:typeof episode.url==='string'?episode.url:undefined};
}

export class TvmazeProvider implements MetadataProvider{
  readonly id='tvmaze' as const;readonly label='TVmaze';readonly attribution='Metadata voor series geleverd door TVmaze';readonly informationUrl='https://www.tvmaze.com/api';
  constructor(private options:TvmazeOptions={}){}
  private request<T>(pathname:string,cacheKey=pathname){const url=new URL(pathname,BASE);return requestProviderJson<T>({provider:this.id,url,cacheKey,fetcher:this.options.fetcher,sleep:this.options.sleep})}
  async searchMovies(){return[]}
  async searchSeries(query:MetadataSearchQuery){if(!providerEnabled(this.id))return[];const path=`/search/shows?q=${encodeURIComponent(query.title)}`;const data=await this.request<any[]>(path,`search:${query.title.toLocaleLowerCase()}`);if(!Array.isArray(data))throw new Error('TVmaze gaf een ongeldige zoekresponse.');return data.map(item=>mapShow(asObject(item).show)).filter((item):item is MetadataRecord=>Boolean(item)).slice(0,20)}
  async getMovie(){return null}
  async getSeries(providerId:string){const id=validId(providerId);if(!id)return null;return mapShow(await this.request(`/shows/${id}`,`show:${id}`))}
  async getSeasons(seriesId:string){const id=validId(seriesId);if(!id)return[];const data=await this.request<any[]>(`/shows/${id}/seasons`,`seasons:${id}`);if(!Array.isArray(data))throw new Error('TVmaze gaf een ongeldige seizoensresponse.');return data.map(item=>{const season=asObject(item);const number=parseFiniteNumber(season.number);const providerId=validId(season.id);if(number===undefined||!providerId)return null;const image=tvImage(season)[0];return{providerId,number,episodeOrder:parseFiniteNumber(season.episodeOrder),premiereDate:typeof season.premiereDate==='string'?season.premiereDate:undefined,endDate:typeof season.endDate==='string'?season.endDate:undefined,image} as MetadataSeasonInfo}).filter((item):item is MetadataSeasonInfo=>item!==null)}
  async getAllEpisodes(seriesId:string){const id=validId(seriesId);if(!id)return[];const data=await this.request<any[]>(`/shows/${id}/episodes?specials=1`,`episodes:${id}`);if(!Array.isArray(data))throw new Error('TVmaze gaf een ongeldige afleveringsresponse.');return data.map(item=>mapEpisode(item,id)).filter((item):item is MetadataRecord=>item!==null)}
  async getSeason(seriesId:string,season:number){return(await this.getAllEpisodes(seriesId)).filter(item=>item.season===season)}
  async getEpisode(seriesId:string,season:number,episode:number){const records=await this.getSeason(seriesId,season);return records.find(item=>item.episode===episode)||null}
  async getCast(providerId:string){const id=validId(providerId);if(!id)return[];const data=await this.request<any[]>(`/shows/${id}/cast`,`cast:${id}`);if(!Array.isArray(data))throw new Error('TVmaze gaf ongeldige castgegevens.');return data.map((entry,index)=>{const item=asObject(entry);const person=asObject(item.person);const character=asObject(item.character);return{name:sanitizeExternalText(person.name,250),character:sanitizeExternalText(character.name,250)||undefined,order:index} as MetadataPerson}).filter(person=>person.name)}
  async getCrew(providerId:string){const id=validId(providerId);if(!id)return[];const data=await this.request<any[]>(`/shows/${id}/crew`,`crew:${id}`);if(!Array.isArray(data))throw new Error('TVmaze gaf ongeldige crewgegevens.');return data.map((entry,index)=>{const item=asObject(entry);return{name:sanitizeExternalText(asObject(item.person).name,250),role:sanitizeExternalText(item.type,100)||undefined,order:index} as MetadataPerson}).filter(person=>person.name)}
  async getImages(providerId:string){const id=validId(providerId);if(!id)return[];const data=await this.request<any[]>(`/shows/${id}/images`,`images:${id}`);if(!Array.isArray(data))throw new Error('TVmaze gaf ongeldige afbeeldingsgegevens.');return data.map(entry=>{const image=asObject(entry);const original=asObject(asObject(image.resolutions).original);const type=image.type==='poster'?'poster':image.type==='banner'?'banner':'backdrop';return original.url?{type,url:String(original.url),width:parseFiniteNumber(original.width),height:parseFiniteNumber(original.height),primary:Boolean(image.main)} as MetadataImage:null}).filter((image):image is MetadataImage=>Boolean(image))}
  async getRatings(providerId:string){const show=await this.getSeries(providerId);return show?.ratings||[]}
  async findByExternalId(ids:MetadataExternalIds){if(ids.tvmaze)return this.getSeries(ids.tvmaze);const key=ids.imdb?`imdb=${encodeURIComponent(ids.imdb)}`:ids.thetvdb?`thetvdb=${encodeURIComponent(ids.thetvdb)}`:'';if(!key)return null;try{return mapShow(await this.request(`/lookup/shows?${key}`,`lookup:${key}`))}catch(error){if(String(error).includes('HTTP 404'))return null;throw error}}
  async testConnection(){try{const show=await this.getSeries('1');return show?{ok:true,message:'TVmaze is bereikbaar.'}:{ok:false,message:'TVmaze gaf geen geldige serie terug.'}}catch(error){return{ok:false,message:error instanceof Error?error.message:'TVmaze is niet bereikbaar.'}}}
  getProviderStatus(){return storedStatus(this.id,true,providerEnabled(this.id))}
}

export const tvmazeInternals={mapShow,mapEpisode,externalIds};
