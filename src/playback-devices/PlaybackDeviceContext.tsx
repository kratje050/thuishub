import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, post, type MediaItem, type Settings } from '../api';
import { castController, castDevicesAvailable, currentCastDevice, describeCastEnvironment, disconnectCast, initializeCast, loadCurrentCastMedia, setCurrentCastTextTrack, subscribeCastState, waitForCurrentCastPlaying, type CastDiagnostic } from '../cast';
import { claimBrowserPlaybackCommand, confirmPlaybackReceiverStatus, controlPlaybackSession, createPlaybackSession, deletePlaybackSession, discoverPlaybackDevices, getActivePlaybackSession, getPlaybackDevices, getPlaybackSession, updatePlaybackSession } from './api';
import { LOCAL_BROWSER_DEVICE, localBrowserDeviceId } from './model';
import type { PendingPlayback, PlaybackDevice, PlaybackSession } from './types';

type PlaybackDeviceContextValue = {
  devices: PlaybackDevice[];
  activeSession: PlaybackSession | null;
  pending: PendingPlayback | null;
  preferredDeviceId: string;
  pickerOpen: boolean;
  searching: boolean;
  busy: boolean;
  error: string;
  castDiagnostic: CastDiagnostic;
  castDeviceAvailable: boolean;
  ownsActiveCastSession: boolean;
  currentCastReceiver: {deviceId:string;name:string}|null;
  openPicker: (item?: MediaItem, startPosition?: number) => void;
  closePicker: () => void;
  refreshDevices: (activeScan?: boolean) => Promise<void>;
  selectDevice: (device: PlaybackDevice) => Promise<void>;
  prepareOfficialCast: (useCurrentReceiver?: boolean) => void;
  moveToDevice: (device: PlaybackDevice) => Promise<void>;
  control: (command: string, payload?: Record<string, unknown>) => Promise<void>;
  disconnect: () => Promise<void>;
  clearError: () => void;
};

const PlaybackDeviceContext = createContext<PlaybackDeviceContextValue | null>(null);

function storedDeviceId() {
  try { return localStorage.getItem('thuishub.preferredPlaybackDevice') || ''; } catch { return ''; }
}

function rememberDevice(id: string) {
  try { localStorage.setItem('thuishub.preferredPlaybackDevice', id); } catch {}
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function mergeDefinedSession(current: PlaybackSession, next: PlaybackSession) {
  return Object.assign({}, current, Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined))) as PlaybackSession;
}

function centralBrowserCommand(session: PlaybackSession) {
  const value = session.metadata?.browserCommand;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const command = value as Record<string, unknown>;
  if (typeof command.id !== 'string' || command.id.length > 220 || typeof command.command !== 'string') return null;
  const payload = command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload) ? command.payload as Record<string, unknown> : {};
  return {
    id: command.id,
    command: command.command,
    issuedAt: Number(command.issuedAt || 0),
    claimedBy: typeof command.claimedBy === 'string' ? command.claimedBy : '',
    claimedAt: Number(command.claimedAt || 0),
    payload,
  };
}

function castPlaceholder(receiver: NonNullable<ReturnType<typeof currentCastDevice>>, deviceId = 'google-cast'): PlaybackSession {
  return {
    id: `cast:${receiver.sessionId || receiver.id}`,
    deviceId,
    deviceName: receiver.name,
    protocol: 'google-cast',
    state: 'connecting',
  };
}

export function PlaybackDeviceProvider({ children, settings, onPlayLocal }: { children: ReactNode; settings: Settings; onPlayLocal: (item: MediaItem) => void }) {
  const [devices, setDevices] = useState<PlaybackDevice[]>([]);
  const [activeSession, setActiveSession] = useState<PlaybackSession | null>(null);
  const [pending, setPending] = useState<PendingPlayback | null>(null);
  const [preferredDeviceId, setPreferredDeviceId] = useState(storedDeviceId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [castDiagnostic, setCastDiagnostic] = useState(describeCastEnvironment);
  const [castDeviceAvailable, setCastDeviceAvailable] = useState(false);
  const [castRevision, setCastRevision] = useState(0);
  const [castPrepared, setCastPrepared] = useState(false);
  const castStarting = useRef(false);
  const castDisconnecting = useRef(false);
  const activeSessionRef = useRef<PlaybackSession | null>(null);
  const pendingTransferNotice = useRef<{ sessionId: string; mediaId: number; startPosition: number; deviceId: string } | null>(null);
  const handledBrowserCommands = useRef(new Set<string>());
  const browserCommandsInFlight = useRef(new Set<string>());
  const ownedBrowserSource = useRef<PlaybackSession | null>(null);
  const pageCastDeviceId = useRef('');
  const castSelectionRequest = useRef<{initialReceiverId:string;sourceDeviceId:string;mediaId?:number;startPosition:number;item?:MediaItem;expiresAt:number}|null>(null);
  const castSwitchTimer = useRef(0);
  const castSelectionExpiryTimer = useRef(0);

  const executeBrowserCommand = useCallback(async (session: PlaybackSession, command: string, payload: Record<string, unknown>) => {
    try {
      if (session.protocol === 'local-browser') {
        const ownsPlayer = Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-thuishub-playback-session]'))
          .some(video => video.dataset.thuishubPlaybackSession === session.id);
        if (!ownsPlayer) return false;
        window.dispatchEvent(new CustomEvent('thuishub-local-player-command', { detail: { sessionId: session.id, command, payload } }));
        return true;
      }
      if (session.protocol !== 'google-cast') return false;
      if (!pageCastDeviceId.current || pageCastDeviceId.current !== session.deviceId) return false;
      const remote = castController();
      if (!remote) return false;
      if (command === 'play' && remote.player.isPaused) remote.controller.playOrPause();
      else if (command === 'pause' && !remote.player.isPaused) remote.controller.playOrPause();
      else if (command === 'stop') remote.controller.stop();
      else if (command === 'seek') { remote.player.currentTime = Math.max(0, Number(payload.position) || 0); remote.controller.seek(); }
      else if (command === 'volume') { remote.player.volumeLevel = Math.max(0, Math.min(1, Number(payload.level))); remote.controller.setVolumeLevel(); }
      else if (command === 'subtitle-track') await setCurrentCastTextTrack(Boolean(payload.trackId));
      else return false;
      return true;
    } catch (caught) {
      setError(errorMessage(caught, 'De browserontvanger kon de afstandsbedieningsopdracht niet uitvoeren.'));
      return true;
    }
  }, []);

  const stopOwnedBrowserSource = useCallback(async (session: PlaybackSession, reason: string) => {
    if (session.protocol === 'local-browser') return executeBrowserCommand(session, 'stop', { reason });
    if (session.protocol !== 'google-cast' || !currentCastDevice() || pageCastDeviceId.current !== session.deviceId) return false;
    castDisconnecting.current = true;
    try {
      castController()?.controller?.stop?.();
      await disconnectCast();
      await post('/playback-devices/cast-state', { connected: false }).catch(() => undefined);
      return true;
    } catch (caught) {
      setError(errorMessage(caught, 'De oude Google Cast-verbinding kon niet netjes worden afgesloten.'));
      return true;
    } finally { castDisconnecting.current = false; }
  }, [executeBrowserCommand]);

  const rememberHandledBrowserCommand = useCallback((id: string) => {
    handledBrowserCommands.current.add(id);
    if (handledBrowserCommands.current.size > 100) handledBrowserCommands.current.delete(handledBrowserCommands.current.values().next().value!);
  }, []);

  const handleCentralBrowserCommand = useCallback(async (session: PlaybackSession) => {
    let command = centralBrowserCommand(session);
    if (!command || handledBrowserCommands.current.has(command.id) || browserCommandsInFlight.current.has(command.id)) return;
    if (!command.issuedAt || Math.abs(Date.now() - command.issuedAt) > 30_000) {
      rememberHandledBrowserCommand(command.id);
      return;
    }
    if (session.protocol === 'google-cast') {
      if (!castController() || !pageCastDeviceId.current || pageCastDeviceId.current !== session.deviceId) return;
      if (command.claimedBy && command.claimedBy !== localBrowserDeviceId()) return;
    }
    const commandId=command.id;
    browserCommandsInFlight.current.add(commandId);
    try {
      let commandSession = session;
      if (session.protocol === 'google-cast' && !command.claimedBy) {
        try {
          const claimed = await claimBrowserPlaybackCommand(session.id, Number(session.revision || 0), command.id);
          if (!claimed.session) return;
          commandSession = claimed.session;
          command = centralBrowserCommand(commandSession);
          if (!command || command.claimedBy !== localBrowserDeviceId()) return;
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 409) return;
          throw caught;
        }
      }
      if (command.command === 'replace-media') {
        const media = command.payload.media;
        const urls = command.payload.urls;
        if (!media || typeof media !== 'object' || Array.isArray(media) || !urls || typeof urls !== 'object' || Array.isArray(urls) || typeof (urls as any).playback !== 'string') {
          throw new Error('De nieuwe Google Cast-afspeelbron ontbreekt.');
        }
        try {
          await loadCurrentCastMedia(media as MediaItem, urls as { playback: string; subtitle?: string; poster?: string }, command.payload.decision, Math.max(0, Number(command.payload.startPosition) || 0));
          const remote = await waitForCurrentCastPlaying();
          let started;
          try {
            started = await confirmPlaybackReceiverStatus(
              commandSession.id,
              Number(commandSession.revision || 0),
              'playing',
              Number(remote.player.currentTime || commandSession.position || 0),
              Number(remote.player.duration || commandSession.duration || 0),
            );
          } catch (caught) {
            if (!(caught instanceof ApiError) || caught.status !== 409) throw caught;
            const latest = await getPlaybackSession(commandSession.id);
            if (!latest.session || latest.session.state !== 'playing') throw caught;
            started = latest;
          }
          if (started.session) setActiveSession(started.session);
          rememberHandledBrowserCommand(command.id);
          return;
        } catch (caught) {
          const latest = await getPlaybackSession(commandSession.id).catch(() => ({ session: null }));
          if (latest.session && latest.session.state === 'connecting') await deletePlaybackSession(commandSession.id,'load-failed').catch(() => undefined);
          const restored = await getActivePlaybackSession().catch(() => ({ session: null }));
          setActiveSession(restored.session);
          setError(errorMessage(caught, 'De nieuwe media kon niet op Google Cast worden gestart; de vorige sessie blijft actief.'));
          rememberHandledBrowserCommand(command.id);
          return;
        }
      }
      if (await executeBrowserCommand(commandSession, command.command, command.payload)) {
        rememberHandledBrowserCommand(command.id);
      }
    } catch (caught) {
      setError(errorMessage(caught, 'De browserontvanger kon de afstandsbedieningsopdracht niet uitvoeren.'));
    } finally { browserCommandsInFlight.current.delete(commandId); }
  }, [executeBrowserCommand, rememberHandledBrowserCommand]);

  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  useEffect(() => {
    const current = activeSession;
    const source = ownedBrowserSource.current;
    const localPlayerSessionIds = new Set(Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-thuishub-playback-session]')).map(video => video.dataset.thuishubPlaybackSession).filter(Boolean));
    const ownsCurrent = Boolean(current && (
      current.protocol === 'local-browser'
        ? localPlayerSessionIds.has(current.id) || localPlayerSessionIds.size === 0 && current.deviceId === localBrowserDeviceId()
        : current.protocol === 'google-cast' && currentCastDevice() && pageCastDeviceId.current === current.deviceId
    ));
    if (!source) {
      if (current && ownsCurrent && !['stopped','error'].includes(current.state)) ownedBrowserSource.current = current;
      return;
    }
    if (current?.id === source.id || current && ownsCurrent && current.deviceId === source.deviceId) {
      if (['stopped','error'].includes(current.state)) {
        void stopOwnedBrowserSource(source, 'central-session-ended');
        ownedBrowserSource.current = null;
      } else ownedBrowserSource.current = current;
      return;
    }
    if (!current || current.state === 'playing') {
      void stopOwnedBrowserSource(source, current ? 'central-session-transferred' : 'central-session-ended');
      ownedBrowserSource.current = current && ownsCurrent ? current : null;
    }
  }, [activeSession, castRevision, stopOwnedBrowserSource]);

  useEffect(() => {
    const notice = pendingTransferNotice.current;
    if (!notice || !activeSession) return;
    if (activeSession.id === notice.sessionId && activeSession.state === 'playing') {
      window.dispatchEvent(new CustomEvent('thuishub-playback-transferred', { detail: notice }));
      pendingTransferNotice.current = null;
    } else if (activeSession.id !== notice.sessionId || ['error', 'stopped'].includes(activeSession.state)) {
      pendingTransferNotice.current = null;
      if (activeSession.id === notice.sessionId && activeSession.state === 'error') setError('De televisie kon het afspelen niet starten. De lokale speler blijft beschikbaar.');
    }
  }, [activeSession]);

  const refreshDevices = useCallback(async (activeScan = false) => {
    setSearching(true);
    try {
      const found = activeScan ? await discoverPlaybackDevices() : await getPlaybackDevices();
      setDevices(found.filter(device => device.protocol !== 'google-cast' && device.protocol !== 'local-browser'));
      if (activeScan) setError('');
    } catch (caught: any) {
      if (caught?.status !== 404) setError(errorMessage(caught, 'Apparaten zoeken is mislukt.'));
    } finally { setSearching(false); }
  }, []);

  const refreshActiveSession = useCallback(async () => {
    try {
      const response = await getActivePlaybackSession();
      if (response.session) {
        void handleCentralBrowserCommand(response.session);
        setActiveSession(current => current?.id === response.session!.id ? mergeDefinedSession(current, response.session!) : response.session);
      }
      else {
        const receiver = currentCastDevice();
        setActiveSession(current => {
          if (current && !current.id.startsWith('cast:')) return null;
          return receiver && pageCastDeviceId.current ? current || castPlaceholder(receiver,pageCastDeviceId.current) : null;
        });
      }
    } catch (caught: any) {
      if (caught?.status !== 404 && caught?.status !== 204) setError(current => current || errorMessage(caught, 'De afspeelsessie kon niet worden bijgewerkt.'));
    }
  }, [handleCentralBrowserCommand]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/api/playback-sessions/ws`);
      socket.onmessage = event => {
        try { if (JSON.parse(String(event.data))?.type === 'session') void refreshActiveSession(); } catch { /* Polling blijft de fallback. */ }
      };
      socket.onclose = () => { if (!stopped) reconnectTimer = window.setTimeout(connect, 2_000); };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => { stopped = true; window.clearTimeout(reconnectTimer); socket?.close(); };
  }, [refreshActiveSession]);

  useEffect(() => {
    void refreshDevices(false);
    void refreshActiveSession();
    const timer = window.setInterval(() => void refreshActiveSession(), 2000);
    return () => window.clearInterval(timer);
  }, [refreshDevices, refreshActiveSession]);

  useEffect(() => {
    let unsubscribe = () => {};
    const castChanged = () => {
      const diagnostic = describeCastEnvironment();
      setCastDiagnostic(diagnostic);
      setCastDeviceAvailable(castDevicesAvailable());
      setCastRevision(value => value + 1);
      const receiver = currentCastDevice();
      if (!receiver) {
        const disconnectedDeviceId=pageCastDeviceId.current;
        pageCastDeviceId.current='';
        void post('/playback-devices/cast-state', { connected: false }).catch(() => undefined);
        const switching=castSelectionRequest.current;
        if(switching?.initialReceiverId&&switching.sourceDeviceId===disconnectedDeviceId&&switching.expiresAt>Date.now()){
          window.clearTimeout(castSwitchTimer.current);
          castSwitchTimer.current=window.setTimeout(()=>{
            if(currentCastDevice())return;
            castSelectionRequest.current=null;
            setCastPrepared(false);
            const source=activeSessionRef.current;
            if(source?.protocol==='google-cast'&&source.deviceId===disconnectedDeviceId&&!source.id.startsWith('cast:'))void deletePlaybackSession(source.id,'disconnect').catch(()=>undefined);
            setActiveSession(value=>value?.protocol==='google-cast'&&value.deviceId===disconnectedDeviceId?null:value);
          },Math.max(1_000,switching.expiresAt-Date.now()));
          return;
        }
        const current = activeSessionRef.current;
        const ownedCurrent=current?.protocol==='google-cast'&&Boolean(disconnectedDeviceId)&&current.deviceId===disconnectedDeviceId;
        if (!castDisconnecting.current && ownedCurrent && !current!.id.startsWith('cast:') && !current!.id.startsWith('pending:')) {
          void deletePlaybackSession(current.id,'disconnect').catch(() => undefined);
        }
        if (ownedCurrent) activeSessionRef.current = null;
        setActiveSession(value => value?.protocol === 'google-cast'&&value.deviceId===disconnectedDeviceId ? null : value);
        return;
      }
      window.clearTimeout(castSwitchTimer.current);
      void post<any>('/playback-devices/cast-state', { connected: true, receiverId: receiver.id, name: receiver.name })
        .then(registration=>{
          if(currentCastDevice()?.id!==receiver.id)return;
          const registeredId=String(registration?.device?.id||'google-cast');
          pageCastDeviceId.current=registeredId;
          setCastRevision(value=>value+1);
          setActiveSession(current=>current||castPlaceholder(receiver,registeredId));
        })
        .catch(()=>undefined);
    };
    const setup = () => {
      unsubscribe();
      setCastDiagnostic(describeCastEnvironment());
      if (initializeCast(settings.castReceiverAppId)) { setCastDeviceAvailable(castDevicesAvailable()); unsubscribe = subscribeCastState(settings.castReceiverAppId, castChanged); }
      else setCastDeviceAvailable(false);
    };
    window.addEventListener('thuishub-cast-ready', setup);
    setup();
    return () => { window.removeEventListener('thuishub-cast-ready', setup); unsubscribe(); window.clearTimeout(castSwitchTimer.current); window.clearTimeout(castSelectionExpiryTimer.current); };
  }, [settings.castReceiverAppId]);

  useEffect(() => {
    if (!pickerOpen) return;
    void refreshDevices(true);
  }, [pickerOpen, refreshDevices]);

  useEffect(() => {
    if (activeSession?.protocol !== 'google-cast' || pageCastDeviceId.current !== activeSession.deviceId || activeSession.state === 'connecting' || activeSession.revision == null || activeSession.id.startsWith('cast:')) return;
    const sync = async () => {
      const remote = castController();
      if (!remote) return;
      try {
        const response = await updatePlaybackSession(activeSession.id, activeSession.revision!, remote.player.isPaused ? 'paused' : 'playing', Number(remote.player.currentTime || 0), Number(remote.player.duration || activeSession.duration || 0));
        if (response.session) setActiveSession(current => current ? { ...current, ...response.session } : response.session);
      } catch (caught: any) {
        if (caught instanceof ApiError && caught.status === 409 && caught.code === 'STALE_PLAYBACK_SESSION') void refreshActiveSession();
      }
    };
    const timer = window.setInterval(() => void sync(), 10_000);
    return () => window.clearInterval(timer);
  }, [activeSession?.id, activeSession?.deviceId, activeSession?.protocol, activeSession?.state, activeSession?.revision, activeSession?.duration, castRevision, refreshActiveSession]);

  const openPicker = useCallback((item?: MediaItem, startPosition?: number) => {
    setPending(item ? { item, startPosition: Math.max(0, startPosition ?? item.progress?.position ?? 0) } : null);
    setCastPrepared(false);
    setError('');
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => { setPickerOpen(false); setCastPrepared(false); }, []);

  const selectDevice = useCallback(async (device: PlaybackDevice) => {
    if (!device.online) { setError(`${device.name} is momenteel offline.`); return; }
    if (device.requiresPairing && !device.paired) { setError(`${device.name} moet eerst met de zescijferige code worden gekoppeld via Apparaatinstellingen.`); return; }
    setPreferredDeviceId(device.id); rememberDevice(device.id);
    if (!pending) { setPickerOpen(false); return; }
    if (device.protocol === 'local-browser') {
      onPlayLocal(pending.item);
      setPending(null); setPickerOpen(false);
      return;
    }
    setBusy(true); setError('');
    try {
      const response = await createPlaybackSession(pending.item.id, device.id, pending.startPosition, settings.defaultQualityLan || 'auto');
      setActiveSession(response.session || {
        id: `pending:${Date.now()}`,
        deviceId: device.id,
        deviceName: device.name,
        protocol: device.protocol,
        state: 'connecting',
        mediaId: pending.item.id,
        title: pending.item.title,
        position: pending.startPosition,
      });
      const transferNotice = { sessionId: response.session?.id || '', mediaId: pending.item.id, startPosition: pending.startPosition, deviceId: device.id };
      if (!response.session || response.session.state === 'playing') window.dispatchEvent(new CustomEvent('thuishub-playback-transferred', { detail: transferNotice }));
      else pendingTransferNotice.current = transferNotice;
      setPending(null); setPickerOpen(false);
    } catch (caught) { setError(errorMessage(caught, `Afspelen op ${device.name} kon niet starten.`)); }
    finally { setBusy(false); }
  }, [activeSession, onPlayLocal, pending, settings.defaultQualityLan]);

  const prepareOfficialCast = useCallback((useCurrentReceiver=false) => {
    const receiver=currentCastDevice();
    const source=activeSessionRef.current;
    castSelectionRequest.current={
      initialReceiverId:useCurrentReceiver?'':receiver?.id||'',
      sourceDeviceId:pageCastDeviceId.current,
      mediaId:pending?.item.id??source?.mediaId,
      startPosition:Math.max(0,pending?.startPosition??source?.position??0),
      item:pending?.item,
      expiresAt:Date.now()+60_000,
    };
    window.clearTimeout(castSelectionExpiryTimer.current);
    castSelectionExpiryTimer.current=window.setTimeout(()=>{
      if(castSelectionRequest.current&&castSelectionRequest.current.expiresAt<=Date.now()){
        castSelectionRequest.current=null;
        setCastPrepared(false);
      }
    },60_100);
    setCastPrepared(true);
    setError('');
    setCastRevision(value => value + 1);
  }, [pending]);

  useEffect(() => {
    const receiver = currentCastDevice();
    const selection=castSelectionRequest.current;
    const mediaId=selection?.mediaId;
    const startPosition=selection?.startPosition??0;
    if(!castPrepared||!selection||!receiver||castStarting.current)return;
    if(selection.initialReceiverId&&receiver.id===selection.initialReceiverId)return;
    if(!mediaId){castSelectionRequest.current=null;setCastPrepared(false);return;}
    castStarting.current = true; setBusy(true); setError('');
    void (async () => {
      let createdSessionId = '';
      try {
        let castDeviceId = 'google-cast';
        try {
          const registration = await post<any>('/playback-devices/cast-state', { connected: true, receiverId: receiver.id, name: receiver.name });
          if (registration?.device?.id) castDeviceId = String(registration.device.id);
        } catch (caught: any) { if (caught?.status !== 404) throw caught; }
        pageCastDeviceId.current=castDeviceId;
        let response;
        try { response = await createPlaybackSession(mediaId, castDeviceId, startPosition, settings.defaultQualityLan || 'auto'); }
        catch (caught: any) {
          if (caught?.status !== 404) throw caught;
          const legacy = await post<any>(`/playback/${mediaId}/decision`, { target: 'cast', quality: settings.defaultQualityLan, network: 'lan' });
          response = { session: null, urls: legacy.urls, decision: legacy.decision, localStreamingRequired: legacy.localStreamingRequired };
        }
        createdSessionId = response.session?.id || '';
        if (response.localStreamingRequired) throw new Error('Schakel eerst Instellingen → Netwerk → Streamen binnen thuisnetwerk in en herstart ThuisHub.');
        if (!response.urls?.playback) {
          const legacy = await post<any>(`/playback/${mediaId}/decision`, { target: 'cast', quality: settings.defaultQualityLan, network: 'lan' });
          response = { ...response, urls: legacy.urls, decision: legacy.decision, localStreamingRequired: legacy.localStreamingRequired };
        }
        if (response.localStreamingRequired || !response.urls?.playback) throw new Error('De televisie kan de lokale afspeelserver niet bereiken.');
        const media = selection.item || response.media;
        if (!media) throw new Error('De media-informatie voor Google Cast ontbreekt.');
        await loadCurrentCastMedia(media, response.urls, response.decision, startPosition);
        const remote = await waitForCurrentCastPlaying();
        let startedSession = response.session;
        if (startedSession) {
          const started = await confirmPlaybackReceiverStatus(
            startedSession.id,
            Number(startedSession.revision || 0),
            'playing',
            Number(remote.player.currentTime || startPosition),
            Number(remote.player.duration || startedSession.duration || 0),
          );
          if (started.session) startedSession = { ...startedSession, ...started.session };
        }
        setActiveSession(startedSession || {
          id: `cast:${receiver.sessionId || receiver.id}`,
          deviceId: castDeviceId,
          deviceName: receiver.name,
          protocol: 'google-cast',
          state: 'playing',
          mediaId,
          title: media.kind === 'episode' ? media.seriesTitle : media.title,
          subtitle: media.kind === 'episode' ? media.title : undefined,
          posterUrl: media.posterUrl,
          position: startPosition,
        });
        setPreferredDeviceId(castDeviceId); rememberDevice(castDeviceId);
        window.dispatchEvent(new CustomEvent('thuishub-playback-transferred', { detail: { mediaId, startPosition, deviceId: castDeviceId } }));
        setPending(null); setPickerOpen(false); setCastPrepared(false);
        castSelectionRequest.current=null;
        window.dispatchEvent(new Event('thuishub-cast-session'));
      } catch (caught) {
        if (createdSessionId) await deletePlaybackSession(createdSessionId,'load-failed').catch(() => undefined);
        castController()?.controller?.stop?.();
        castDisconnecting.current = true;
        await disconnectCast().catch(() => undefined);
        await post('/playback-devices/cast-state', { connected: false }).catch(() => undefined);
        pageCastDeviceId.current='';
        castSelectionRequest.current=null;
        setCastPrepared(false);
        castDisconnecting.current = false;
        const restored = await getActivePlaybackSession().catch(() => ({ session: null }));
        setActiveSession(restored.session);
        setError(errorMessage(caught, 'Google Cast kon niet starten.'));
      }
      finally { castStarting.current = false; setBusy(false); }
    })();
  }, [activeSession, castPrepared, castRevision, pending, settings.defaultQualityLan]);

  const control = useCallback(async (command: string, payload: Record<string, unknown> = {}) => {
    const current = activeSession;
    if (!current) return;
    const normalizedPayload: Record<string, unknown> = { ...payload };
    const subtitleTrackId = typeof payload.trackId === 'string' || typeof payload.trackId === 'number' ? payload.trackId : undefined;
    if (command === 'seek') normalizedPayload.position = payload.positionSeconds == null
      ? Math.max(0, Number(current.position || 0) + Number(payload.deltaSeconds || 0))
      : Math.max(0, Number(payload.positionSeconds));
    if (command === 'volume') normalizedPayload.value = payload.level;
    setError('');
    try {
      const browserControlled = current.protocol === 'local-browser' || current.protocol === 'google-cast';
      if (!current.id.startsWith('cast:') && !current.id.startsWith('pending:')) {
        let response;
        try {
          response = await controlPlaybackSession(current.id, command, normalizedPayload, current.revision);
        } catch (caught: any) {
          if (!(caught instanceof ApiError) || caught.status !== 409 || caught.code !== 'STALE_PLAYBACK_SESSION') throw caught;
          const latest = await getActivePlaybackSession();
          if (!latest.session || latest.session.id !== current.id) {
            setActiveSession(latest.session);
            throw new Error('De actieve afspeelsessie is intussen gewijzigd. Probeer de opdracht opnieuw.');
          }
          setActiveSession(session => session ? { ...session, ...latest.session } : latest.session);
          response = await controlPlaybackSession(current.id, command, normalizedPayload, latest.session.revision);
        }
        if (response.session) {
          if(command==='stop'){
            if(browserControlled)await executeBrowserCommand(current,'stop',normalizedPayload);
            setActiveSession(null);
            return;
          }
          if (browserControlled) {
            if (centralBrowserCommand(response.session)) await handleCentralBrowserCommand(response.session);
            else if (command === 'stop') await executeBrowserCommand(current, 'stop', normalizedPayload);
          }
          const replacement = response.session.id !== current.id && ['next', 'previous', 'quality'].includes(command);
          if (replacement && current.protocol === 'google-cast') {
            const latest=await getActivePlaybackSession().catch(()=>({session:null}));
            if(latest.session)response.session=latest.session;
          }
          const nextSession = command === 'subtitle-track'
            ? { ...response.session, activeSubtitleTrackId: subtitleTrackId }
            : response.session;
          setActiveSession(session => replacement ? nextSession : session ? { ...session, ...nextSession } : nextSession);
        }
      } else {
        if (browserControlled && !await executeBrowserCommand(current, command, normalizedPayload)) throw new Error('De browserontvanger is in dit venster niet meer verbonden.');
        setActiveSession(session => session ? {
          ...session,
          state: command === 'pause' ? 'paused' : command === 'play' || command === 'play-pause' ? session.state === 'playing' ? 'paused' : 'playing' : session.state,
          position: command === 'seek' ? Number(normalizedPayload.position) : session.position,
          volume: command === 'volume' ? Number(payload.level) : session.volume,
          activeSubtitleTrackId: command === 'subtitle-track' ? subtitleTrackId : session.activeSubtitleTrackId,
        } : session);
      }
    } catch (caught) { setError(errorMessage(caught, 'De opdracht kon niet naar het apparaat worden gestuurd.')); }
  }, [activeSession, executeBrowserCommand, handleCentralBrowserCommand]);

  const disconnect = useCallback(async () => {
    const current = activeSession;
    setBusy(true); setError('');
    castDisconnecting.current = current?.protocol === 'google-cast';
    try {
      if (current && !current.id.startsWith('cast:') && !current.id.startsWith('pending:')) await deletePlaybackSession(current.id,'disconnect');
      if (current && (current.protocol === 'local-browser' || current.protocol === 'google-cast')) await stopOwnedBrowserSource(current, 'controller-disconnect');
      activeSessionRef.current = null;
      setActiveSession(null);
    } catch (caught) { setError(errorMessage(caught, 'De verbinding kon niet worden verbroken.')); }
    finally { castDisconnecting.current = false; setBusy(false); }
  }, [activeSession, stopOwnedBrowserSource]);

  const moveToDevice = useCallback(async (device: PlaybackDevice) => {
    if (!activeSession?.mediaId || activeSession.deviceId === device.id) return;
    setBusy(true); setError('');
    try {
      if (device.protocol === 'local-browser') {
        const library = await api<MediaItem[]>('/library');
        const item = library.find(candidate => candidate.id === activeSession.mediaId);
        if (!item) throw new Error('De media kon niet opnieuw in de bibliotheek worden gevonden.');
        const resumePosition = Math.max(0, Number(activeSession.position || 0));
        onPlayLocal({ ...item, progress: { position: resumePosition, duration: Number(activeSession.duration || item.duration || 0), completed: false } });
        setPreferredDeviceId(device.id); rememberDevice(device.id); setPickerOpen(false);
        return;
      }
      const response = await createPlaybackSession(activeSession.mediaId, device.id, activeSession.position || 0, activeSession.quality || settings.defaultQualityLan || 'auto');
      if (response.session) setActiveSession(response.session);
      setPreferredDeviceId(device.id); rememberDevice(device.id); setPickerOpen(false);
    } catch (caught) { setError(errorMessage(caught, `Afspelen verplaatsen naar ${device.name} is mislukt.`)); }
    finally { setBusy(false); }
  }, [activeSession, onPlayLocal, settings.defaultQualityLan]);

  const value = useMemo<PlaybackDeviceContextValue>(() => ({
    devices: [...devices, LOCAL_BROWSER_DEVICE], activeSession, pending, preferredDeviceId, pickerOpen, searching, busy, error, castDiagnostic, castDeviceAvailable,
    ownsActiveCastSession:Boolean(activeSession?.protocol==='google-cast'&&pageCastDeviceId.current===activeSession.deviceId),
    currentCastReceiver:currentCastDevice()&&pageCastDeviceId.current?{deviceId:pageCastDeviceId.current,name:currentCastDevice()!.name}:null,
    openPicker, closePicker, refreshDevices, selectDevice, prepareOfficialCast, moveToDevice, control, disconnect, clearError: () => setError(''),
  }), [devices, activeSession, pending, preferredDeviceId, pickerOpen, searching, busy, error, castDiagnostic, castDeviceAvailable, castRevision, openPicker, closePicker, refreshDevices, selectDevice, prepareOfficialCast, moveToDevice, control, disconnect]);

  return <PlaybackDeviceContext.Provider value={value}>{children}</PlaybackDeviceContext.Provider>;
}

export function usePlaybackDevices() {
  const value = useContext(PlaybackDeviceContext);
  if (!value) throw new Error('usePlaybackDevices moet binnen PlaybackDeviceProvider worden gebruikt.');
  return value;
}

export function useOptionalPlaybackDevices() { return useContext(PlaybackDeviceContext); }
