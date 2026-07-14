import type { DeviceCapabilities } from '../playback.js';
import type { PlaybackDeviceProtocol } from './types.js';

const stereo1080: DeviceCapabilities = {
  maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30, maxBitrateMbps: 20,
  containers: ['mp4'], videoCodecs: ['h264'], maxBitDepth: 8, hdrFormats: ['sdr'], dolbyVisionProfiles: [],
  audioCodecs: ['aac'], maxAudioChannels: 2, passthrough: false, atmos: false, trueHd: false, eac3: false,
  dts: false, subtitleFormats: ['webvtt'], arc: 'unknown', play: true, pause: true, stop: true, seek: true, position: true, volume: false,
};

export const DEVICE_CAPABILITY_PROFILES: Record<string, DeviceCapabilities> = {
  'chromecast-legacy': { ...stereo1080, name: 'Chromecast (basis)', platform: 'cast', containers: ['mp4','webm'], videoCodecs: ['h264','vp8'] },
  'chromecast-ultra': { ...stereo1080, name: 'Chromecast Ultra', platform: 'cast', maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, maxBitrateMbps: 40, containers: ['mp4','webm'], videoCodecs: ['h264','hevc','vp9'], maxBitDepth: 10, hdrFormats: ['sdr','hdr10','dolby-vision'], dolbyVisionProfiles: [5], audioCodecs: ['aac','ac3','eac3'], maxAudioChannels: 6, eac3: true },
  'google-tv': { ...stereo1080, name: 'Google TV', platform: 'google-tv', maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, maxBitrateMbps: 60, containers: ['mp4','webm','mpegts'], videoCodecs: ['h264','hevc','vp9'], maxBitDepth: 10, hdrFormats: ['sdr','hdr10','hlg'], audioCodecs: ['aac','ac3','eac3','opus'], maxAudioChannels: 8, passthrough: true, eac3: true },
  'android-tv': { ...stereo1080, name: 'Android TV', platform: 'android-tv', maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, maxBitrateMbps: 50, containers: ['mp4','mkv','webm','mpegts'], videoCodecs: ['h264','hevc','vp9'], maxBitDepth: 10, hdrFormats: ['sdr','hdr10','hlg'], audioCodecs: ['aac','ac3','eac3','opus'], maxAudioChannels: 8, eac3: true },
  'samsung-tizen': { ...stereo1080, name: 'Samsung Tizen', platform: 'tizen', maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, maxBitrateMbps: 50, containers: ['mp4','mkv','mpegts'], videoCodecs: ['h264','hevc'], maxBitDepth: 10, hdrFormats: ['sdr','hdr10','hdr10plus'], audioCodecs: ['aac','ac3','eac3'], maxAudioChannels: 6, eac3: true },
  'dlna-generic': { ...stereo1080, name: 'DLNA MediaRenderer', platform: 'dlna', maxBitrateMbps: 12, subtitleFormats: ['none'] },
  'thuishub-tv-app': { ...stereo1080, name: 'ThuisHub TV-app', platform: 'thuishub-tv-app', containers: ['mp4','mkv','webm','mpegts'], videoCodecs: ['h264','hevc','vp9'], audioCodecs: ['aac','ac3','eac3','opus'], maxAudioChannels: 8, subtitleFormats: ['srt','webvtt'] },
};

export function capabilityProfileFor(input: { protocol: PlaybackDeviceProtocol; manufacturer?: string; model?: string; platform?: string }) {
  const text = `${input.manufacturer || ''} ${input.model || ''} ${input.platform || ''}`.toLowerCase();
  if (input.protocol === 'samsung-tizen' || /samsung|tizen|qe65qef1auxxn/.test(text)) return DEVICE_CAPABILITY_PROFILES['samsung-tizen'];
  if (input.protocol === 'dlna-upnp') return DEVICE_CAPABILITY_PROFILES['dlna-generic'];
  if (input.protocol === 'android-tv') return DEVICE_CAPABILITY_PROFILES['android-tv'];
  if (input.protocol === 'thuishub-tv-app') return DEVICE_CAPABILITY_PROFILES['thuishub-tv-app'];
  if (input.protocol === 'google-cast') {
    if (/ultra/.test(text)) return DEVICE_CAPABILITY_PROFILES['chromecast-ultra'];
    if (/google tv|tv streamer/.test(text)) return DEVICE_CAPABILITY_PROFILES['google-tv'];
    return DEVICE_CAPABILITY_PROFILES['chromecast-legacy'];
  }
  return stereo1080;
}
