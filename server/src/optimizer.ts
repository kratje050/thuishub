import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db, dataDir } from './db.js';
import { ffmpegPath, videoEncoder, videoFilter } from './ffmpeg.js';

const outputDir = path.join(dataDir, 'optimized');
fs.mkdirSync(outputDir, { recursive: true });
let running = false;

export function queueOptimization(mediaId: number, profile: 'mobile' | '1080p' | 'original') {
  const existing = db.prepare(`SELECT id,status FROM optimized_versions WHERE media_id=? AND profile=? AND status IN ('queued','running','ready') ORDER BY id DESC LIMIT 1`).get(mediaId, profile) as any;
  if (existing) return existing.id as number;
  const result = db.prepare('INSERT INTO optimized_versions(media_id,profile) VALUES(?,?)').run(mediaId, profile);
  void runQueue();
  return Number(result.lastInsertRowid);
}

export function optimizationList(userId?: number) {
  return db.prepare(`SELECT o.id,o.media_id mediaId,o.profile,o.status,o.progress,o.error,o.created_at createdAt,m.title,m.series_title seriesTitle
    FROM optimized_versions o JOIN media_items m ON m.id=o.media_id ORDER BY o.id DESC`).all();
}

async function runQueue() {
  if (running) return;
  running = true;
  try {
    let job: any;
    while ((job = db.prepare(`SELECT o.*,m.file_path,m.duration,m.color_transfer FROM optimized_versions o JOIN media_items m ON m.id=o.media_id WHERE o.status='queued' ORDER BY o.id LIMIT 1`).get())) {
      await runJob(job);
    }
  } finally { running = false; }
}

function runJob(job: any) {
  return new Promise<void>(resolve => {
    const extension = '.mp4';
    const target = path.join(outputDir, `${job.media_id}-${job.profile}-${job.id}${extension}`);
    const encoder = videoEncoder();
    const maxWidth = job.profile === 'mobile' ? 1280 : job.profile === '1080p' ? 1920 : 3840;
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', job.file_path, '-map', '0:v:0', '-map', '0:a:0?', '-map', '0:s?', '-c:v', encoder.codec, ...encoder.args, '-vf', videoFilter(job.color_transfer, maxWidth), '-c:a', 'aac', '-b:a', job.profile === 'mobile' ? '128k' : '192k', '-movflags', '+faststart', '-progress', 'pipe:1', target];
    db.prepare(`UPDATE optimized_versions SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(job.id);
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let error = '';
    child.stdout.on('data', chunk => {
      const match = chunk.toString().match(/out_time_ms=(\d+)/);
      if (match && job.duration) {
        const progress = Math.min(99, Number(match[1]) / 1_000_000 / job.duration * 100);
        db.prepare('UPDATE optimized_versions SET progress=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(progress, job.id);
      }
    });
    child.stderr.on('data', chunk => { error += chunk.toString(); });
    child.on('close', code => {
      if (code === 0 && fs.existsSync(target)) db.prepare(`UPDATE optimized_versions SET status='ready',progress=100,file_path=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(target, job.id);
      else db.prepare(`UPDATE optimized_versions SET status='error',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(error.slice(-2000) || `FFmpeg stopte met code ${code}`, job.id);
      resolve();
    });
  });
}

export function optimizedFile(id: number) {
  const row = db.prepare(`SELECT file_path FROM optimized_versions WHERE id=? AND status='ready'`).get(id) as { file_path: string } | undefined;
  return row?.file_path && fs.existsSync(row.file_path) ? row.file_path : null;
}
