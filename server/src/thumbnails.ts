import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDir } from './db.js';
import { ffmpegPath } from './ffmpeg.js';

const execFileAsync = promisify(execFile);
const root = path.join(dataDir, 'thumbnails');
fs.mkdirSync(root, { recursive: true });

export async function previewThumbnail(mediaId: number, filePath: string, seconds: number) {
  const rounded = Math.max(0, Math.round(seconds / 10) * 10);
  const dir = path.join(root, String(mediaId));
  const file = path.join(dir, `${rounded}.jpg`);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(dir, { recursive: true });
  await execFileAsync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(rounded), '-i', filePath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', file], { windowsHide: true, timeout: 15000 });
  return file;
}
