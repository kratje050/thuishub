import { createElement, useEffect, useRef, useState } from 'react';
import { post } from '../api';
import { deviceSecondaryLabel, groupPlaybackDevices } from './model';
import { usePlaybackDevices } from './PlaybackDeviceContext';
import type { PlaybackDevice } from './types';

function DeviceGlyph({ protocol }: { protocol: string }) {
  if (protocol === 'local-browser') return <svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M5 20a3 3 0 0 1 3 3M5 16a7 7 0 0 1 7 7M5 12a11 11 0 0 1 11 11"/></svg>;
}

function DeviceRow({ device }: { device: PlaybackDevice }) {
  const { activeSession, busy, pending, preferredDeviceId, selectDevice, moveToDevice } = usePlaybackDevices();
  const active = activeSession?.deviceId === device.id;
  return <div className={`playback-device-row ${active ? 'active' : ''} ${device.online ? '' : 'offline'}`}>
    <button type="button" disabled={busy || !device.online} aria-pressed={active || preferredDeviceId === device.id} onClick={() => void selectDevice(device)}>
      <span className="playback-device-glyph"><DeviceGlyph protocol={device.protocol}/></span>
      <span className="playback-device-copy"><strong>{device.name}</strong><small>{deviceSecondaryLabel(device)}</small>{device.currentMedia && <em>{device.currentMedia}</em>}</span>
      <span className="playback-device-state">{active ? 'Actief' : preferredDeviceId === device.id ? 'Gekozen' : pending ? 'Afspelen' : 'Kiezen'}</span>
    </button>
    {activeSession?.mediaId && !active && device.online && <button className="move-playback" type="button" disabled={busy} onClick={() => void moveToDevice(device)}>Afspelen hierheen verplaatsen</button>}
  </div>;
}

function DeviceGroup({ title, devices, empty }: { title: string; devices: PlaybackDevice[]; empty?: string }) {
  return <section className="playback-device-group"><h3>{title}</h3>{devices.length ? devices.map(device => <DeviceRow key={device.id} device={device}/>) : empty ? <p className="playback-device-empty">{empty}</p> : null}</section>;
}

export function PermanentDeviceButton() {
  const { activeSession, busy, devices, error, openPicker, pickerOpen, searching, castDeviceAvailable } = usePlaybackDevices();
  const discoveredCount = devices.filter(device => device.protocol !== 'local-browser' && device.online).length;
  const hasExternalTarget = discoveredCount > 0 || castDeviceAvailable;
  const state = error ? 'error' : busy || activeSession?.state === 'connecting' ? 'connecting' : activeSession ? activeSession.state === 'playing' ? 'playing' : activeSession.state === 'error' ? 'error' : 'connected' : searching ? 'searching' : hasExternalTarget ? 'available' : 'empty';
  const sessionLabel = activeSession?.state === 'playing' ? 'speelt af' : activeSession?.state === 'connecting' ? 'verbinden' : activeSession?.state === 'paused' ? 'gepauzeerd' : 'verbonden';
  const label = activeSession ? `${activeSession.deviceName} · ${sessionLabel}` : discoveredCount ? `${discoveredCount} gevonden afspeelapparaat${discoveredCount === 1 ? '' : 'en'}${castDeviceAvailable ? ' en Google Cast beschikbaar' : ' beschikbaar'}` : castDeviceAvailable ? 'Google Cast-apparaatkiezer beschikbaar' : 'Geen afspeelapparaten gevonden';
  return <button type="button" className="permanent-device-button" data-state={state} onClick={() => openPicker()} aria-haspopup="dialog" aria-expanded={pickerOpen} aria-label={`Afspelen op apparaat. ${label}`} title={label}>
    <span className="cast-screen-icon"><DeviceGlyph protocol="device"/></span><span className="permanent-device-label">{activeSession ? activeSession.deviceName : 'Casten'}</span>{discoveredCount > 0 && !activeSession && <b>{discoveredCount}</b>}
  </button>;
}

export function DevicePicker() {
  const { activeSession, busy, castDiagnostic, castDeviceAvailable, closePicker, currentCastReceiver, disconnect, error, pickerOpen, prepareOfficialCast, refreshDevices, searching, devices, pending } = usePlaybackDevices();
  const groups = groupPlaybackDevices(devices);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [pairCode, setPairCode] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingMessage, setPairingMessage] = useState('');
  useEffect(() => {
    if (!pickerOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closePicker(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), details > summary, google-cast-launcher'))
        .filter(element => element.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [closePicker, pickerOpen]);
  if (!pickerOpen) return null;
  const hasNetworkDevices = groups.mine.length + groups.other.length > 0;
  const hasUnpairedApps = devices.some(device => device.requiresPairing && !device.paired);
  const pairDevice = async () => {
    if (!/^\d{6}$/.test(pairCode)) return;
    setPairingBusy(true); setPairingMessage('');
    try {
      await post('/devices/pair/approve', { code: pairCode });
      setPairCode(''); setPairingMessage('Apparaat gekoppeld.');
      await refreshDevices(false);
    } catch (caught) { setPairingMessage(caught instanceof Error ? caught.message : 'Koppelen is mislukt.'); }
    finally { setPairingBusy(false); }
  };
  return <div className="playback-picker-backdrop" onClick={event => event.target === event.currentTarget && closePicker()}>
    <section ref={dialogRef} className="playback-picker" role="dialog" aria-modal="true" aria-labelledby="playback-picker-title" aria-busy={busy || searching} tabIndex={-1}>
      <header><div><p>{pending ? 'KIES WAAR JE WILT KIJKEN' : 'AFSPEELAPPARATEN'}</p><h2 id="playback-picker-title">Afspelen op apparaat</h2>{pending && <span>{pending.item.kind === 'episode' ? `${pending.item.seriesTitle} · ${pending.item.title}` : pending.item.title}</span>}</div><button ref={closeButtonRef} type="button" className="picker-close" onClick={closePicker} aria-label="Sluiten">×</button></header>
      {error && <div className="playback-picker-error" role="alert">{error}</div>}
      {hasUnpairedApps && <form className="playback-pair-inline" onSubmit={event => { event.preventDefault(); void pairDevice(); }}><label>Code op de tv<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pairCode} onChange={event => setPairCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Zescijferige code"/></label><button type="submit" disabled={pairingBusy || pairCode.length !== 6}>{pairingBusy ? 'Koppelen…' : 'Koppelen'}</button>{pairingMessage && <span role="status">{pairingMessage}</span>}</form>}
      <div className="playback-picker-scroll">
        <DeviceGroup title="Mijn apparaten" devices={groups.mine} empty="Nog geen gekoppelde ThuisHub-tv-apps."/>
        <section className="playback-device-group"><h3>Andere apparaten</h3>
          {pending&&currentCastReceiver&&<div className="playback-device-row active"><button type="button" disabled={busy} onClick={()=>prepareOfficialCast(true)}><span className="playback-device-glyph cast"><DeviceGlyph protocol="google-cast"/></span><span className="playback-device-copy"><strong>{currentCastReceiver.name}</strong><small>Afspelen op de huidige Google Cast</small></span><span className="playback-device-state">Afspelen</span></button></div>}
          {castDeviceAvailable && <div className="official-cast-row" onPointerDownCapture={event => { if (event.target instanceof Element && event.target.closest('google-cast-launcher')) prepareOfficialCast(); }} onKeyDownCapture={event => { if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.closest('google-cast-launcher')) prepareOfficialCast(); }}>
            <span className="playback-device-glyph cast"><DeviceGlyph protocol="google-cast"/></span>
            <span className="playback-device-copy"><strong>Google Cast</strong><small>{activeSession?.protocol==='google-cast'?'Kies eventueel een ander Cast-apparaat':'Open de officiële Google Cast-apparaatkiezer'}</small></span>
            {createElement('google-cast-launcher', { class: 'official-cast-launcher', title: 'Google Cast-apparaat kiezen', 'aria-label': 'Google Cast-apparaat kiezen' })}
          </div>}
          {groups.other.map(device => <DeviceRow key={device.id} device={device}/>)}
          {!castDeviceAvailable && <details className="cast-browser-diagnostic"><summary>Google Cast niet beschikbaar</summary><p>{castDiagnostic.available ? 'De Cast API is geladen, maar er is geen Cast-apparaat op dit netwerk gevonden.' : castDiagnostic.message}</p><dl><div><dt>Beveiligde verbinding</dt><dd>{castDiagnostic.secureContext ? 'Ja' : 'Nee'}</dd></div><div><dt>Cast API geladen</dt><dd>{castDiagnostic.chromeCast && castDiagnostic.castFramework ? 'Ja' : 'Nee'}</dd></div></dl></details>}
          {!hasNetworkDevices && !castDeviceAvailable && <p className="playback-device-empty">Geen apparaten gevonden. Controleer of je televisie en dit apparaat met hetzelfde thuisnetwerk zijn verbonden.</p>}
        </section>
        <DeviceGroup title="Dit apparaat" devices={groups.local}/>
      </div>
      <footer><button type="button" disabled={searching || busy} onClick={() => void refreshDevices(true)}>{searching ? 'Zoeken…' : 'Apparaten opnieuw zoeken'}</button><button type="button" onClick={() => { location.href = '/?view=dashboard&section=devices'; }}>Apparaatinstellingen</button>{activeSession && <button type="button" className="disconnect-device" disabled={busy} onClick={() => void disconnect()}>Verbinding verbreken</button>}</footer>
    </section>
  </div>;
}
