import { useEffect, useState } from 'react';
import { post, type MediaItem, type Settings } from './api';
import { castAvailable, castController, castMedia, describeCastEnvironment, disconnectCast, initializeCast } from './cast';
import { useOptionalPlaybackDevices } from './playback-devices';

export function CastButton({ item, settings, onError, getStartPosition }: { item: MediaItem; settings: Settings; onError: (message: string) => void; getStartPosition?: () => number }) {
  const playbackDevices = useOptionalPlaybackDevices();
  const [ready, setReady] = useState(castAvailable());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () => setReady(initializeCast(settings.castReceiverAppId));
    window.addEventListener('thuishub-cast-ready', update); update();
    return () => window.removeEventListener('thuishub-cast-ready', update);
  }, [settings.castReceiverAppId]);

  async function start() {
    const startPosition = Math.max(0, Number(getStartPosition?.() ?? item.progress?.position ?? 0));
    if (playbackDevices) {
      playbackDevices.openPicker(item, startPosition);
      return;
    }
    setBusy(true);
    try {
      const result = await post<any>(`/playback/${item.id}/decision`, { target: 'cast', quality: settings.defaultQualityLan, network: 'lan' });
      if (result.localStreamingRequired) throw new Error('Schakel eerst Instellingen → Netwerk → Streamen binnen thuisnetwerk in en herstart ThuisHub.');
      await castMedia(item, result.urls, result.decision, startPosition);
      window.dispatchEvent(new Event('thuishub-cast-session'));
    } catch (error: any) { onError(error.message || 'Cast kon niet starten.'); }
    finally { setBusy(false); }
  }

  const disabled = playbackDevices ? playbackDevices.busy : !ready || busy;
  const label = playbackDevices ? 'Afspelen op apparaat' : 'Afspelen op tv';
  const title = playbackDevices ? 'Kies een tv of mediaspeler' : ready ? 'Open de officiële Google Cast-apparaatkiezer' : describeCastEnvironment().message;
  return <button type="button" className="tv-play-button" disabled={disabled} aria-busy={busy} aria-label={label} onClick={() => void start()} title={title}>{busy ? 'Verbinden…' : `▣ ${label}`}</button>;
}
// Behouden voor losse integraties buiten de centrale apparaatlaag.
export function CastRemote() {
  const [active, setActive] = useState(false); const [playing, setPlaying] = useState(false); const [volume, setVolume] = useState(1);
  useEffect(() => {
    const refresh = () => { const remote = castController(); setActive(Boolean(remote)); if (remote) { setPlaying(!remote.player.isPaused && !remote.player.isIdle); setVolume(Number(remote.player.volumeLevel ?? 1)); } };
    window.addEventListener('thuishub-cast-session', refresh); const timer = setInterval(refresh, 2000); refresh();
    return () => { clearInterval(timer); window.removeEventListener('thuishub-cast-session', refresh); };
  }, []);
  if (!active) return null;
  const remote = () => castController();
  return <aside className="cast-remote" aria-label="Google Cast-afstandsbediening"><strong>Afspelen op tv</strong><div><button type="button" onClick={() => { const value = remote(); if (value) { value.controller.playOrPause(); setPlaying(!playing); } }}>{playing ? 'Pauzeren' : 'Afspelen'}</button><button type="button" aria-label="30 seconden terug" onClick={() => { const value = remote(); if (value) { value.player.currentTime = Math.max(0, value.player.currentTime - 30); value.controller.seek(); } }}>−30s</button><button type="button" aria-label="30 seconden vooruit" onClick={() => { const value = remote(); if (value) { value.player.currentTime += 30; value.controller.seek(); } }}>+30s</button><button type="button" onClick={() => remote()?.controller.stop()}>Stop</button></div><label>Volume <input type="range" min="0" max="1" step="0.05" value={volume} onChange={event => { const level = Number(event.target.value); setVolume(level); const value = remote(); if (value) { value.player.volumeLevel = level; value.controller.setVolumeLevel(); } }}/></label><button type="button" onClick={() => void disconnectCast().then(() => setActive(false))}>Verbinding verbreken</button></aside>;
}
