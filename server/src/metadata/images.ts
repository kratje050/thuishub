import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import sharp from 'sharp';
import { db } from '../db.js';
import { appPaths } from '../paths.js';
import { APP_VERSION } from '../constants.js';
import type { MetadataImage, MetadataImageType, MetadataProviderId } from './types.js';

const MAX_IMAGE_BYTES=12*1024*1024;
const MIME_EXTENSIONS:Record<string,string>={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/avif':'.avif'};

function ipv4Parts(address:string){const parts=address.split('.').map(Number);return parts.length===4&&parts.every(part=>Number.isInteger(part)&&part>=0&&part<=255)?parts:null}
export function blockedNetworkAddress(address:string){
  const lower=address.toLowerCase();
  if(lower==='::'||lower==='::1')return true;
  if(lower.startsWith('::ffff:'))return blockedNetworkAddress(lower.slice(7));
  if(net.isIP(address)===6)return lower.startsWith('fc')||lower.startsWith('fd')||/^fe[89ab]/.test(lower)||lower.startsWith('2001:db8');
  const parts=ipv4Parts(address);if(!parts)return true;const[a,b]=parts;
  return a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===192&&b===0)||(a===198&&(b===18||b===19));
}

export async function validateExternalImageUrl(raw:string,lookup:typeof dns.lookup=dns.lookup){
  let url:URL;try{url=new URL(raw)}catch{throw new Error('Ongeldige afbeeldings-URL.')}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Alleen openbare HTTP- en HTTPS-afbeeldingen zijn toegestaan.');
  if(!url.hostname||url.hostname.toLowerCase()==='localhost'||url.hostname.endsWith('.localhost'))throw new Error('Lokale afbeeldingsadressen zijn geblokkeerd.');
  if(net.isIP(url.hostname)&&blockedNetworkAddress(url.hostname))throw new Error('Privé- en systeemadressen zijn geblokkeerd.');
  const addresses=await lookup(url.hostname,{all:true,verbatim:true});if(!addresses.length||addresses.some(item=>blockedNetworkAddress(item.address)))throw new Error('Afbeeldingshost verwijst naar een geblokkeerd netwerkadres.');
  return url;
}

function safeCacheFile(mediaId:number,type:MetadataImageType,hash:string,extension:string){
  fs.mkdirSync(appPaths.metadataImageCacheDir,{recursive:true});
  return path.join(appPaths.metadataImageCacheDir,`${mediaId}-${type}-${hash.slice(0,20)}${extension}`);
}

async function validatedImage(bytes:Buffer,declaredType?:string|null){
  if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw new Error('Afbeeldingsbestand is leeg of te groot.');
  const declared=declaredType?.split(';')[0].trim().toLowerCase();
  if(declared&&!MIME_EXTENSIONS[declared])throw new Error('Provider stuurde geen toegestaan afbeeldingsformaat.');
  const metadata=await sharp(bytes,{limitInputPixels:50_000_000,failOn:'error'}).metadata();
  const format=String(metadata.format||'');
  const detected=format==='jpeg'?'image/jpeg':format==='png'?'image/png':format==='webp'?'image/webp':format==='avif'||(format==='heif'&&declaredType?.startsWith('image/avif'))?'image/avif':'';
  if(!detected||!MIME_EXTENSIONS[detected])throw new Error('Niet-ondersteund of beschadigd afbeeldingsbestand.');
  return{contentType:detected,extension:MIME_EXTENSIONS[detected],width:metadata.width,height:metadata.height};
}

async function responseBuffer(response:Response){
  if(!response.body)return Buffer.alloc(0);
  const reader=response.body.getReader();const chunks:Buffer[]=[];let total=0;
  while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_IMAGE_BYTES){await reader.cancel();throw new Error('Afbeelding is groter dan toegestaan.')}chunks.push(Buffer.from(value))}
  return Buffer.concat(chunks,total);
}

function storeImage(mediaId:number,type:MetadataImageType,provider:MetadataProviderId,originalUrl:string|null,file:string,bytes:Buffer,contentType:string,manual=false,allowSelection=true){
  const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  const current=allowSelection?db.prepare('SELECT manually_selected manual,provider FROM metadata_images WHERE media_id=? AND image_type=? AND selected=1').get(mediaId,type) as any:null;
  const selected=allowSelection&&(manual||(!current?.manual&&(provider==='local_nfo'||current?.provider!=='local_nfo')));
  const transaction=db.transaction(()=>{
    if(selected)db.prepare('UPDATE metadata_images SET selected=0 WHERE media_id=? AND image_type=? AND manually_selected=0').run(mediaId,type);
    db.prepare(`INSERT INTO metadata_images(media_id,image_type,provider,original_url,local_path,content_type,byte_size,sha256,manually_selected,selected,downloaded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(media_id,image_type,provider,original_url,local_path) DO UPDATE SET content_type=excluded.content_type,byte_size=excluded.byte_size,sha256=excluded.sha256,manually_selected=MAX(manually_selected,excluded.manually_selected),selected=MAX(selected,excluded.selected),downloaded_at=CURRENT_TIMESTAMP`).run(mediaId,type,provider,originalUrl,file,contentType,bytes.length,hash,Number(manual),Number(selected));
  });transaction();
  return db.prepare('SELECT id,local_path localPath,content_type contentType,byte_size bytes,sha256,provider,image_type type FROM metadata_images WHERE media_id=? AND image_type=? AND local_path=?').get(mediaId,type,file) as any;
}

export async function cacheExternalImage(mediaId:number,image:MetadataImage,provider:MetadataProviderId,fetcher:typeof fetch=fetch,manual=false,allowSelection=true){
  if(!image.url)throw new Error('Afbeeldings-URL ontbreekt.');let url=await validateExternalImageUrl(image.url);let response:Response|undefined;
  for(let redirects=0;redirects<=3;redirects++){
    response=await fetcher(url,{headers:{accept:'image/avif,image/webp,image/png,image/jpeg','user-agent':`ThuisHub/${APP_VERSION}`},redirect:'manual',signal:AbortSignal.timeout(15_000)});
    if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location||redirects===3)throw new Error('Te veel of ongeldige afbeeldingsomleidingen.');url=await validateExternalImageUrl(new URL(location,url).toString());continue}break;
  }
  if(!response?.ok)throw new Error(`Afbeeldingsprovider gaf HTTP ${response?.status||0}.`);
  const declared=Number(response.headers.get('content-length')||0);if(declared>MAX_IMAGE_BYTES)throw new Error('Afbeelding is groter dan toegestaan.');
  const bytes=await responseBuffer(response);const info=await validatedImage(bytes,response.headers.get('content-type'));const hash=crypto.createHash('sha256').update(bytes).digest('hex');const file=safeCacheFile(mediaId,image.type,hash,info.extension);
  if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{mode:0o600});
  return storeImage(mediaId,image.type,provider,image.url,file,bytes,info.contentType,manual,allowSelection);
}

function isInside(file:string,root:string){const resolved=path.resolve(file);const base=path.resolve(root);return resolved===base||resolved.startsWith(`${base}${path.sep}`)}

export async function cacheLocalImage(mediaId:number,type:MetadataImageType,file:string,allowedRoot:string,manual=false){
  const resolved=path.resolve(file);if(!isInside(resolved,allowedRoot)||!fs.existsSync(resolved)||!fs.statSync(resolved).isFile())throw new Error('Lokale afbeelding valt buiten de mediabibliotheek.');
  const stat=fs.statSync(resolved);if(stat.size>MAX_IMAGE_BYTES)throw new Error('Lokale afbeelding is groter dan toegestaan.');
  const bytes=fs.readFileSync(resolved);const info=await validatedImage(bytes);const hash=crypto.createHash('sha256').update(bytes).digest('hex');const target=safeCacheFile(mediaId,type,hash,info.extension);if(!fs.existsSync(target))fs.copyFileSync(resolved,target);
  return storeImage(mediaId,type,'local_nfo',null,target,bytes,info.contentType,manual);
}

function firstExisting(candidates:string[]){return candidates.find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile())}
export function findLocalArtwork(context:{filePath:string;sourcePath:string;kind:'movie'|'episode';season?:number}){
  const directory=path.dirname(context.filePath);const extension=path.extname(context.filePath);const stem=path.basename(context.filePath,extension);const relative=path.relative(context.sourcePath,context.filePath).split(path.sep);const seriesRoot=context.kind==='episode'&&relative.length>1?path.join(context.sourcePath,relative[0]):directory;const image=(names:string[],directories=[directory])=>firstExisting(directories.flatMap(folder=>names.flatMap(name=>['.jpg','.png','.webp'].map(ext=>path.join(folder,`${name}${ext}`)))).filter(file=>isInside(file,context.sourcePath)));
  const results:Partial<Record<MetadataImageType,string>>={};
  if(context.kind==='movie'){
    results.poster=image([`${stem}-poster`,'poster','folder']);results.backdrop=image([`${stem}-fanart`,'fanart','background']);results.banner=image([`${stem}-banner`,'banner']);results.logo=image([`${stem}-clearlogo`,'clearlogo']);results.landscape=image([`${stem}-landscape`,'landscape']);
  }else{
    results.episode=image([`${stem}-thumb`,stem]);
    const season=String(context.season||0).padStart(2,'0');results.poster=image([`season${season}-poster`,context.season===0?'season-specials-poster':'','poster','folder'].filter(Boolean),[directory,seriesRoot]);results.backdrop=image(['fanart','background'],[directory,seriesRoot]);results.banner=image(['banner'],[seriesRoot,directory]);results.logo=image(['clearlogo','logo'],[seriesRoot,directory]);results.landscape=image(['landscape'],[seriesRoot,directory]);
  }
  return Object.fromEntries(Object.entries(results).filter((entry):entry is [MetadataImageType,string]=>Boolean(entry[1])));
}

export function selectedImage(mediaId:number,type:MetadataImageType){return db.prepare(`SELECT id,local_path localPath,content_type contentType,provider,original_url originalUrl,manually_selected manuallySelected FROM metadata_images WHERE media_id=? AND image_type=? AND selected=1 AND local_path IS NOT NULL ORDER BY manually_selected DESC,id DESC LIMIT 1`).get(mediaId,type) as any}
export function imageApiUrl(mediaId:number,type:MetadataImageType){const image=selectedImage(mediaId,type);return image?`/api/metadata/images/${image.id}`:null}
export function metadataImageFile(id:number){const row=db.prepare('SELECT local_path localPath,content_type contentType FROM metadata_images WHERE id=?').get(id) as any;if(!row?.localPath||!isInside(row.localPath,appPaths.metadataImageCacheDir)||!fs.existsSync(row.localPath))return null;return row}
export function metadataImages(mediaId:number){return db.prepare('SELECT id,image_type type,provider,original_url originalUrl,content_type contentType,byte_size bytes,manually_selected manuallySelected,selected,downloaded_at downloadedAt FROM metadata_images WHERE media_id=? ORDER BY image_type,selected DESC,id DESC').all(mediaId).map((row:any)=>({...row,manuallySelected:Boolean(row.manuallySelected),selected:Boolean(row.selected),url:`/api/metadata/images/${row.id}`}))}
export function selectMetadataImage(mediaId:number,imageId:number){const row=db.prepare('SELECT id,image_type type FROM metadata_images WHERE id=? AND media_id=?').get(imageId,mediaId) as any;if(!row)throw Object.assign(new Error('Afbeelding niet gevonden.'),{status:404});db.transaction(()=>{db.prepare('UPDATE metadata_images SET selected=0 WHERE media_id=? AND image_type=?').run(mediaId,row.type);db.prepare('UPDATE metadata_images SET selected=1,manually_selected=1 WHERE id=?').run(imageId)})();return row}
export function removeMetadataImage(mediaId:number,imageId:number){const row=db.prepare('SELECT local_path localPath FROM metadata_images WHERE id=? AND media_id=?').get(imageId,mediaId) as any;if(!row)return false;db.prepare('DELETE FROM metadata_images WHERE id=?').run(imageId);const used=db.prepare('SELECT 1 FROM metadata_images WHERE local_path=?').get(row.localPath);if(!used&&row.localPath&&isInside(row.localPath,appPaths.metadataImageCacheDir))fs.rmSync(row.localPath,{force:true});return true}
export function clearMetadataImageCache(){const rows=db.prepare('SELECT local_path localPath FROM metadata_images WHERE manually_selected=0').all() as any[];for(const row of rows)if(row.localPath&&isInside(row.localPath,appPaths.metadataImageCacheDir))fs.rmSync(row.localPath,{force:true});return db.prepare('DELETE FROM metadata_images WHERE manually_selected=0').run().changes}

export const imageInternals={blockedNetworkAddress,validatedImage,isInside,MAX_IMAGE_BYTES};
