import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'thuishub-security-'));
process.env.THUIS_HUB_ROOT_DIR=root;process.env.THUIS_HUB_DATA_DIR=path.join(root,'data');process.env.THUIS_HUB_BACKUP_DIR=path.join(root,'backups');process.env.THUIS_HUB_LOG_DIR=path.join(root,'logs');
const database=await import('./db.js');
const tokens=await import('./playback-tokens.js');
const devices=await import('./devices.js');
const network=await import('./network.js');
afterAll(()=>{database.db.close();fs.rmSync(root,{recursive:true,force:true})});

describe('privé-LAN-beperking',()=>{
  it.each([['10.0.0.1',true],['172.16.0.1',true],['172.31.255.254',true],['192.168.1.10',true],['172.15.0.1',false],['172.32.0.1',false],['127.0.0.1',false],['100.64.0.1',false],['8.8.8.8',false],['192.168.1.999',false],['tekst',false]])('%s => %s',(address,expected)=>expect(network.isPrivateIpv4(address)).toBe(expected));
  it('laat op poort 8788 uitsluitend exacte afspeel- en apparaatapp-routes toe',()=>{
    const allowed=network.networkInternals.allowedLanRequest;
    expect(allowed('GET','/api/playback/12/file')).toBe(true);
    expect(allowed('GET','/api/playback/12/file.mp4')).toBe(true);
    expect(allowed('HEAD','/api/playback/12/dlna')).toBe(true);
    expect(allowed('HEAD','/api/playback/12/dlna.ts')).toBe(true);
    expect(allowed('OPTIONS','/api/playback/12/hls/index.m3u8')).toBe(true);
    expect(allowed('POST','/api/device/media/12/session')).toBe(true);
    expect(allowed('POST','/api/device/media/12/decision')).toBe(true);
    expect(allowed('GET','/api/device/media/12/artwork')).toBe(true);
    expect(allowed('GET','/api/metadata/images/12')).toBe(false);
    expect(allowed('POST','/api/playback/12/decision')).toBe(false);
    expect(allowed('POST','/api/devices/pair/approve')).toBe(false);
    expect(allowed('PATCH','/api/settings')).toBe(false);
  });
  it('stelt via de routerpoort nooit beheer, instellingen of het dashboard beschikbaar',()=>{
    const allowed=network.networkInternals.allowedExternalRequest;
    expect(allowed('GET','/api/playback/12/hls/index.m3u8')).toBe(true);
    expect(allowed('GET','/api/device/library')).toBe(true);
    expect(allowed('GET','/api/dashboard')).toBe(false);
    expect(allowed('PATCH','/api/settings')).toBe(false);
    expect(allowed('GET','/')).toBe(false);
  });
  it('controleert adressen met het netmasker van de gekozen interface',()=>{
    expect(network.sameIpv4Subnet('192.168.1.20','192.168.1.200','255.255.255.0')).toBe(true);
    expect(network.sameIpv4Subnet('192.168.2.20','192.168.1.200','255.255.255.0')).toBe(false);
  });
  it('herkent de werkelijke LAN-listener ook als een instelling vóór herstart verandert',()=>{
    expect(network.isLanListenerEndpoint('::ffff:192.168.1.20',8788,'192.168.1.20',8788)).toBe(true);
    expect(network.isLanListenerEndpoint('127.0.0.1',8788,'192.168.1.20',8788)).toBe(false);
    expect(network.isLanListenerEndpoint('192.168.1.20',9000,'192.168.1.20',8788)).toBe(false);
  });
  it('weigert de beheerpoort als LAN-streamingpoort',()=>{
    expect(network.isValidLanStreamingPort(8788,8787)).toBe(true);
    expect(network.isValidLanStreamingPort(8787,8787)).toBe(false);
    expect(network.isValidLanStreamingPort(80,8787)).toBe(false);
  });
  it('maakt tv-playback-URL\'s uitsluitend met een actieve privé-LAN-listener',()=>{
    expect(network.playbackBaseUrlForStatus({enabled:true,address:'192.168.1.20',port:8788,addressPresent:true,listening:true})).toBe('http://192.168.1.20:8788');
    expect(network.playbackBaseUrlForStatus({enabled:true,address:'127.0.0.1',port:8787,addressPresent:true,listening:true})).toBeNull();
    expect(network.playbackBaseUrlForStatus({enabled:true,address:'8.8.8.8',port:8788,addressPresent:true,listening:true})).toBeNull();
    expect(network.playbackBaseUrlForStatus({enabled:true,address:'192.168.1.20',port:8788,addressPresent:true,listening:false})).toBeNull();
  });
});

describe('signed playback-URL',()=>{
  it('bindt een token aan media, resource en opties',()=>{
    const token=tokens.createPlaybackToken({mediaId:42,resource:'hls',userId:1,options:{copyVideo:true,targetBitrateMbps:20}});
    expect(tokens.verifyPlaybackToken(token,42,'hls')).toMatchObject({mediaId:42,resource:'hls',options:{copyVideo:true,targetBitrateMbps:20}});
    expect(tokens.verifyPlaybackToken(token,43,'hls')).toBeNull();expect(tokens.verifyPlaybackToken(token,42,'file')).toBeNull();
  });
  it('weigert manipulatie en verlopen tokens',()=>{
    const token=tokens.createPlaybackToken({mediaId:1,resource:'file'});const [body,signature]=token.split('.');
    expect(tokens.verifyPlaybackToken(`${body}x.${signature}`,1,'file')).toBeNull();
    const payload=Buffer.from(JSON.stringify({mediaId:1,resource:'file',exp:1,nonce:'test'})).toString('base64url');
    const expiredSignature=crypto.createHmac('sha256',tokens.playbackTokenInternals.signingSecret()).update(payload).digest('base64url');
    expect(tokens.verifyPlaybackToken(`${payload}.${expiredSignature}`,1,'file')).toBeNull();
  });
});

describe('apparaatkoppeling',()=>{
  it('slaat alleen een tokenhash op en trekt de sessie in bij vergeten',()=>{
    const userId=Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES('beheerder','test','admin')").run().lastInsertRowid);
    const requested=devices.requestPairing({name:'Test-tv',platform:'android-tv',capabilities:{maxWidth:1920,maxHeight:1080,maxFrameRate:60,maxBitrateMbps:20,containers:['mp4'],videoCodecs:['h264'],maxBitDepth:8,hdrFormats:['sdr'],dolbyVisionProfiles:[],audioCodecs:['aac'],maxAudioChannels:2,passthrough:false,atmos:false,trueHd:false,eac3:false,dts:false,subtitleFormats:['srt']}});
    expect(devices.claimPairing(requested.deviceId,'onjuiste-geheime-sleutel').status).toBe('expired');
    expect(database.db.prepare('SELECT attempts FROM device_pairing_codes WHERE device_id=?').get(requested.deviceId)).toMatchObject({attempts:1});
    expect(requested.code).toMatch(/^\d{6}$/);expect(requested.pairingSecret).not.toContain(requested.code);expect(devices.approvePairing(requested.code,userId)).toBe(true);
    const claimed=devices.claimPairing(requested.deviceId,requested.pairingSecret);expect(claimed.status).toBe('approved');
    if(claimed.status!=='approved')throw new Error('Koppeling niet goedgekeurd');
    const stored=database.db.prepare('SELECT token_hash FROM device_sessions WHERE device_id=?').get(requested.deviceId) as any;
    expect(stored.token_hash).not.toBe(claimed.token);expect(stored.token_hash).toHaveLength(64);expect(devices.deviceCapabilities(requested.deviceId)?.maxWidth).toBe(1920);
    expect(()=>devices.requestPairing({id:requested.deviceId,name:'Vervalste tv',platform:'android-tv',capabilities:{maxWidth:1,maxHeight:1,maxFrameRate:1,maxBitrateMbps:1,containers:[],videoCodecs:[],maxBitDepth:8,hdrFormats:['sdr'],dolbyVisionProfiles:[],audioCodecs:[],maxAudioChannels:2,passthrough:false,atmos:false,trueHd:false,eac3:false,dts:false,subtitleFormats:[]}})).toThrow(/al gekoppeld/i);
    expect(devices.forgetDevice(requested.deviceId)).toBe(true);expect(database.db.prepare('SELECT COUNT(*) n FROM device_sessions WHERE device_id=?').get(requested.deviceId)).toMatchObject({n:0});
  });
  it('weigert een verlopen zescijferige koppelcode',()=>{
    const userId=Number(database.db.prepare("INSERT INTO users(username,password_hash,role) VALUES('verlopen-code','test','admin')").run().lastInsertRowid);
    const requested=devices.requestPairing({name:'Verlopen tv',platform:'tizen',capabilities:{maxWidth:1920,maxHeight:1080,maxFrameRate:60,maxBitrateMbps:20,containers:['mp4'],videoCodecs:['h264'],maxBitDepth:8,hdrFormats:['sdr'],dolbyVisionProfiles:[],audioCodecs:['aac'],maxAudioChannels:2,passthrough:false,atmos:false,trueHd:false,eac3:false,dts:false,subtitleFormats:['webvtt']}});
    database.db.prepare('UPDATE device_pairing_codes SET expires_at=1 WHERE device_id=?').run(requested.deviceId);
    expect(devices.approvePairing(requested.code,userId)).toBe(false);
    expect(devices.claimPairing(requested.deviceId,requested.pairingSecret).status).toBe('expired');
    expect(devices.forgetDevice(requested.deviceId)).toBe(true);
  });
});
