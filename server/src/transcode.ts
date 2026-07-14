import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dataDir } from './db.js';
import { ffmpegPath, videoEncoder, videoFilter } from './ffmpeg.js';
import { log } from './logger.js';

const hlsRoot = path.join(dataDir, 'hls');
// HLS-bestanden zijn uitsluitend opnieuw te maken transcodecache. Na een
// serverherstart bestaat er geen bijbehorend FFmpeg-proces meer, dus oude
// gedeeltelijke playlists mogen nooit als actieve stream blijven liggen.
fs.rmSync(hlsRoot, { recursive: true, force: true });
fs.mkdirSync(hlsRoot, { recursive: true });
const active = new Map<number, ChildProcessWithoutNullStreams>();
const activeProfiles = new Map<number, string>();
const HLS_SEGMENT_SECONDS = 1;

export type HlsOptions = { copyVideo?: boolean; copyAudio?: boolean; burnSubtitles?: boolean; subtitlePath?: string | null; targetBitrateMbps?: number; targetWidth?: number; targetHeight?: number };

function subtitleFilterPath(value: string) {
  return value.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'").replaceAll('[', '\\[').replaceAll(']', '\\]');
}

function hlsKeyframeArgs(codec: string) {
  return [
    ...(codec === 'h264_nvenc' ? ['-forced-idr', '1'] : []),
    '-force_key_frames', `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
  ];
}

export function isDirectPlayable(item: { file_path: string; video_codec?: string | null; audio_codec?: string | null }) {
  const ext = path.extname(item.file_path).toLowerCase();
  const video = item.video_codec?.toLowerCase();
  const audio = item.audio_codec?.toLowerCase();
  if (ext === '.webm') return !video || ['vp8', 'vp9', 'av1'].includes(video);
  if (['.mp4', '.m4v'].includes(ext)) return (!video || video === 'h264' || video === 'av1') && (!audio || ['aac', 'mp3', 'opus'].includes(audio));
  return false;
}

export async function ensureHls(id: number, filePath: string, colorTransfer?: string | null, options: HlsOptions = {}): Promise<string> {
  const dir = path.join(hlsRoot, String(id));
  const manifest = path.join(dir, 'index.m3u8');
  const profile = JSON.stringify(options);
  if (fs.existsSync(manifest) && activeProfiles.get(id) === profile) return manifest;
  if (active.has(id) && activeProfiles.get(id) !== profile) {
    active.get(id)?.kill();
    active.delete(id);
  }
  if (!active.has(id)) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const encoder = videoEncoder();
    const baseVideoFilter = videoFilter(colorTransfer,options.targetWidth||1920);
    const completeVideoFilter = options.burnSubtitles
      ? `subtitles=filename='${subtitleFilterPath(options.subtitlePath || filePath)}',${baseVideoFilter}`
      : baseVideoFilter;
    const videoArgs = options.copyVideo ? ['-c:v', 'copy'] : ['-c:v', encoder.codec, ...encoder.args,
      '-vf', completeVideoFilter,...(options.targetBitrateMbps?['-maxrate',`${options.targetBitrateMbps}M`,'-bufsize',`${Math.max(2,options.targetBitrateMbps*2)}M`]:[])];
    const audioArgs = options.copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '384k', '-ac', '6'];
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-i', filePath,
      '-map', '0:v:0', '-map', '0:a:0?', '-sn',
      ...videoArgs,...audioArgs,
      ...(options.copyVideo ? [] : hlsKeyframeArgs(encoder.codec)),
      '-f', 'hls', '-hls_time', String(HLS_SEGMENT_SECONDS), '-hls_list_size', '0', '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments+temp_file', '-hls_segment_filename', path.join(dir, 'segment-%05d.ts'), manifest
    ];
    activeProfiles.set(id,profile);
    const process = spawn(ffmpegPath, args, { windowsHide: true });
    active.set(id, process);
    process.on('error', error => { process.stderrLog = `${process.stderrLog || ''}\n${error.message}`.slice(-16_384); });
    process.on('close', code => {
      const wasActive = active.get(id) === process;
      if (code && wasActive) log('ERROR', 'transcoding', 'FFmpeg-HLS-proces stopte voordat de film volledig was omgezet.', { mediaId: id, code, stderr: (process.stderrLog || '').slice(-4_096) });
      if (wasActive) active.delete(id);
    });
    process.stderr.on('data', chunk => process.stderrLog = `${process.stderrLog || ''}${chunk.toString()}`.slice(-16_384));
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(manifest)) return manifest;
    if (!active.has(id)) throw new Error('FFmpeg kon deze video niet omzetten.');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Het omzetten duurt te lang. Probeer het opnieuw.');
}

export function hlsFile(id: number, name: string) {
  if (!/^(index\.m3u8|segment-\d{5}\.ts)$/.test(name)) return null;
  const file = path.join(hlsRoot, String(id), name);
  return fs.existsSync(file) ? file : null;
}

export function releaseHls(id: number) {
  const process = active.get(id);
  if (process && process.exitCode === null && !process.killed) process.kill();
  active.delete(id);
  activeProfiles.delete(id);
  fs.rmSync(path.join(hlsRoot, String(id)), { recursive: true, force: true });
}

export function dlnaMpegTsArgs(filePath: string, colorTransfer?: string | null, options: HlsOptions = {}, startSeconds = 0) {
  const encoder = videoEncoder();
  const baseVideoFilter = videoFilter(colorTransfer, options.targetWidth || 1920);
  const completeVideoFilter = options.burnSubtitles
    ? `subtitles=filename='${subtitleFilterPath(options.subtitlePath || filePath)}',${baseVideoFilter}`
    : baseVideoFilter;
  const videoArgs = options.copyVideo ? ['-c:v', 'copy'] : ['-c:v', encoder.codec, ...encoder.args,
    '-vf', completeVideoFilter, ...(options.targetBitrateMbps ? ['-maxrate', `${options.targetBitrateMbps}M`, '-bufsize', `${Math.max(2, options.targetBitrateMbps * 2)}M`] : [])];
  // Het generieke DLNA-profiel is bewust stereo. Dit voorkomt dat televisies
  // een verder geldige MPEG-TS-stream weigeren vanwege 5.1 AAC.
  const audioArgs = options.copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2'];
  const safeStart = Math.min(7 * 24 * 3_600, Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0));
  return [
    '-hide_banner', '-loglevel', 'warning',
    ...(safeStart > 0 ? ['-ss', safeStart.toFixed(3)] : []),
    '-i', filePath,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn',
    ...videoArgs, ...audioArgs,
    '-muxpreload', '0', '-muxdelay', '0', '-mpegts_flags', '+resend_headers',
    '-f', 'mpegts', 'pipe:1',
  ];
}

export function createDlnaMpegTsStream(filePath: string, colorTransfer?: string | null, options: HlsOptions = {}, startSeconds = 0) {
  const process = spawn(ffmpegPath, dlnaMpegTsArgs(filePath, colorTransfer, options, startSeconds), { windowsHide: true });
  process.stderr.on('data', chunk => {
    const previous = process.stderrLog || '';
    process.stderrLog = `${previous}${chunk.toString()}`.slice(-16_384);
  });
  return process;
}

export function clearTranscodes() {
  for (const process of active.values()) process.kill();
  active.clear();
  activeProfiles.clear();
}

export const transcodeInternals = { HLS_SEGMENT_SECONDS, hlsKeyframeArgs };

declare module 'node:child_process' {
  interface ChildProcessWithoutNullStreams { stderrLog?: string }
}
