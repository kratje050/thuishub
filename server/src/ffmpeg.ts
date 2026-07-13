import ffmpegStatic from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { getSetting } from './db.js';

if (!ffmpegStatic) throw new Error('FFmpeg is niet beschikbaar voor dit platform.');
export const ffmpegPath = ffmpegStatic.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

let gpuNames: string | null = null;

export function detectedGpus() {
  if (gpuNames !== null) return gpuNames.split('|').filter(Boolean);
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', "(Get-CimInstance Win32_VideoController).Name -join '|'"], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    gpuNames = output.trim();
  } catch { gpuNames = ''; }
  return gpuNames.split('|').filter(Boolean);
}

export function videoEncoder() {
  const preference = getSetting('hardwareTranscoding', 'auto');
  if (preference === 'software') return { codec: 'libx264', args: ['-preset', 'veryfast', '-crf', '22'], hardware: false };
  const names = detectedGpus().join(' ').toLowerCase();
  const selected = preference === 'auto'
    ? names.includes('nvidia') ? 'nvidia' : names.includes('intel') ? 'intel' : names.includes('amd') || names.includes('radeon') ? 'amd' : 'software'
    : preference;
  if (selected === 'nvidia') return { codec: 'h264_nvenc', args: ['-preset', 'p4', '-cq', '22', '-b:v', '0'], hardware: true };
  if (selected === 'intel') return { codec: 'h264_qsv', args: ['-preset', 'veryfast', '-global_quality', '23'], hardware: true };
  if (selected === 'amd') return { codec: 'h264_amf', args: ['-quality', 'balanced', '-qp_i', '22', '-qp_p', '24'], hardware: true };
  return { codec: 'libx264', args: ['-preset', 'veryfast', '-crf', '22'], hardware: false };
}

export function videoFilter(colorTransfer?: string | null, maxWidth = 1920) {
  const hdr = ['smpte2084', 'arib-std-b67'].includes((colorTransfer || '').toLowerCase());
  if (hdr && getSetting('toneMapping', 'true') === 'true') {
    return `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale='min(${maxWidth},iw)':-2`;
  }
  return `scale='min(${maxWidth},iw)':-2`;
}
