import { describe, expect, it } from 'vitest';
import { QUALITY_PROFILES, audioFlags, containerFromPath, decisionEngine, hdrFromProbe, type DeviceCapabilities, type MediaCapabilities, type PlaybackInput, type PlaybackMode } from './playback.js';

const media: MediaCapabilities = {
  container:'mp4',videoCodec:'h264',videoProfile:'main',codecLevel:'4.0',width:1920,height:1080,frameRate:24,bitrateMbps:12,bitDepth:8,hdr:'sdr',
  audioCodec:'aac',audioChannels:2,atmos:false,dtsX:false,subtitle:'none'
};

const device: DeviceCapabilities = {
  name:'Test TV',platform:'android-tv',maxWidth:3840,maxHeight:2160,maxFrameRate:60,maxBitrateMbps:80,
  containers:['mp4','mpegts'],videoCodecs:['h264','hevc'],maxBitDepth:10,hdrFormats:['sdr','hdr10','hlg'],dolbyVisionProfiles:[],
  audioCodecs:['aac','ac3','eac3','truehd','dts','dts-hd'],maxAudioChannels:8,passthrough:true,atmos:true,trueHd:true,eac3:true,dts:true,
  subtitleFormats:['srt','webvtt'],arc:'earc'
};

type Case = { name:string; media?:Partial<MediaCapabilities>; device?:Partial<DeviceCapabilities>; input?:Partial<PlaybackInput>; mode:PlaybackMode; copyVideo?:boolean; copyAudio?:boolean; fallback?:string; burn?:boolean };
const cases:Case[] = [
  {name:'H.264/AAC MP4 1080p',mode:'direct_play'},
  {name:'HEVC 10-bit HDR10',media:{videoCodec:'hevc',bitDepth:10,hdr:'hdr10'},mode:'direct_play'},
  {name:'MKV met compatibele streams',media:{container:'mkv'},mode:'direct_stream'},
  {name:'M4V met compatibele streams',media:{container:'m4v'},mode:'direct_stream'},
  {name:'Dolby Vision profiel 8 ondersteund',media:{videoCodec:'hevc',bitDepth:10,hdr:'dolby-vision',dolbyVisionProfile:8},device:{hdrFormats:['sdr','hdr10','dolby-vision'],dolbyVisionProfiles:[8]},mode:'direct_play'},
  {name:'Dolby Vision met echte HDR10-basislaag',media:{videoCodec:'hevc',bitDepth:10,hdr:'dolby-vision',dolbyVisionProfile:7,hasHdr10CompatibilityLayer:true},mode:'direct_play',fallback:'hdr10-compatibility-layer'},
  {name:'HDR10+ valt terug op HDR10-basis',media:{videoCodec:'hevc',bitDepth:10,hdr:'hdr10plus'},mode:'direct_play',fallback:'hdr10plus'},
  {name:'E-AC-3 Atmos passthrough',media:{audioCodec:'eac3',audioChannels:6,atmos:true},mode:'direct_play'},
  {name:'TrueHD Atmos via eARC',media:{audioCodec:'truehd',audioChannels:8,atmos:true},mode:'direct_play'},
  {name:'DTS passthrough',media:{audioCodec:'dts',audioChannels:6},mode:'direct_play'},
  {name:'WebVTT ondertiteling',media:{subtitle:'webvtt'},mode:'direct_play'},
  {name:'AV1 niet ondersteund',media:{videoCodec:'av1'},mode:'transcode',copyVideo:false},
  {name:'H.264-profiel niet ondersteund',media:{videoProfile:'high'},device:{videoProfiles:{h264:['main']}},mode:'transcode',copyVideo:false},
  {name:'H.264-level te hoog',media:{codecLevel:'5.1'},device:{videoLevels:{h264:4.2}},mode:'transcode',copyVideo:false},
  {name:'4K op 1080p-apparaat',media:{width:3840,height:2160,bitrateMbps:35},device:{maxWidth:1920,maxHeight:1080},mode:'transcode',copyVideo:false},
  {name:'120 fps op 60 Hz-apparaat',media:{frameRate:120},mode:'transcode',copyVideo:false},
  {name:'12-bit op 10-bit-apparaat',media:{videoCodec:'hevc',bitDepth:12},mode:'transcode',copyVideo:false},
  {name:'bitrate boven apparaatlimiet',media:{bitrateMbps:100},mode:'transcode',copyVideo:false},
  {name:'gekozen 720p-profiel',input:{quality:'720p'},mode:'transcode',copyVideo:false},
  {name:'automatische bandbreedtebuffer',media:{bitrateMbps:12},input:{quality:'auto',availableBandwidthMbps:10},mode:'transcode',copyVideo:false},
  {name:'PGS wordt ingebrand',media:{subtitle:'pgs'},mode:'transcode',copyVideo:false,burn:true},
  {name:'ASS wordt ingebrand',media:{subtitle:'ass'},mode:'transcode',copyVideo:false,burn:true},
  {name:'HDR10 naar SDR tone-map',media:{videoCodec:'hevc',bitDepth:10,hdr:'hdr10'},device:{hdrFormats:['sdr']},mode:'transcode',copyVideo:false,fallback:'tone-map-sdr'},
  {name:'HDR wordt expliciet als SDR gevraagd',media:{videoCodec:'hevc',bitDepth:10,hdr:'hdr10'},input:{forceSdr:true},mode:'transcode',copyVideo:false,fallback:'tone-map-sdr'},
  {name:'Dolby Vision zonder basislaag naar SDR',media:{videoCodec:'hevc',bitDepth:10,hdr:'dolby-vision',dolbyVisionProfile:7,hasHdr10CompatibilityLayer:false},mode:'transcode',copyVideo:false,fallback:'tone-map-sdr'},
  {name:'Dolby Atmos niet ondersteund',media:{audioCodec:'eac3',audioChannels:6,atmos:true},device:{atmos:false},mode:'transcode',copyVideo:true,copyAudio:false},
  {name:'TrueHD via gewone ARC',media:{audioCodec:'truehd',audioChannels:8,atmos:true},device:{arc:'arc'},mode:'transcode',copyVideo:true,copyAudio:false},
  {name:'DTS zonder passthrough',media:{audioCodec:'dts',audioChannels:6},device:{passthrough:false},mode:'transcode',copyVideo:true,copyAudio:false},
  {name:'te veel audiokanalen',media:{audioCodec:'aac',audioChannels:10},mode:'transcode',copyVideo:true,copyAudio:false},
  {name:'FLAC niet ondersteund',media:{audioCodec:'flac'},mode:'transcode',copyVideo:true,copyAudio:false},
  {name:'aangepaste bitrate 4 Mbps',media:{bitrateMbps:12},input:{quality:'custom',customMaxBitrateMbps:4},mode:'transcode',copyVideo:false},
  {name:'databesparingsprofiel',input:{quality:'data-saver'},mode:'transcode',copyVideo:false},
  {name:'netwerktype wordt bewaard',input:{network:'tailscale'},mode:'direct_play'}
];

describe('centrale playback decision engine',()=>{
  it.each(cases)('$name',entry=>{
    const result=decisionEngine({media:{...media,...entry.media},device:{...device,...entry.device},quality:'original',...entry.input});
    expect(result.mode).toBe(entry.mode);
    if(entry.copyVideo!==undefined)expect(result.copyVideo).toBe(entry.copyVideo);
    if(entry.copyAudio!==undefined)expect(result.copyAudio).toBe(entry.copyAudio);
    if(entry.fallback)expect(result.hdrFallback).toBe(entry.fallback);
    if(entry.burn!==undefined)expect(result.burnSubtitles).toBe(entry.burn);
    if(entry.name==='netwerktype wordt bewaard')expect(result.network).toBe('tailscale');
  });

  it('bevat de afgesproken kwaliteitslimieten',()=>{
    expect(Object.fromEntries(QUALITY_PROFILES.filter(item=>item.maxBitrateMbps).map(item=>[item.id,item.maxBitrateMbps]))).toMatchObject({'4k-max':80,'4k-high':40,'4k-balanced':25,'1080p-max':20,'1080p-high':12,'1080p-balanced':8,'720p':4,'data-saver':2});
  });

  it('herkent container-, HDR- en audio-eigenschappen uit probes',()=>{
    expect(containerFromPath('D:/Films/Voorbeeld.MKV')).toBe('mkv');
    expect(hdrFromProbe({color_transfer:'smpte2084'})).toBe('hdr10');
    expect(hdrFromProbe({side_data_list:[{side_data_type:'DOVI configuration record'}]})).toBe('dolby-vision');
    expect(audioFlags({codec_name:'eac3',profile:'Dolby Digital Plus + Dolby Atmos JOC'})).toMatchObject({atmos:true,eac3:true});
    expect(audioFlags({codec_name:'truehd',tags:{title:'TrueHD Atmos'}})).toMatchObject({atmos:true,trueHd:true});
  });
});
