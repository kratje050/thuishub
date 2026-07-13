import { db } from '../../db.js';
import { getProviderStatus as storedStatus } from '../store.js';
import { EMPTY_METHODS, type MetadataProvider, type MetadataRecord } from '../types.js';

function parseJsonArray(value:unknown){try{const parsed=JSON.parse(String(value||'[]'));return Array.isArray(parsed)?parsed:[]}catch{return[]}}
export class ManualMetadataProvider implements MetadataProvider{
  readonly id='manual' as const;readonly label='Handmatige metadata';
  recordForMedia(mediaId:number):MetadataRecord|null{const row=db.prepare('SELECT * FROM media_items WHERE id=?').get(mediaId) as any;if(!row)return null;return{mediaType:row.kind==='movie'?'movie':'episode',title:row.title,originalTitle:row.original_title||undefined,sortTitle:row.sort_title,year:row.year||undefined,premiered:row.premiered||undefined,summary:row.overview||undefined,runtimeMinutes:row.metadata_runtime_minutes||undefined,genres:parseJsonArray(row.genres),cast:parseJsonArray(row.cast_json),crew:[...parseJsonArray(row.directors).map((name:string)=>({name,role:'Director'})),...parseJsonArray(row.writers).map((name:string)=>({name,role:'Writer'}))],ratings:parseJsonArray(row.ratings_json),contentRating:row.content_rating||undefined,originalContentRating:row.original_content_rating||undefined,language:row.metadata_language||undefined,country:row.metadata_country||undefined,studio:row.studio||undefined,officialUrl:row.official_url||undefined,tagline:row.tagline||undefined,season:row.season||undefined,episode:row.episode||undefined,images:[],externalIds:{legacyTmdb:row.tmdb_id?String(row.tmdb_id):null},provider:'manual',providerId:String(mediaId)} }
  searchMovies=EMPTY_METHODS.searchMovies;searchSeries=EMPTY_METHODS.searchSeries;getMovie=EMPTY_METHODS.getMovie;getSeries=EMPTY_METHODS.getSeries;getSeason=EMPTY_METHODS.getSeason;getEpisode=EMPTY_METHODS.getEpisode;getCast=EMPTY_METHODS.getCast;getCrew=EMPTY_METHODS.getCrew;getImages=EMPTY_METHODS.getImages;getRatings=EMPTY_METHODS.getRatings;findByExternalId=EMPTY_METHODS.findByExternalId;
  async testConnection(){return{ok:true,message:'De handmatige metadata-editor is beschikbaar.'}}
  getProviderStatus(){return storedStatus(this.id,true,true)}
}
