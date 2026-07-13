import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffprobe from 'ffprobe-static';
import { audioFlags, containerFromPath, hdrFromProbe, type MediaCapabilities, type SubtitleKind } from './playback.js';

const execFileAsync = promisify(execFile);
const ffprobePath = ffprobe.path.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

function rational(value?: string) {
  const [left, right] = String(value || '').split('/').map(Number);
  return right ? left / right : left || undefined;
}

function bitDepth(video: any) {
  if (Number(video?.bits_per_raw_sample)) return Number(video.bits_per_raw_sample);
  const match = String(video?.pix_fmt || '').match(/(?:p|yuv|gbrp)(9|10|12|14|16)(?:le|be)?$/i);
  return match ? Number(match[1]) : 8;
}

function dolbyVisionDetails(video: any) {
  const text = JSON.stringify(video?.side_data_list || []).toLowerCase();
  const profile = Number(text.match(/(?:dv_profile|profile)["': ]+(\d+)/)?.[1] || 0) || undefined;
  const enhancement = /fel/.test(text) ? 'fel' as const : /mel/.test(text) ? 'mel' as const : undefined;
  const layer = /el_present["': ]+(?:1|true)/.test(text) ? 'dual' as const : profile ? 'single' as const : undefined;
  const hasHdr10CompatibilityLayer = /bl_signal_compatibility_id["': ]+(?:1|2|4)/.test(text) || profile === 7 || profile === 8;
  return { profile, enhancement, layer, hasHdr10CompatibilityLayer };
}

function subtitleKind(stream: any): SubtitleKind {
  const codec = String(stream?.codec_name || '').toLowerCase();
  if (codec === 'subrip') return 'srt';
  if (codec === 'webvtt') return 'webvtt';
  if (codec === 'ass') return 'ass';
  if (codec === 'ssa') return 'ssa';
  if (codec === 'hdmv_pgs_subtitle') return 'pgs';
  if (codec === 'dvd_subtitle') return 'vobsub';
  return codec ? 'unknown' : 'none';
}

export type DetailedMediaInfo = {
  duration: number | null; videoCodec: string | null; audioCodec: string | null; width: number | null; height: number | null; colorTransfer: string | null;
  container: string; probeJson: string; videoProfile: string | null; codecLevel: string | null; pixelFormat: string | null; bitDepth: number;
  frameRate: number | null; bitrate: number | null; colorPrimaries: string | null; colorSpace: string | null; hdrType: string;
  dolbyVisionProfile: number | null; dolbyVisionLayer: string | null; dolbyVisionEnhancement: string | null; hdr10CompatibilityLayer: number;
  audioProfile: string | null; audioChannels: number | null; audioLayout: string | null; atmos: number; dtsX: number; subtitleFormat: string;
};

export function mapProbe(filePath: string, json: any): DetailedMediaInfo {
  const video = json.streams?.find((stream: any) => stream.codec_type === 'video') || {};
  const audio = json.streams?.find((stream: any) => stream.codec_type === 'audio') || {};
  const subtitle = json.streams?.find((stream: any) => stream.codec_type === 'subtitle');
  const dv = dolbyVisionDetails(video);
  const audioMetadata = audioFlags(audio);
  return {
    duration: Number(json.format?.duration) || null, videoCodec: video.codec_name || null, audioCodec: audio.codec_name || null,
    width: video.width || null, height: video.height || null, colorTransfer: video.color_transfer || null,
    container: containerFromPath(filePath), probeJson: JSON.stringify(json), videoProfile: video.profile || null,
    codecLevel: video.level === undefined ? null : String(video.level), pixelFormat: video.pix_fmt || null, bitDepth: bitDepth(video),
    frameRate: rational(video.avg_frame_rate || video.r_frame_rate) || null,
    bitrate: Number(video.bit_rate || json.format?.bit_rate) || null, colorPrimaries: video.color_primaries || null, colorSpace: video.color_space || null,
    hdrType: hdrFromProbe(video), dolbyVisionProfile: dv.profile || null, dolbyVisionLayer: dv.layer || null,
    dolbyVisionEnhancement: dv.enhancement || null, hdr10CompatibilityLayer: Number(dv.hasHdr10CompatibilityLayer),
    audioProfile: audio.profile || null, audioChannels: audio.channels || null, audioLayout: audio.channel_layout || null,
    atmos: Number(audioMetadata.atmos), dtsX: Number(audioMetadata.dtsX), subtitleFormat: subtitleKind(subtitle)
  };
}

export async function probeMedia(filePath: string): Promise<DetailedMediaInfo> {
  try {
    const { stdout } = await execFileAsync(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', filePath], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    return mapProbe(filePath, JSON.parse(stdout));
  } catch {
    return mapProbe(filePath, { format: {}, streams: [] });
  }
}

export function mediaCapabilitiesFromRow(row: any): MediaCapabilities {
  return {
    container: row.container || containerFromPath(row.file_path || ''), videoCodec: row.video_codec || '', videoProfile: row.video_profile || undefined,
    codecLevel: row.codec_level || undefined, width: row.width || undefined, height: row.height || undefined, frameRate: row.frame_rate || undefined,
    bitrateMbps: row.bitrate ? row.bitrate / 1_000_000 : undefined, bitDepth: row.bit_depth || 8, pixelFormat: row.pixel_format || undefined,
    colorPrimaries: row.color_primaries || undefined, colorTransfer: row.color_transfer || undefined, colorSpace: row.color_space || undefined,
    hdr: row.hdr_type || hdrFromProbe({ color_transfer: row.color_transfer }), dolbyVisionProfile: row.dolby_vision_profile || undefined,
    dolbyVisionLayer: row.dolby_vision_layer || undefined, dolbyVisionEnhancement: row.dolby_vision_enhancement || undefined,
    hasHdr10CompatibilityLayer: Boolean(row.hdr10_compatibility_layer), audioCodec: row.audio_codec || '', audioProfile: row.audio_profile || undefined,
    audioChannels: row.audio_channels || undefined, audioLayout: row.audio_layout || undefined, atmos: Boolean(row.atmos), dtsX: Boolean(row.dts_x),
    subtitle: row.subtitle_format || (row.subtitle_path ? 'srt' : 'none')
  };
}
