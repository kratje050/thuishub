import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting } from './db.js';
import { enrichMedia } from './tmdb.js';
import { scanExtraLibraries } from './extra-media.js';
import { probeMedia } from './media-info.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.wmv', '.ts', '.m2ts']);
const SUBTITLE_EXTENSIONS = ['.nl.vtt', '.nl.srt', '.vtt', '.srt'];
const RELEASE_WORDS = /\b(2160p|1080p|720p|480p|bluray|brrip|webrip|web-dl|hdrip|dvdrip|x26[45]|h\.?26[45]|hevc|avc|aac|dts|remux|proper|repack|extended|multi|nlsubbed)\b.*$/i;

export type ParsedMedia = {
  kind: 'movie' | 'episode'; title: string; sortTitle: string; year?: number;
  seriesTitle?: string; season?: number; episode?: number;
};

function cleanTitle(value: string): string {
  return value.replace(/[._]+/g, ' ').replace(/\[[^\]]*]/g, ' ').replace(RELEASE_WORDS, '').replace(/\s+/g, ' ').replace(/[-–]+$/, '').trim();
}

export function parseMediaName(filePath: string, sourcePath: string, sourceKind: 'movies' | 'series'): ParsedMedia {
  const base = path.basename(filePath, path.extname(filePath));
  const relative = path.relative(sourcePath, filePath);
  const parts = relative.split(path.sep);
  const episodeMatch = base.match(/(?:^|[ ._-])s(\d{1,2})e(\d{1,3})(?:[ ._-]|$)/i) || base.match(/(?:^|[ ._-])(\d{1,2})x(\d{1,3})(?:[ ._-]|$)/i);

  if (sourceKind === 'series' || episodeMatch) {
    const season = episodeMatch ? Number(episodeMatch[1]) : 1;
    const episode = episodeMatch ? Number(episodeMatch[2]) : undefined;
    const before = episodeMatch ? base.slice(0, episodeMatch.index) : base;
    const after = episodeMatch ? base.slice((episodeMatch.index || 0) + episodeMatch[0].length) : base;
    let seriesTitle = parts.length > 1 ? cleanTitle(parts[0]) : cleanTitle(before);
    seriesTitle = seriesTitle.replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').trim();
    const episodeTitle = cleanTitle(after) || (episode ? `Aflevering ${episode}` : cleanTitle(base));
    return { kind: 'episode', title: episodeTitle, sortTitle: `${seriesTitle} ${String(season).padStart(3, '0')} ${String(episode || 0).padStart(4, '0')}`, seriesTitle, season, episode };
  }

  const yearMatch = base.match(/(?:^|[ ._(\[])((?:19|20)\d{2})(?=[ ._)\]]|$)/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  const titlePart = yearMatch ? base.slice(0, yearMatch.index) : base;
  const title = cleanTitle(titlePart) || cleanTitle(base);
  return { kind: 'movie', title, sortTitle: title.toLocaleLowerCase('nl'), year };
}

async function walk(dir: string): Promise<string[]> {
  const output: string[] = [];
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '$RECYCLE.BIN' || entry.name === 'System Volume Information') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await walk(full));
    else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(full);
  }
  return output;
}

function subtitleFor(filePath: string): string | null {
  const stem = filePath.slice(0, -path.extname(filePath).length);
  return SUBTITLE_EXTENSIONS.map(ext => stem + ext).find(candidate => fs.existsSync(candidate)) || null;
}

export const scanState = { running: false, current: '', scanned: 0, total: 0, errors: 0, startedAt: '', finishedAt: '' };

export async function scanLibrary() {
  if (scanState.running) return;
  Object.assign(scanState, { running: true, current: '', scanned: 0, total: 0, errors: 0, startedAt: new Date().toISOString(), finishedAt: '' });
  try {
    const sources = db.prepare('SELECT id, path, kind FROM sources').all() as { id: number; path: string; kind: 'movies' | 'series' }[];
    const jobs: { source: typeof sources[number]; file: string }[] = [];
    for (const source of sources) for (const file of await walk(source.path)) jobs.push({ source, file });
    scanState.total = jobs.length;
    const seen = new Set<string>();
    const upsert = db.prepare(`INSERT INTO media_items(source_id, kind, title, sort_title, year, series_title, season, episode, file_path, subtitle_path, size, duration, video_codec, audio_codec, width, height, color_transfer,container,probe_json,video_profile,codec_level,pixel_format,bit_depth,frame_rate,bitrate,color_primaries,color_space,hdr_type,dolby_vision_profile,dolby_vision_layer,dolby_vision_enhancement,hdr10_compatibility_layer,audio_profile,audio_channels,audio_layout,atmos,dts_x,subtitle_format)
      VALUES(@sourceId,@kind,@title,@sortTitle,@year,@seriesTitle,@season,@episode,@filePath,@subtitlePath,@size,@duration,@videoCodec,@audioCodec,@width,@height,@colorTransfer,@container,@probeJson,@videoProfile,@codecLevel,@pixelFormat,@bitDepth,@frameRate,@bitrate,@colorPrimaries,@colorSpace,@hdrType,@dolbyVisionProfile,@dolbyVisionLayer,@dolbyVisionEnhancement,@hdr10CompatibilityLayer,@audioProfile,@audioChannels,@audioLayout,@atmos,@dtsX,@subtitleFormat)
      ON CONFLICT(file_path) DO UPDATE SET source_id=excluded.source_id, kind=excluded.kind, title=excluded.title, sort_title=excluded.sort_title,
      year=excluded.year, series_title=excluded.series_title, season=excluded.season, episode=excluded.episode, subtitle_path=excluded.subtitle_path,
      size=excluded.size,duration=excluded.duration,video_codec=excluded.video_codec,audio_codec=excluded.audio_codec,width=excluded.width,height=excluded.height,color_transfer=excluded.color_transfer,
      container=excluded.container,probe_json=excluded.probe_json,video_profile=excluded.video_profile,codec_level=excluded.codec_level,pixel_format=excluded.pixel_format,bit_depth=excluded.bit_depth,frame_rate=excluded.frame_rate,bitrate=excluded.bitrate,color_primaries=excluded.color_primaries,color_space=excluded.color_space,hdr_type=excluded.hdr_type,dolby_vision_profile=excluded.dolby_vision_profile,dolby_vision_layer=excluded.dolby_vision_layer,dolby_vision_enhancement=excluded.dolby_vision_enhancement,hdr10_compatibility_layer=excluded.hdr10_compatibility_layer,audio_profile=excluded.audio_profile,audio_channels=excluded.audio_channels,audio_layout=excluded.audio_layout,atmos=excluded.atmos,dts_x=excluded.dts_x,subtitle_format=excluded.subtitle_format,updated_at=CURRENT_TIMESTAMP`);

    for (const job of jobs) {
      scanState.current = path.basename(job.file);
      seen.add(job.file.toLocaleLowerCase());
      try {
        const parsed = parseMediaName(job.file, job.source.path, job.source.kind);
        const [stat, info] = await Promise.all([fs.promises.stat(job.file), probeMedia(job.file)]);
        upsert.run({ sourceId: job.source.id, ...parsed, year: parsed.year ?? null, seriesTitle: parsed.seriesTitle ?? null, season: parsed.season ?? null, episode: parsed.episode ?? null, filePath: job.file, subtitlePath: subtitleFor(job.file), size: stat.size, ...info });
      } catch { scanState.errors++; }
      scanState.scanned++;
    }

    const all = db.prepare('SELECT id, file_path FROM media_items').all() as { id: number; file_path: string }[];
    const remove = db.prepare('DELETE FROM media_items WHERE id = ?');
    for (const item of all) if (!seen.has(item.file_path.toLocaleLowerCase()) && !fs.existsSync(item.file_path)) remove.run(item.id);
    await scanExtraLibraries(scanState);
    if (getSetting('tmdbToken')) await enrichMedia();
  } finally {
    Object.assign(scanState, { running: false, current: '', finishedAt: new Date().toISOString() });
  }
}
