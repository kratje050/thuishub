import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import sharp from 'sharp';
import { db, dataDir } from './db.js';

const musicExtensions = new Set(['.mp3','.flac','.m4a','.aac','.ogg','.opus','.wav','.wma']);
const photoExtensions = new Set(['.jpg','.jpeg','.png','.webp','.gif','.tif','.tiff','.avif','.heic']);
const coversDir = path.join(dataDir,'covers');
const thumbsDir = path.join(dataDir,'photo-thumbnails');
fs.mkdirSync(coversDir,{recursive:true});fs.mkdirSync(thumbsDir,{recursive:true});

async function walk(dir:string,extensions:Set<string>):Promise<string[]>{const out:string[]=[];let entries:fs.Dirent[];try{entries=await fs.promises.readdir(dir,{withFileTypes:true})}catch{return out}for(const entry of entries){if(entry.name.startsWith('.')||entry.name==='$RECYCLE.BIN'||entry.name==='System Volume Information')continue;const full=path.join(dir,entry.name);if(entry.isDirectory())out.push(...await walk(full,extensions));else if(entry.isFile()&&extensions.has(path.extname(entry.name).toLowerCase()))out.push(full)}return out}

export async function scanExtraLibraries(scanState:{current:string;total:number;scanned:number;errors:number}){
  const sources=db.prepare('SELECT id,path,kind FROM extra_sources').all() as {id:number;path:string;kind:'music'|'photos'}[];
  for(const source of sources){
    const files=await walk(source.path,source.kind==='music'?musicExtensions:photoExtensions);scanState.total+=files.length;
    for(const file of files){scanState.current=path.basename(file);try{if(source.kind==='music')await scanTrack(source.id,file);else await scanPhoto(source.id,file)}catch{scanState.errors++}scanState.scanned++}
  }
}

async function scanTrack(sourceId:number,file:string){
  const metadata=await parseFile(file,{duration:true,skipCovers:false});const common=metadata.common;let cover:string|null=null;
  const picture=common.picture?.[0];if(picture){const ext=picture.format.includes('png')?'.png':'.jpg';cover=path.join(coversDir,`${Buffer.from(file.toLowerCase()).toString('base64url').slice(-40)}${ext}`);if(!fs.existsSync(cover))await fs.promises.writeFile(cover,picture.data)}
  const title=common.title||path.basename(file,path.extname(file));const artist=common.artist||common.albumartist||'Onbekende artiest';const album=common.album||'Onbekend album';
  db.prepare(`INSERT INTO music_tracks(source_id,title,artist,album,album_artist,track,disc,year,genre,duration,file_path,cover_path) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(file_path) DO UPDATE SET source_id=excluded.source_id,title=excluded.title,artist=excluded.artist,album=excluded.album,album_artist=excluded.album_artist,track=excluded.track,disc=excluded.disc,year=excluded.year,genre=excluded.genre,duration=excluded.duration,cover_path=excluded.cover_path`).run(sourceId,title,artist,album,common.albumartist||null,common.track.no||null,common.disk.no||null,common.year||null,JSON.stringify(common.genre||[]),metadata.format.duration||null,file,cover);
}

async function scanPhoto(sourceId:number,file:string){
  const [stat,meta]=await Promise.all([fs.promises.stat(file),sharp(file,{animated:false}).metadata()]);
  db.prepare(`INSERT INTO photos(source_id,title,file_path,width,height,taken_at,size) VALUES(?,?,?,?,?,?,?) ON CONFLICT(file_path) DO UPDATE SET source_id=excluded.source_id,title=excluded.title,width=excluded.width,height=excluded.height,taken_at=excluded.taken_at,size=excluded.size`).run(sourceId,path.basename(file,path.extname(file)),file,meta.width||null,meta.height||null,stat.mtime.toISOString(),stat.size);
}

export async function photoThumbnail(id:number,filePath:string){const target=path.join(thumbsDir,`${id}.jpg`);if(!fs.existsSync(target))await sharp(filePath).rotate().resize(900,900,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toFile(target);return target}
