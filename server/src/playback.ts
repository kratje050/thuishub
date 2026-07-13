import path from 'node:path';

export type PlaybackMode = 'direct_play' | 'direct_stream' | 'transcode';
export type NetworkType = 'lan' | 'tailscale' | 'mobile' | 'unknown';
export type HdrFormat = 'sdr' | 'hdr10' | 'hdr10plus' | 'hlg' | 'dolby-vision';
export type SubtitleKind = 'none' | 'srt' | 'webvtt' | 'ass' | 'ssa' | 'pgs' | 'vobsub' | 'unknown';

export type MediaCapabilities = {
  container: string;
  videoCodec: string;
  videoProfile?: string;
  codecLevel?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  bitrateMbps?: number;
  bitDepth?: number;
  pixelFormat?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
  colorSpace?: string;
  hdr: HdrFormat;
  dolbyVisionProfile?: number;
  dolbyVisionLayer?: 'single' | 'dual';
  dolbyVisionEnhancement?: 'mel' | 'fel';
  hasHdr10CompatibilityLayer?: boolean;
  audioCodec: string;
  audioProfile?: string;
  audioChannels?: number;
  audioLayout?: string;
  atmos?: boolean;
  dtsX?: boolean;
  subtitle?: SubtitleKind;
  subtitleForced?: boolean;
};

export type DeviceCapabilities = {
  id?: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  platform?: string;
  appVersion?: string;
  maxWidth: number;
  maxHeight: number;
  maxFrameRate: number;
  maxBitrateMbps: number;
  containers: string[];
  videoCodecs: string[];
  videoProfiles?: Record<string, string[]>;
  videoLevels?: Record<string, number>;
  maxBitDepth: number;
  hdrFormats: HdrFormat[];
  dolbyVisionProfiles: number[];
  audioCodecs: string[];
  maxAudioChannels: number;
  passthrough: boolean;
  atmos: boolean;
  trueHd: boolean;
  eac3: boolean;
  dts: boolean;
  subtitleFormats: SubtitleKind[];
  arc?: 'none' | 'arc' | 'earc' | 'unknown';
  play?: boolean;
  pause?: boolean;
  stop?: boolean;
  seek?: boolean;
  position?: boolean;
  volume?: boolean;
  next?: boolean;
  previous?: boolean;
  audioTrackSelection?: boolean;
  subtitleTrackSelection?: boolean;
  qualitySelection?: boolean;
};

export type QualityId = 'auto' | 'original' | '4k-max' | '4k-high' | '4k-balanced' | '1080p-max' | '1080p-high' | '1080p-balanced' | '720p' | 'data-saver' | 'custom';
export type QualityProfile = { id: QualityId; label: string; maxWidth?: number; maxHeight?: number; maxBitrateMbps?: number };

export const QUALITY_PROFILES: QualityProfile[] = [
  { id: 'auto', label: 'Automatisch' },
  { id: 'original', label: 'Origineel' },
  { id: '4k-max', label: '4K Maximum', maxWidth: 3840, maxHeight: 2160, maxBitrateMbps: 80 },
  { id: '4k-high', label: '4K Hoog', maxWidth: 3840, maxHeight: 2160, maxBitrateMbps: 40 },
  { id: '4k-balanced', label: '4K Gebalanceerd', maxWidth: 3840, maxHeight: 2160, maxBitrateMbps: 25 },
  { id: '1080p-max', label: '1080p Maximum', maxWidth: 1920, maxHeight: 1080, maxBitrateMbps: 20 },
  { id: '1080p-high', label: '1080p Hoog', maxWidth: 1920, maxHeight: 1080, maxBitrateMbps: 12 },
  { id: '1080p-balanced', label: '1080p Gebalanceerd', maxWidth: 1920, maxHeight: 1080, maxBitrateMbps: 8 },
  { id: '720p', label: '720p', maxWidth: 1280, maxHeight: 720, maxBitrateMbps: 4 },
  { id: 'data-saver', label: 'Databesparing', maxWidth: 854, maxHeight: 480, maxBitrateMbps: 2 },
  { id: 'custom', label: 'Aangepast' },
];

export type PlaybackInput = {
  media: MediaCapabilities;
  device: DeviceCapabilities;
  quality?: QualityId;
  customMaxBitrateMbps?: number;
  availableBandwidthMbps?: number;
  network?: NetworkType;
  forceSdr?: boolean;
};

export type PlaybackDecision = {
  mode: PlaybackMode;
  label: 'Direct Play' | 'Direct Stream' | 'Transcode';
  reasons: string[];
  outputContainer: string;
  outputVideoCodec: string;
  outputAudioCodec: string;
  copyVideo: boolean;
  copyAudio: boolean;
  burnSubtitles: boolean;
  preserveHdr: boolean;
  preserveDolbyVision: boolean;
  preserveAtmos: boolean;
  hdrFallback?: 'hdr10-compatibility-layer' | 'hdr10plus' | 'tone-map-sdr';
  targetBitrateMbps?: number;
  targetWidth?: number;
  targetHeight?: number;
  network: NetworkType;
};

const normalize = (value?: string) => String(value || '').toLowerCase().replace(/[_.\s-]/g, '');
const has = (values: string[], value: string) => values.some(candidate => normalize(candidate) === normalize(value));

export function containerFromPath(filePath: string) {
  return path.extname(filePath).slice(1).toLowerCase();
}

export function hdrFromProbe(probe: any): HdrFormat {
  const sideData = JSON.stringify(probe?.side_data_list || probe?.sideData || '').toLowerCase();
  const profile = String(probe?.codec_tag_string || probe?.profile || '').toLowerCase();
  const transfer = String(probe?.color_transfer || probe?.colorTransfer || '').toLowerCase();
  if (/dovi|dolby.?vision/.test(`${sideData} ${profile}`)) return 'dolby-vision';
  if (/hdr10\+|smpte2094/.test(sideData)) return 'hdr10plus';
  if (transfer === 'arib-std-b67') return 'hlg';
  if (transfer === 'smpte2084') return 'hdr10';
  return 'sdr';
}

export function audioFlags(stream: any) {
  const text = JSON.stringify(stream || {}).toLowerCase();
  const codec = normalize(stream?.codec_name);
  const profile = normalize(stream?.profile);
  const atmos = /atmos|joc/.test(text) || (codec === 'truehd' && /atmos/.test(text));
  return { atmos, dtsX: /dts[: -]?x/.test(text), trueHd: codec === 'truehd', eac3: codec === 'eac3' || profile.includes('eac3') };
}

export function decisionEngine(input: PlaybackInput): PlaybackDecision {
  const media = input.media;
  const device = input.device;
  const quality = QUALITY_PROFILES.find(item => item.id === (input.quality || 'auto')) || QUALITY_PROFILES[0];
  const reasons: string[] = [];
  const profileRules = device.videoProfiles?.[media.videoCodec] || Object.entries(device.videoProfiles || {}).find(([codec]) => normalize(codec) === normalize(media.videoCodec))?.[1];
  const levelRule = device.videoLevels?.[media.videoCodec] || Object.entries(device.videoLevels || {}).find(([codec]) => normalize(codec) === normalize(media.videoCodec))?.[1];
  const videoProfileCompatible = !profileRules?.length || !media.videoProfile || has(profileRules, media.videoProfile);
  const videoLevelCompatible = !levelRule || !media.codecLevel || Number.parseFloat(media.codecLevel) <= levelRule;
  const videoCompatible = has(device.videoCodecs, media.videoCodec) && videoProfileCompatible && videoLevelCompatible;
  const audioCompatible = has(device.audioCodecs, media.audioCodec) && (media.audioChannels || 2) <= device.maxAudioChannels;
  const containerCompatible = has(device.containers, media.container);
  const resolutionCompatible = (media.width || 0) <= device.maxWidth && (media.height || 0) <= device.maxHeight;
  const frameRateCompatible = (media.frameRate || 0) <= device.maxFrameRate;
  const bitDepthCompatible = (media.bitDepth || 8) <= device.maxBitDepth;
  const subtitleCompatible = !media.subtitle || media.subtitle === 'none' || device.subtitleFormats.includes(media.subtitle);
  const burnSubtitles = !subtitleCompatible;

  let preserveHdr = media.hdr === 'sdr' || device.hdrFormats.includes(media.hdr);
  let preserveDolbyVision = media.hdr === 'dolby-vision' && preserveHdr && Boolean(media.dolbyVisionProfile && device.dolbyVisionProfiles.includes(media.dolbyVisionProfile));
  let hdrFallback: PlaybackDecision['hdrFallback'];
  if (input.forceSdr && media.hdr !== 'sdr') {
    hdrFallback = 'tone-map-sdr'; preserveHdr = false; preserveDolbyVision = false;
  } else if (media.hdr === 'dolby-vision' && !preserveDolbyVision) {
    if (media.hasHdr10CompatibilityLayer && device.hdrFormats.includes('hdr10')) { hdrFallback = 'hdr10-compatibility-layer'; preserveHdr = true; }
    else { hdrFallback = 'tone-map-sdr'; preserveHdr = false; }
  } else if (media.hdr === 'hdr10plus' && !preserveHdr && device.hdrFormats.includes('hdr10')) {
    hdrFallback = 'hdr10plus'; preserveHdr = true;
  } else if (media.hdr !== 'sdr' && !preserveHdr) hdrFallback = 'tone-map-sdr';

  const atmosCompatible = !media.atmos || (device.atmos && device.passthrough && (has(device.audioCodecs, media.audioCodec)));
  const trueHdCompatible = normalize(media.audioCodec) !== 'truehd' || (device.trueHd && device.passthrough && device.arc === 'earc');
  const dtsCompatible = !normalize(media.audioCodec).startsWith('dts') || (device.dts && device.passthrough);
  const preserveAtmos = Boolean(media.atmos && atmosCompatible && trueHdCompatible);

  const selectedLimit = input.quality === 'custom' ? input.customMaxBitrateMbps : quality.maxBitrateMbps;
  const automaticLimit = input.quality === 'auto' && input.availableBandwidthMbps ? Math.max(1, input.availableBandwidthMbps * 0.8) : undefined;
  const bitrateLimit = selectedLimit || automaticLimit || device.maxBitrateMbps;
  const bandwidthCompatible = !media.bitrateMbps || !bitrateLimit || media.bitrateMbps <= Math.min(bitrateLimit, device.maxBitrateMbps);
  const qualityResolutionCompatible = !quality.maxHeight || (media.height || 0) <= quality.maxHeight;

  if (!has(device.videoCodecs, media.videoCodec)) reasons.push(`Videocodec ${media.videoCodec || 'onbekend'} wordt niet ondersteund.`);
  if (!videoProfileCompatible) reasons.push(`Videoprofiel ${media.videoProfile || 'onbekend'} wordt niet ondersteund.`);
  if (!videoLevelCompatible) reasons.push(`Codec-level ${media.codecLevel || 'onbekend'} is hoger dan het apparaat ondersteunt.`);
  if (!audioCompatible) reasons.push(`Audiocodec of kanaalindeling ${media.audioCodec || 'onbekend'} wordt niet ondersteund.`);
  if (!containerCompatible) reasons.push(`Container ${media.container || 'onbekend'} wordt niet ondersteund.`);
  if (!resolutionCompatible || !qualityResolutionCompatible) reasons.push('De resolutie is hoger dan het apparaat of kwaliteitsprofiel toestaat.');
  if (!frameRateCompatible) reasons.push('De framerate is hoger dan het apparaat ondersteunt.');
  if (!bitDepthCompatible) reasons.push(`${media.bitDepth || 8}-bit video wordt niet ondersteund.`);
  if (!bandwidthCompatible) reasons.push('De beschikbare bandbreedte of gekozen kwaliteit is onvoldoende voor het origineel.');
  if (burnSubtitles) reasons.push(`Ondertitelformaat ${media.subtitle} moet worden ingebrand.`);
  if (hdrFallback === 'tone-map-sdr') reasons.push(`${media.hdr} wordt door dit apparaat niet ondersteund; tone-mapping naar SDR is nodig.`);
  if (media.hdr === 'dolby-vision' && !preserveDolbyVision && hdrFallback === 'hdr10-compatibility-layer') reasons.push('Dolby Vision is niet compatibel; de echte HDR10-compatibiliteitslaag wordt gebruikt.');
  if (media.hdr === 'hdr10plus' && hdrFallback === 'hdr10plus') reasons.push('HDR10+ wordt als de compatibele HDR10-basislaag afgespeeld.');
  if (media.atmos && !preserveAtmos) reasons.push('Dolby Atmos kan niet door de volledige audioketen worden doorgegeven.');
  if (!trueHdCompatible) reasons.push('TrueHD-passthrough vereist een compatibel apparaat en HDMI eARC.');
  if (!dtsCompatible) reasons.push('DTS-passthrough wordt niet ondersteund.');

  const mustTranscodeVideo = !videoCompatible || !resolutionCompatible || !qualityResolutionCompatible || !frameRateCompatible || !bitDepthCompatible || !bandwidthCompatible || burnSubtitles || hdrFallback === 'tone-map-sdr';
  const mustTranscodeAudio = !audioCompatible || !atmosCompatible || !trueHdCompatible || !dtsCompatible;

  if (!mustTranscodeVideo && !mustTranscodeAudio && containerCompatible) {
    return { mode: 'direct_play', label: 'Direct Play', reasons: [], outputContainer: media.container, outputVideoCodec: media.videoCodec, outputAudioCodec: media.audioCodec, copyVideo: true, copyAudio: true, burnSubtitles: false, preserveHdr: true, preserveDolbyVision, preserveAtmos, hdrFallback, network: input.network || 'unknown' };
  }

  if (!mustTranscodeVideo && !mustTranscodeAudio) {
    const outputContainer = device.containers.find(item => ['mp4', 'mpegts', 'mkv', 'webm'].includes(normalize(item))) || device.containers[0] || 'mp4';
    return { mode: 'direct_stream', label: 'Direct Stream', reasons, outputContainer, outputVideoCodec: media.videoCodec, outputAudioCodec: media.audioCodec, copyVideo: true, copyAudio: true, burnSubtitles: false, preserveHdr: true, preserveDolbyVision, preserveAtmos, hdrFallback, network: input.network || 'unknown' };
  }

  const targetHeight = Math.min(media.height || device.maxHeight, quality.maxHeight || device.maxHeight);
  const targetWidth = Math.min(media.width || device.maxWidth, quality.maxWidth || device.maxWidth);
  return {
    mode: 'transcode', label: 'Transcode', reasons, outputContainer: device.containers.includes('mpegts') ? 'mpegts' : 'mp4',
    outputVideoCodec: mustTranscodeVideo ? (has(device.videoCodecs, 'hevc') && device.maxBitDepth >= 10 ? 'hevc' : 'h264') : media.videoCodec,
    outputAudioCodec: mustTranscodeAudio ? (device.eac3 && has(device.audioCodecs, 'eac3') ? 'eac3' : has(device.audioCodecs, 'ac3') ? 'ac3' : 'aac') : media.audioCodec,
    copyVideo: !mustTranscodeVideo, copyAudio: !mustTranscodeAudio, burnSubtitles, preserveHdr: !mustTranscodeVideo && preserveHdr,
    preserveDolbyVision: !mustTranscodeVideo && preserveDolbyVision, preserveAtmos: !mustTranscodeAudio && preserveAtmos, hdrFallback,
    targetBitrateMbps: Math.min(bitrateLimit || device.maxBitrateMbps, device.maxBitrateMbps), targetWidth, targetHeight, network: input.network || 'unknown'
  };
}

export const BROWSER_CAPABILITIES: DeviceCapabilities = {
  name: 'Moderne browser', platform: 'web', maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, maxBitrateMbps: 80,
  containers: ['mp4', 'm4v', 'webm'], videoCodecs: ['h264', 'av1', 'vp9'], maxBitDepth: 10, hdrFormats: ['sdr'], dolbyVisionProfiles: [],
  audioCodecs: ['aac', 'mp3', 'opus'], maxAudioChannels: 2, passthrough: false, atmos: false, trueHd: false, eac3: false, dts: false,
  subtitleFormats: ['srt', 'webvtt'], arc: 'unknown', play: true, pause: true, stop: true, seek: true, position: true, volume: true
};

export const CAST_CAPABILITIES: DeviceCapabilities = {
  // De Web Sender SDK meldt geen betrouwbaar hardwareprofiel. Gebruik daarom
  // een conservatieve gemeenschappelijke basis; specifieke tv-apps rapporteren
  // hun eigen capaciteiten en beheerders kunnen per apparaat overrides zetten.
  name: 'Google Cast (veilig standaardprofiel)', platform: 'cast', maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30, maxBitrateMbps: 20,
  containers: ['mp4', 'webm'], videoCodecs: ['h264', 'vp8'], maxBitDepth: 8,
  hdrFormats: ['sdr'], dolbyVisionProfiles: [], audioCodecs: ['aac', 'mp3'],
  maxAudioChannels: 2, passthrough: false, atmos: false, trueHd: false, eac3: false, dts: false, subtitleFormats: ['webvtt'], arc: 'unknown',
  play: true, pause: true, stop: true, seek: true, position: true, volume: true
};
