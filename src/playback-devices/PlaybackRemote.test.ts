import { describe, expect, it } from 'vitest';
import { shouldShowPlaybackRemote } from './PlaybackRemote';

describe('compacte afstandsbediening', () => {
  it('blijft weg bij afspelen in de lokale browser', () => {
    expect(shouldShowPlaybackRemote('local-browser')).toBe(false);
  });

  it('blijft beschikbaar voor externe afspeelapparaten', () => {
    expect(shouldShowPlaybackRemote('dlna-upnp')).toBe(true);
    expect(shouldShowPlaybackRemote('google-cast')).toBe(true);
    expect(shouldShowPlaybackRemote('thuishub-tv-app')).toBe(true);
  });

  it('wordt zonder actieve sessie niet getoond', () => {
    expect(shouldShowPlaybackRemote()).toBe(false);
  });
});
