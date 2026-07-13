import path from 'node:path';
import { db } from '../../db.js';
import { getProviderStatus as storedStatus, providerEnabled } from '../store.js';
import { EMPTY_METHODS, type MetadataItemContext, type MetadataProvider, type MetadataRecord } from '../types.js';
import { parseFiniteNumber, parseYear, safeStringArray, sanitizeExternalText } from '../sanitize.js';

function tagsFromProbe(value:unknown){
  try{const probe=typeof value==='string'?JSON.parse(value):value as any;return{...(probe?.format?.tags||{}),...(Array.isArray(probe?.streams)?probe.streams.find((stream:any)=>stream?.codec_type==='video')?.tags||{}:{})}}catch{return{}}
}
function embeddedRecord(context:MetadataItemContext,probeJson:unknown):MetadataRecord|null{
  const tags=tagsFromProbe(probeJson) as any;const title=sanitizeExternalText(tags.title,500);if(!title)return null;const mediaType=context.mediaType==='movie'?'movie':'episode';
  return{mediaType,title,originalTitle:sanitizeExternalText(tags.original_title,500)||undefined,sortTitle:sanitizeExternalText(tags.sort_name,500)||undefined,year:parseYear(tags.date??tags.year),summary:sanitizeExternalText(tags.description??tags.synopsis??tags.comment)||undefined,genres:safeStringArray(tags.genre),cast:[],crew:[],ratings:[],language:sanitizeExternalText(tags.language,100)||undefined,season:parseFiniteNumber(tags.season_number??context.season),episode:parseFiniteNumber(tags.episode_id??tags.episode_sort??context.episode),images:[],externalIds:{},provider:'embedded',providerId:context.filePath?path.basename(context.filePath):String(context.mediaId||'embedded')};
}

export class EmbeddedMetadataProvider implements MetadataProvider{
  readonly id='embedded' as const;readonly label='Ingebedde metadata';
  readForContext(context:MetadataItemContext){if(!providerEnabled(this.id)||!context.mediaId)return null;const row=db.prepare('SELECT probe_json FROM media_items WHERE id=?').get(context.mediaId) as any;return embeddedRecord(context,row?.probe_json)}
  searchMovies=EMPTY_METHODS.searchMovies;searchSeries=EMPTY_METHODS.searchSeries;getMovie=EMPTY_METHODS.getMovie;getSeries=EMPTY_METHODS.getSeries;getSeason=EMPTY_METHODS.getSeason;getEpisode=EMPTY_METHODS.getEpisode;getCast=EMPTY_METHODS.getCast;getCrew=EMPTY_METHODS.getCrew;getImages=EMPTY_METHODS.getImages;getRatings=EMPTY_METHODS.getRatings;findByExternalId=EMPTY_METHODS.findByExternalId;
  async testConnection(){return{ok:true,message:'Ingebedde bestandsmetadata kan lokaal worden gelezen.'}}
  getProviderStatus(){return storedStatus(this.id,true,providerEnabled(this.id))}
}

export const embeddedInternals={tagsFromProbe,embeddedRecord};
