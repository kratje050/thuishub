import fs from 'node:fs';
import path from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { getProviderStatus as storedStatus, providerEnabled, recordProviderResult } from '../store.js';
import { EMPTY_METHODS, type MetadataExternalIds, type MetadataImage, type MetadataItemContext, type MetadataPerson, type MetadataProvider, type MetadataRating, type MetadataRecord } from '../types.js';
import { parseFiniteNumber, parseYear, safeStringArray, sanitizeExternalText } from '../sanitize.js';

const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',textNodeName:'#text',parseTagValue:false,trimValues:true,allowBooleanAttributes:false,processEntities:false});
const MAX_NFO_BYTES=2*1024*1024;
function array<T=any>(value:T|T[]|undefined|null):T[]{return value==null?[]:Array.isArray(value)?value:[value]}
function text(value:unknown,max=20_000){if(value&&typeof value==='object'&&'#text'in(value as any))return sanitizeExternalText((value as any)['#text'],max);return sanitizeExternalText(value,max)}
function inside(file:string,root:string){const resolved=path.resolve(file);const base=path.resolve(root);return resolved===base||resolved.startsWith(`${base}${path.sep}`)}
function safeReference(raw:unknown,nfoFile:string,sourceRoot:string){const value=text(raw,3000);if(!value)return{};if(/^https?:\/\//i.test(value))return{url:value};if(/^[a-z][a-z0-9+.-]*:\/\//i.test(value))return{};const file=path.resolve(path.dirname(nfoFile),value);return inside(file,sourceRoot)&&fs.existsSync(file)?{localPath:file}:{};}

function idsFromNfo(root:any):MetadataExternalIds{
  const ids:MetadataExternalIds={};const unique=array(root?.uniqueid);
  for(const item of unique){const type=String(item?.['@_type']||'').toLowerCase();const value=text(item,100);if(!value)continue;if(type==='imdb')ids.imdb=value;else if(type==='tvmaze')ids.tvmaze=value;else if(type==='tvdb'||type==='thetvdb')ids.thetvdb=value;else if(type==='tmdb')ids.legacyTmdb=value}
  const imdb=text(root?.imdbid,100);if(imdb)ids.imdb=imdb;return ids;
}
function ratingsFromNfo(root:any):MetadataRating[]{
  const output:MetadataRating[]=[];const direct=parseFiniteNumber(root?.rating);if(direct!==undefined)output.push({source:'NFO',value:direct,maxValue:10});
  for(const item of array(root?.ratings?.rating)){const value=parseFiniteNumber(item?.value);if(value===undefined)continue;output.push({source:text(item?.['@_name'],100)||'NFO',value,maxValue:parseFiniteNumber(item?.['@_max'])||10,votes:parseFiniteNumber(item?.votes)})}
  return output;
}
function peopleFromNfo(root:any):{cast:MetadataPerson[];crew:MetadataPerson[]}{
  const cast=array(root?.actor).map((actor:any,index)=>({name:text(actor?.name,250),role:'Actor',character:text(actor?.role,250)||undefined,order:parseFiniteNumber(actor?.order)??index})).filter(person=>person.name);
  const crew:MetadataPerson[]=[...array(root?.director).map((name,index)=>({name:text(name,250),role:'Director',order:index})),...array(root?.credits).map((name,index)=>({name:text(name,250),role:'Writer',order:index}))].filter(person=>person.name);return{cast,crew};
}
function imagesFromNfo(root:any,nfoFile:string,sourceRoot:string):MetadataImage[]{
  const images:MetadataImage[]=[];const add=(type:MetadataImage['type'],value:unknown,primary=false)=>{const ref=safeReference(value,nfoFile,sourceRoot);if(ref.url||ref.localPath)images.push({type,...ref,primary})};
  add('poster',root?.poster,true);for(const thumb of array(root?.thumb)){const aspect=String(thumb?.['@_aspect']||'').toLowerCase();add(aspect==='banner'?'banner':aspect==='landscape'?'landscape':aspect==='clearlogo'?'logo':'poster',thumb,!images.some(item=>item.type==='poster'))}
  const fanart=root?.fanart;for(const thumb of array(fanart?.thumb??fanart))add('backdrop',thumb,!images.some(item=>item.type==='backdrop'));
  add('banner',root?.banner);add('logo',root?.clearlogo);return images;
}
function mapNfo(root:any,mediaType:MetadataRecord['mediaType'],nfoFile:string,sourceRoot:string):MetadataRecord|null{
  const title=text(root?.title,500);if(!title)return null;const people=peopleFromNfo(root);const setName=typeof root?.set==='object'?text(root.set.name,500):text(root?.set,500);const premiered=text(root?.premiered??root?.aired,100)||undefined;
  return{mediaType,title,originalTitle:text(root?.originaltitle,500)||undefined,sortTitle:text(root?.sorttitle,500)||undefined,year:parseYear(root?.year??premiered),premiered,summary:text(root?.plot??root?.outline)||undefined,runtimeMinutes:parseFiniteNumber(root?.runtime),genres:safeStringArray(root?.genre),cast:people.cast,crew:people.crew,ratings:ratingsFromNfo(root),contentRating:text(root?.mpaa,100)||undefined,originalContentRating:text(root?.mpaa,100)||undefined,country:safeStringArray(root?.country).join(', ')||undefined,studio:safeStringArray(root?.studio).join(', ')||undefined,season:parseFiniteNumber(root?.season),episode:parseFiniteNumber(root?.episode),displaySeason:parseFiniteNumber(root?.displayseason),displayEpisode:parseFiniteNumber(root?.displayepisode),absoluteEpisode:parseFiniteNumber(root?.absolute_number??root?.absoluteepisode),aired:text(root?.aired,100)||undefined,tags:safeStringArray(root?.tag),collection:setName||undefined,trailer:text(root?.trailer,2000)||undefined,images:imagesFromNfo(root,nfoFile,sourceRoot),externalIds:idsFromNfo(root),provider:'local_nfo',providerId:nfoFile};
}
function parseNfoFile(file:string,sourceRoot:string){
  if(!inside(file,sourceRoot)||!fs.existsSync(file))return null;const stat=fs.statSync(file);if(!stat.isFile()||stat.size>MAX_NFO_BYTES)throw new Error('NFO-bestand is groter dan toegestaan.');
  const source=fs.readFileSync(file,'utf8');if(XMLValidator.validate(source)!==true)throw new Error('NFO-bestand bevat ongeldige XML.');let document:any;try{document=parser.parse(source)}catch{throw new Error('NFO-bestand bevat ongeldige XML.')}const root=document?.movie||document?.tvshow||document?.episodedetails;const type=document?.movie?'movie':document?.tvshow?'series':document?.episodedetails?'episode':null;if(!root||!type)throw new Error('NFO-bestand heeft geen ondersteunde hoofdstructuur.');return mapNfo(root,type,file,sourceRoot);
}
function seriesRoot(context:MetadataItemContext){if(!context.filePath||!context.sourcePath)return'';const relative=path.relative(context.sourcePath,context.filePath).split(path.sep);return relative.length>1?path.join(context.sourcePath,relative[0]):path.dirname(context.filePath)}

export class LocalNfoProvider implements MetadataProvider{
  readonly id='local_nfo' as const;readonly label='Lokale NFO';readonly informationUrl='https://kodi.wiki/view/NFO_files';
  async readForContext(context:MetadataItemContext){
    if(!providerEnabled(this.id)||!context.filePath||!context.sourcePath)return{record:null,seriesRecord:null,files:[] as string[]};const directory=path.dirname(context.filePath);const stem=path.basename(context.filePath,path.extname(context.filePath));const candidates=context.mediaType==='movie'?[path.join(directory,`${stem}.nfo`),path.join(directory,'movie.nfo')]:[path.join(directory,`${stem}.nfo`)];const seriesFile=context.mediaType==='series'||context.season!==undefined?path.join(seriesRoot(context),'tvshow.nfo'):'';
    try{
      const file=candidates.find(candidate=>inside(candidate,context.sourcePath!)&&fs.existsSync(candidate));const record=file?parseNfoFile(file,context.sourcePath):null;const seriesRecord=seriesFile&&fs.existsSync(seriesFile)?parseNfoFile(seriesFile,context.sourcePath):null;recordProviderResult(this.id,{success:true});return{record,seriesRecord,files:[file,seriesFile].filter(Boolean) as string[]};
    }catch(error){recordProviderResult(this.id,{error:error instanceof Error?error.message:String(error)});return{record:null,seriesRecord:null,files:[] as string[]}}
  }
  searchMovies=EMPTY_METHODS.searchMovies;searchSeries=EMPTY_METHODS.searchSeries;getMovie=EMPTY_METHODS.getMovie;getSeries=EMPTY_METHODS.getSeries;getSeason=EMPTY_METHODS.getSeason;getEpisode=EMPTY_METHODS.getEpisode;getCast=EMPTY_METHODS.getCast;getCrew=EMPTY_METHODS.getCrew;getImages=EMPTY_METHODS.getImages;getRatings=EMPTY_METHODS.getRatings;findByExternalId=EMPTY_METHODS.findByExternalId;
  async testConnection(){return{ok:true,message:'Lokale NFO-lezer is beschikbaar.'}}
  getProviderStatus(){return storedStatus(this.id,true,providerEnabled(this.id))}
}

export const nfoInternals={parseNfoFile,mapNfo,seriesRoot,inside,safeReference,MAX_NFO_BYTES};
