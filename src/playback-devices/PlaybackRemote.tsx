import { useEffect, useState } from 'react';
import { castController } from '../cast';
import { usePlaybackDevices } from './PlaybackDeviceContext';

function time(value = 0) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function shouldShowPlaybackRemote(protocol?: string) {
  return Boolean(protocol && protocol !== 'local-browser');
}

export function PlaybackRemote() {
  const { activeSession, control, disconnect, error, ownsActiveCastSession } = usePlaybackDevices();
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [expanded, setExpanded] = useState(false);

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

  useEffect(() => { setExpanded(false); }, [activeSession?.id]);

  // De lokale speler heeft al eigen, direct gekoppelde videobediening. Een
  // tweede globale afstandsbediening zat daar alleen overheen en bood functies
  // die een browser niet via de apparaat-API ondersteunt.
  if (!activeSession || !shouldShowPlaybackRemote(activeSession.protocol)) return null;
  const canSeek = activeSession.canSeek !== false;
  const canSetVolume = activeSession.canSetVolume !== false;
  const receiverReady = activeSession.state !== 'connecting';
  const seek = (next: number) => {
    const bounded = Math.min(Math.max(duration, 0) || Number.MAX_SAFE_INTEGER, Math.max(0, next));
    setPosition(bounded);
    void control('seek', { positionSeconds: bounded });
  };
  const togglePlayback = () => {
    const command = playing ? 'pause' : 'play';
    setPlaying(!playing);
    void control(command);
  };
  const hasOptions = Boolean(
    canSetVolume
    || activeSession.canChangeAudioTrack && activeSession.audioTracks?.length
    || activeSession.canChangeSubtitleTrack && activeSession.subtitleTracks?.length
    || activeSession.canChangeQuality
  );

  return <aside className="playback-remote compact-remote" data-expanded={expanded} aria-label="Afstandsbediening">
    <div className="remote-summary">
      {activeSession.posterUrl ? <img src={activeSession.posterUrl} alt=""/> : <span className="remote-poster-fallback" aria-hidden="true">&#9654;</span>}
      <span className="remote-title"><small>{activeSession.deviceName}</small><strong>{activeSession.title || 'Afspelen op apparaat'}</strong><em>{time(position)} / {time(duration)}</em></span>
      <div className="remote-quick-controls">
        {canSeek && <button type="button" disabled={!receiverReady} onClick={() => seek(position - 10)} aria-label="10 seconden terug">−10</button>}
        <button type="button" className="remote-play" disabled={!receiverReady} onClick={togglePlayback} aria-label={playing ? 'Pauzeren' : 'Afspelen'}>{playing ? 'Ⅱ' : '▶'}</button>
        {canSeek && <button type="button" disabled={!receiverReady} onClick={() => seek(position + 30)} aria-label="30 seconden vooruit">+30</button>}
        <button type="button" className="remote-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} aria-label={expanded ? 'Bediening inklappen' : 'Bediening uitklappen'}>{expanded ? '⌄' : '⌃'}</button>
        <button type="button" className="remote-stop" onClick={() => void control('stop')} aria-label="Afspelen stoppen">■</button>
      </div>
    </div>
    {error && <p className="remote-error" role="alert">{error}</p>}
    {expanded && <div className="remote-details">
      <div className="remote-timeline">
        <input aria-label="Afspeelpositie" aria-valuetext={`${time(position)} van ${time(duration)}`} type="range" min="0" max={Math.max(duration, 1)} step="1" value={Math.min(position, Math.max(duration, 1))} onChange={event => setPosition(Number(event.target.value))} onPointerUp={event => seek(Number(event.currentTarget.value))} onKeyUp={event => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) seek(Number(event.currentTarget.value)); }} disabled={!receiverReady || !duration || !canSeek}/>
        <span>{time(position)} / {time(duration)}</span>
      </div>
      {(activeSession.canSkipPrevious || activeSession.canSkipNext) && <div className="remote-episode-controls">
        {activeSession.canSkipPrevious && <button type="button" disabled={!receiverReady} onClick={() => void control('previous')}>Vorige</button>}
        {activeSession.canSkipNext && <button type="button" disabled={!receiverReady} onClick={() => void control('next')}>Volgende</button>}
      </div>}
      {hasOptions && <div className="remote-options">
        {Boolean(activeSession.canChangeAudioTrack && activeSession.audioTracks?.length) && <label>Audio<select value={String(activeSession.activeAudioTrackId ?? '')} onChange={event => void control('audio-track', { trackId: event.target.value })}><option value="">Automatisch</option>{activeSession.audioTracks?.map(track => <option key={track.id} value={track.id}>{track.label}</option>)}</select></label>}
        {Boolean(activeSession.canChangeSubtitleTrack && activeSession.subtitleTracks?.length) && <label>Ondertiteling<select value={String(activeSession.activeSubtitleTrackId ?? '')} onChange={event => void control('subtitle-track', { trackId: event.target.value || null })}><option value="">Uit</option>{activeSession.subtitleTracks?.map(track => <option key={track.id} value={track.id}>{track.label}</option>)}</select></label>}
        {activeSession.canChangeQuality && <label>Kwaliteit<select value={activeSession.quality || 'auto'} onChange={event => void control('quality', { quality: event.target.value })}><option value="auto">Automatisch</option><option value="original">Origineel</option><option value="1080p-high">1080p hoog</option><option value="720p">720p</option><option value="data-saver">Databesparing</option></select></label>}
        {canSetVolume && <label className="remote-volume">Volume<input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={event => { const level = Number(event.target.value); setVolume(level); void control('volume', { level }); }}/></label>}
      </div>}
      <button type="button" className="remote-disconnect" onClick={() => void disconnect()}>Verbinding verbreken</button>
    </div>}
  </aside>;
}
