import { useEffect, useState } from 'react';
import { castController } from '../cast';
import { usePlaybackDevices } from './PlaybackDeviceContext';

function time(value = 0) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function PlaybackRemote() {
  const { activeSession, control, disconnect, error, ownsActiveCastSession } = usePlaybackDevices();
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    if (!activeSession) return;
    const refresh = () => {
      if (activeSession.protocol === 'google-cast' && ownsActiveCastSession) {
        const remote = castController();
        if (remote) {
          setPlaying(!remote.player.isPaused && !remote.player.isIdle);
          setPosition(Number(remote.player.currentTime || 0));
          setDuration(Number(remote.player.duration || 0));
          setVolume(Number(remote.player.volumeLevel ?? 1));
          return;
        }
      }
      setPlaying(activeSession.state === 'playing');
      setPosition(Number(activeSession.position || 0));
      setDuration(Number(activeSession.duration || 0));
      setVolume(Number(activeSession.volume ?? 1));
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [activeSession, ownsActiveCastSession]);

  if (!activeSession) return null;
  const canSeek = activeSession.canSeek !== false;
  const canSetVolume = activeSession.canSetVolume !== false;
  const receiverReady = activeSession.state !== 'connecting';
  const seek = (next: number) => { setPosition(next); void control('seek', { positionSeconds: next }); };

  return <aside className="playback-remote" aria-label="Afstandsbediening">
    <div className="remote-media">
      {activeSession.posterUrl ? <img src={activeSession.posterUrl} alt=""/> : <span className="remote-poster-fallback" aria-hidden="true">&#9654;</span>}
      <span><small>{activeSession.deviceName}</small><strong>{activeSession.title || 'Afspelen op tv'}</strong>{activeSession.subtitle && <em>{activeSession.subtitle}</em>}</span>
      <button type="button" onClick={() => void disconnect()} aria-label="Verbinding verbreken">&times;</button>
    </div>
    {error && <p className="remote-error" role="alert">{error}</p>}
    <div className="remote-timeline">
      <input aria-label="Afspeelpositie" aria-valuetext={`${time(position)} van ${time(duration)}`} type="range" min="0" max={Math.max(duration, 1)} step="1" value={Math.min(position, Math.max(duration, 1))} onChange={event => setPosition(Number(event.target.value))} onPointerUp={() => seek(position)} onKeyUp={event => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) seek(position); }} disabled={!receiverReady || !duration || !canSeek}/>
      <span aria-live="off">{time(position)} / {time(duration)}</span>
    </div>
    <div className="remote-main-controls">
      <button type="button" disabled={!receiverReady || !activeSession.canSkipPrevious} onClick={() => void control('previous')} aria-label="Vorige aflevering of track">|&#8249;</button>
      <button type="button" disabled={!receiverReady || !canSeek} onClick={() => void control('seek', { deltaSeconds: -10 })} aria-label="10 seconden terug">-10</button>
      <button type="button" className="remote-play" disabled={!receiverReady} onClick={() => void control(playing ? 'pause' : 'play')} aria-label={playing ? 'Pauzeren' : 'Afspelen'}>{playing ? 'II' : '\u25B6'}</button>
      <button type="button" disabled={!receiverReady || !canSeek} onClick={() => void control('seek', { deltaSeconds: 30 })} aria-label="30 seconden vooruit">+30</button>
      <button type="button" disabled={!receiverReady || !activeSession.canSkipNext} onClick={() => void control('next')} aria-label="Volgende aflevering of track">&#8250;|</button>
      <button type="button" onClick={() => void control('stop')}>Stop</button>
    </div>
    <div className="remote-options">
      <label>Audio<select disabled={!receiverReady || !activeSession.canChangeAudioTrack || !activeSession.audioTracks?.length} value={String(activeSession.activeAudioTrackId ?? '')} onChange={event => void control('audio-track', { trackId: event.target.value })}><option value="">Automatisch</option>{activeSession.audioTracks?.map(track => <option key={track.id} value={track.id}>{track.label}</option>)}</select></label>
      <label>Ondertiteling<select disabled={!receiverReady || !activeSession.canChangeSubtitleTrack || !activeSession.subtitleTracks?.length} value={String(activeSession.activeSubtitleTrackId ?? '')} onChange={event => void control('subtitle-track', { trackId: event.target.value || null })}><option value="">Uit</option>{activeSession.subtitleTracks?.map(track => <option key={track.id} value={track.id}>{track.label}</option>)}</select></label>
      <label>Kwaliteit<select disabled={!receiverReady || !activeSession.canChangeQuality} value={activeSession.quality || 'auto'} onChange={event => void control('quality', { quality: event.target.value })}><option value="auto">Automatisch</option><option value="original">Origineel</option><option value="1080p-high">1080p hoog</option><option value="720p">720p</option><option value="data-saver">Databesparing</option></select></label>
      <label className="remote-volume">Volume<input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={volume} disabled={!receiverReady || !canSetVolume} onChange={event => { const level = Number(event.target.value); setVolume(level); void control('volume', { level }); }}/></label>
    </div>
  </aside>;
}
