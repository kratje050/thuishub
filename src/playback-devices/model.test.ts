import { describe, expect, it } from 'vitest';
import { groupPlaybackDevices, LOCAL_BROWSER_DEVICE, modelInternals, normalizeDeviceList, normalizePlaybackSession } from './model';

describe('uniforme apparaatmodellen', () => {
  it('normaliseert protocolnamen en toont geen netwerkadres in het UI-model', () => {
    const [device] = normalizeDeviceList({ items: [{ id: 'tv-1', name: 'Woonkamer-tv', platform: 'tizen', manufacturer: 'Samsung', address: '192.168.1.50', trusted: true, online: true }] });
    expect(device).toMatchObject({ id: 'tv-1', protocol: 'samsung-tizen', trusted: true, online: true });
    expect(device).not.toHaveProperty('address');
  });

  it('dedupliceert identieke IDs en groepeert gekoppeld, ander en lokaal', () => {
    const devices = normalizeDeviceList([
      { id: 'mine', name: 'ThuisHub TV', protocol: 'thuishub-tv-app', online: true, paired: true },
      { id: 'other', name: 'Samsung QLED', protocol: 'dlna-upnp', online: true },
      { id: 'other', name: 'Dubbele response', protocol: 'dlna-upnp', online: true },
      LOCAL_BROWSER_DEVICE,
    ]);
    const groups = groupPlaybackDevices(devices);
    expect(groups.mine.map(item => item.id)).toEqual(['mine']);
    expect(groups.other.map(item => item.id)).toEqual(['other']);
    expect(groups.local).toHaveLength(1);
    expect(groups.local[0].id).toMatch(/^local-browser:[a-zA-Z0-9_-]{8,80}$/);
  });

  it('maakt voor twee browserpagina\'s verschillende receiver-identiteiten', () => {
    const first = modelInternals.createLocalBrowserReceiverId();
    const second = modelInternals.createLocalBrowserReceiverId();
    expect(first).toMatch(/^[a-zA-Z0-9_-]{8,80}$/);
    expect(second).toMatch(/^[a-zA-Z0-9_-]{8,80}$/);
    expect(second).not.toBe(first);
  });

  it('behandelt onlineState offline als werkelijk offline', () => {
    const [device] = normalizeDeviceList({ items: [{ id: 'offline-tv', name: 'Oude tv', protocol: 'dlna-upnp', onlineState: 'offline' }] });
    expect(device).toMatchObject({ online: false, status: 'offline' });
  });

  it('accepteert zowel een directe sessie als een omhulde API-response', () => {
    expect(normalizePlaybackSession({ id: 12, deviceId: 'tv', deviceName: 'TV', protocol: 'dlna', state: 'playing' }).session).toMatchObject({ id: '12', protocol: 'dlna-upnp' });
    expect(normalizePlaybackSession({ session: { id: 'abc', device: { id: 'app', name: 'Slaapkamer' }, protocol: 'android-tv', state: 'paused' }, urls: { playback: 'http://192.168.1.2/test' } })).toMatchObject({ session: { id: 'abc', deviceName: 'Slaapkamer' }, urls: { playback: 'http://192.168.1.2/test' } });
  });

  it('neemt bedieningsmogelijkheden en artwork over van het gekozen apparaat', () => {
    const result = normalizePlaybackSession({
      session: { id: 'sessie', deviceId: 'tv', protocol: 'dlna-upnp', state: 'playing', metadata: { quality: 'original' } },
      device: { id: 'tv', name: 'TV', capabilities: { seek: true, volume: false, next: false } },
      urls: { artwork: 'http://192.168.1.20:8788/api/playback/1/artwork?token=test' },
    });
    expect(result.session).toMatchObject({ canSeek: true, canSetVolume: false, canSkipNext: false, quality: 'original', posterUrl: expect.stringContaining('/artwork') });
  });
});
