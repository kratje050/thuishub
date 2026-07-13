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
    expect(requested.code).toMatch(/^\d{6}$/);expect(requested.pairingSecret).not.toContain(requested.code);expect(devices.approvePairing(requested.code,userId)).toBe(true);
    const claimed=devices.claimPairing(requested.deviceId,requested.pairingSecret);expect(claimed.status).toBe('approved');
    if(claimed.status!=='approved')throw new Error('Koppeling niet goedgekeurd');
    const stored=database.db.prepare('SELECT token_hash FROM device_sessions WHERE device_id=?').get(requested.deviceId) as any;
    expect(stored.token_hash).not.toBe(claimed.token);expect(stored.token_hash).toHaveLength(64);expect(devices.deviceCapabilities(requested.deviceId)?.maxWidth).toBe(1920);
    expect(devices.forgetDevice(requested.deviceId)).toBe(true);expect(database.db.prepare('SELECT COUNT(*) n FROM device_sessions WHERE device_id=?').get(requested.deviceId)).toMatchObject({n:0});
  });
});
