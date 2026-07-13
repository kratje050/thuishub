import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { XMLParser } from 'fast-xml-parser';
import { db } from './db.js';
import { ffmpegPath } from './ffmpeg.js';
import { emitWebhook } from './webhooks.js';

async function readLocation(location:string){if(/^https?:\/\//i.test(location)){const response=await fetch(location,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`Bron gaf status ${response.status}`);return response.text()}return fs.promises.readFile(location,'utf8')}

function attr(line:string,name:string){return line.match(new RegExp(`${name}="([^"]*)"`,'i'))?.[1]||''}

export async function refreshTvSource(sourceId:number){
  const source=db.prepare('SELECT * FROM tv_sources WHERE id=?').get(sourceId) as any;if(!source)throw new Error('TV-bron niet gevonden.');
  const m3u=await readLocation(source.playlist_url);const lines=m3u.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const upsert=db.prepare(`INSERT INTO tv_channels(source_id,external_id,name,channel_number,logo_url,stream_url) VALUES(?,?,?,?,?,?) ON CONFLICT(source_id,external_id) DO UPDATE SET name=excluded.name,channel_number=excluded.channel_number,logo_url=excluded.logo_url,stream_url=excluded.stream_url`);
  for(let i=0;i<lines.length;i++){if(!lines[i].startsWith('#EXTINF'))continue;const info=lines[i];const stream=lines.slice(i+1).find(x=>!x.startsWith('#'));if(!stream)continue;const name=info.split(',').slice(1).join(',').trim()||'Onbekend kanaal';const external=attr(info,'tvg-id')||name;upsert.run(sourceId,external,name,attr(info,'tvg-chno')||null,attr(info,'tvg-logo')||null,stream)}
  if(source.xmltv_url)await refreshGuide(sourceId,source.xmltv_url);
}

async function refreshGuide(sourceId:number,location:string){
  const xml=await readLocation(location);const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_'});const tv=parser.parse(xml)?.tv||{};const programs=Array.isArray(tv.programme)?tv.programme:tv.programme?[tv.programme]:[];const channelByExternal=new Map((db.prepare('SELECT id,external_id FROM tv_channels WHERE source_id=?').all(sourceId) as any[]).map(x=>[x.external_id,x.id]));
  const insert=db.prepare(`INSERT INTO tv_programs(channel_id,start_time,end_time,title,description,category,episode) VALUES(?,?,?,?,?,?,?) ON CONFLICT(channel_id,start_time,title) DO UPDATE SET end_time=excluded.end_time,description=excluded.description,category=excluded.category,episode=excluded.episode`);
  const transaction=db.transaction(()=>{for(const p of programs){const channelId=channelByExternal.get(String(p['@_channel']));if(!channelId)continue;insert.run(channelId,xmltvDate(p['@_start']).toISOString(),xmltvDate(p['@_stop']).toISOString(),text(p.title)||'Onbekend programma',text(p.desc)||'',text(p.category)||null,text(p['episode-num'])||null)}});transaction();
  db.prepare("DELETE FROM tv_programs WHERE end_time < datetime('now','-1 day')").run();
}

function text(value:any):string{if(value===undefined||value===null)return'';if(typeof value==='string'||typeof value==='number')return String(value);if(Array.isArray(value))return text(value[0]);return String(value['#text']||'')}
function xmltvDate(value:string){const match=String(value||'').match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);if(!match)return new Date();const[,y,m,d,h,min,s,zone]=match;const iso=`${y}-${m}-${d}T${h}:${min}:${s}${zone?`${zone.slice(0,3)}:${zone.slice(3)}`:'Z'}`;return new Date(iso)}

const active=new Map<number,ReturnType<typeof spawn>>();
export function startDvrScheduler(){setInterval(checkRecordings,15000).unref();void checkRecordings()}
async function checkRecordings(){const now=new Date().toISOString();const jobs=db.prepare(`SELECT r.*,c.stream_url,s.recording_path FROM tv_recordings r JOIN tv_channels c ON c.id=r.channel_id JOIN tv_sources s ON s.id=c.source_id WHERE r.status='scheduled' AND r.start_time<=? AND r.end_time>?`).all(now,now) as any[];for(const job of jobs)startRecording(job)}
function startRecording(job:any){if(active.has(job.id))return;fs.mkdirSync(job.recording_path,{recursive:true});const safe=job.title.replace(/[<>:"/\\|?*]+/g,' ').trim();const target=path.join(job.recording_path,`${safe} - ${job.start_time.slice(0,16).replace(/[:T]/g,'-')}.ts`);const seconds=Math.max(1,(new Date(job.end_time).getTime()-Date.now())/1000);const child=spawn(ffmpegPath,['-y','-hide_banner','-loglevel','error','-i',job.stream_url,'-t',String(seconds),'-c','copy',target],{windowsHide:true});active.set(job.id,child);db.prepare("UPDATE tv_recordings SET status='recording',file_path=? WHERE id=?").run(target,job.id);emitWebhook('recording.start',{recordingId:job.id,title:job.title});let error='';child.stderr.on('data',x=>error+=x.toString());child.on('close',code=>{active.delete(job.id);db.prepare('UPDATE tv_recordings SET status=?,error=? WHERE id=?').run(code===0?'ready':'error',code===0?null:error.slice(-2000),job.id);emitWebhook('recording.stop',{recordingId:job.id,title:job.title,status:code===0?'ready':'error'})})}
