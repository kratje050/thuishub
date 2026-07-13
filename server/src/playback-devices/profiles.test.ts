import { describe, expect, it } from 'vitest';
import { capabilityProfileFor } from './profiles.js';

describe('apparaatprofielen', () => {
  it('neemt voor onbekende Cast-hardware geen HDR, Atmos of 4K aan', () => {
    const profile = capabilityProfileFor({ protocol: 'google-cast', model: 'Onbekend' });
    expect(profile.maxHeight).toBe(1080);
    expect(profile.hdrFormats).toEqual(['sdr']);
    expect(profile.atmos).toBe(false);
  });
  it('houdt Samsung, Android en algemene DLNA apart', () => {
    expect(capabilityProfileFor({ protocol: 'samsung-tizen' }).platform).toBe('tizen');
    expect(capabilityProfileFor({ protocol: 'android-tv' }).platform).toBe('android-tv');
    expect(capabilityProfileFor({ protocol: 'dlna-upnp' }).platform).toBe('dlna');
  });
});
