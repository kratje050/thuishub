import type { MediaItem } from './api';

type CastMediaItem = Pick<MediaItem, 'id' | 'kind' | 'title'> & Partial<MediaItem>;

declare global {
  interface Window { cast?: any; chrome?: any; __onGCastApiAvailable?: (available: boolean) => void }
}
export type CastEnvironment = {
  chromeCast: boolean;
  castFramework: boolean;
  secureContext: boolean;
  hostname: string;
  userAgent: string;
};

export type CastDiagnostic = CastEnvironment & {
  available: boolean;
  supportedBrowser: boolean;
  message: string;
};

let initializedFor = '';
let remoteCache: { session: any; player: any; controller: any } | null = null;

function currentEnvironment(): CastEnvironment {
  if (typeof window === 'undefined') return { chromeCast: false, castFramework: false, secureContext: false, hostname: '', userAgent: '' };
  return {
    chromeCast: Boolean(window.chrome?.cast),
    castFramework: Boolean(window.cast?.framework),
    secureContext: Boolean(window.isSecureContext || ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)),
    hostname: window.location.hostname,
    userAgent: navigator.userAgent || '',
  };
}

export function describeCastEnvironment(environment: CastEnvironment = currentEnvironment()): CastDiagnostic {
  const ios = /iPad|iPhone|iPod/i.test(environment.userAgent);
  const available = environment.chromeCast && environment.castFramework && environment.secureContext && !ios;
  let message = 'Google Cast is beschikbaar.';
  if (ios) message = 'Google Cast vanuit Chrome op iPhone en iPad wordt niet ondersteund. Gebruik de ThuisHub-app.';
  else if (!environment.secureContext) message = 'Google Cast vereist een beveiligde HTTPS-verbinding of localhost.';
  else if (!environment.chromeCast || !environment.castFramework) message = 'Google Cast is in deze browser niet beschikbaar. Open ThuisHub in Google Chrome of gebruik de ThuisHub-app.';
  return { ...environment, available, supportedBrowser: !ios && environment.chromeCast && environment.castFramework, message };
}

export function castAvailable() { return describeCastEnvironment().available; }

function castContext() {
  if (!castAvailable()) return null;
  return window.cast.framework.CastContext.getInstance();
}

export function initializeCast(receiverApplicationId = '') {
  const context = castContext();
  if (!context) return false;
  const appId = receiverApplicationId || window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
  if (initializedFor === appId) return true;
  context.setOptions({
    receiverApplicationId: appId,
    autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    resumeSavedSession: true,
  });
  initializedFor = appId;
  return true;
}

export function subscribeCastState(receiverApplicationId: string, listener: () => void) {
  if (!initializeCast(receiverApplicationId)) return () => {};
  const context = castContext();
  const eventTypes = window.cast.framework.CastContextEventType || {};
  const types = [eventTypes.CAST_STATE_CHANGED, eventTypes.SESSION_STATE_CHANGED].filter(Boolean);
  for (const type of types) context.addEventListener(type, listener);
  listener();
  return () => { for (const type of types) context.removeEventListener(type, listener); };
}

export function currentCastSession() { return castContext()?.getCurrentSession?.() || null; }

export function castDevicesAvailable() {
  if (typeof window === 'undefined') return false;
  const context = castContext();
  const state = context?.getCastState?.();
  const noDevices = window.cast?.framework?.CastState?.NO_DEVICES_AVAILABLE;
  return Boolean(state && state !== noDevices);
}

export function currentCastDevice() {
  const session = currentCastSession();
  const receiver = session?.getCastDevice?.();
  if (!session || !receiver) return null;
  return {
    id: String(receiver.deviceId || session.getSessionId?.() || 'google-cast'),
    name: String(receiver.friendlyName || 'Google Cast-apparaat'),
    sessionId: String(session.getSessionId?.() || ''),
  };
}

type CastPlaybackUrls = { playback: string; subtitle?: string; poster?: string };

async function loadMediaOnSession(session: any, item: CastMediaItem, playback: CastPlaybackUrls, decision: any, startPosition = 0) {
  const contentType = decision?.mode === 'direct_play' ? contentTypeFor(item, decision) : 'application/vnd.apple.mpegurl';
  const info = new window.chrome.cast.media.MediaInfo(playback.playback, contentType);
  info.metadata = new window.chrome.cast.media.GenericMediaMetadata();
  info.metadata.title = item.kind === 'episode' ? `${item.seriesTitle} · S${item.season} A${item.episode}` : item.title;
  info.metadata.subtitle = item.kind === 'episode' ? item.title : String(item.year || '');
  const safePoster = playback.poster || (item.posterUrl && /^https?:\/\//i.test(item.posterUrl) ? item.posterUrl : '');
  if (safePoster) info.metadata.images = [{ url: safePoster }];
  info.customData = { source: 'ThuisHub', mediaId: item.id, playbackDecision: decision?.mode };
  if (playback.subtitle) {
    const track = new window.chrome.cast.media.Track(1, window.chrome.cast.media.TrackType.TEXT);
    track.trackContentId = playback.subtitle;
    track.trackContentType = 'text/vtt';
    track.subtype = window.chrome.cast.media.TextTrackType.SUBTITLES;
    track.name = 'Nederlands';
    track.language = 'nl-NL';
    info.tracks = [track];
  }
  const request = new window.chrome.cast.media.LoadRequest(info);
  request.autoplay = true;
  request.currentTime = Math.max(0, Number(startPosition) || 0);
  if (playback.subtitle) request.activeTrackIds = [1];
  await session.loadMedia(request);
  remoteCache = null;
  return session;
}

export async function loadCurrentCastMedia(item: CastMediaItem, playback: CastPlaybackUrls, decision: any, startPosition = 0) {
  if (!castAvailable()) throw new Error(describeCastEnvironment().message);
  const session = currentCastSession();
  if (!session) throw new Error('Er is geen Google Cast-apparaat geselecteerd.');
  return loadMediaOnSession(session, item, playback, decision, startPosition);
}

export async function setCurrentCastTextTrack(enabled: boolean) {
  if (!castAvailable()) throw new Error(describeCastEnvironment().message);
  const session = currentCastSession();
  if (!session) throw new Error('Er is geen Google Cast-apparaat geselecteerd.');
  const mediaSession = session.getMediaSession?.();
  if (!mediaSession || typeof mediaSession.editTracksInfo !== 'function') {
    throw new Error('Er wordt geen media afgespeeld op het Google Cast-apparaat.');
  }
  const EditTracksInfoRequest = window.chrome?.cast?.media?.EditTracksInfoRequest;
  if (typeof EditTracksInfoRequest !== 'function') {
    throw new Error('De Google Cast-browserbibliotheek ondersteunt geen ondertitelbediening.');
  }
  const request = new EditTracksInfoRequest(enabled ? [1] : []);
  await new Promise<void>((resolve, reject) => {
    mediaSession.editTracksInfo(request, resolve, (castError: any) => {
      const reason = castError?.description || castError?.code;
      reject(new Error(reason ? `Google Cast kon de ondertiteling niet aanpassen: ${reason}` : 'Google Cast kon de ondertiteling niet aanpassen.'));
    });
  });
}

export async function castMedia(item: CastMediaItem, playback: CastPlaybackUrls, decision: any, startPosition = 0) {
  if (!castAvailable()) throw new Error(describeCastEnvironment().message);
  if (!initializedFor && !initializeCast()) throw new Error('Google Cast kon niet worden geïnitialiseerd.');
  const context = castContext();
  await context.requestSession();
  const session = context.getCurrentSession();
  if (!session) throw new Error('Er is geen Google Cast-apparaat geselecteerd.');
  return loadMediaOnSession(session, item, playback, decision, startPosition);
}

function contentTypeFor(item: CastMediaItem, decision?: { outputContainer?: string }) {
  const codec = String(item.videoCodec || '').toLowerCase();
  const container = String(decision?.outputContainer || (item as any).container || '').toLowerCase();
  if (container === 'webm') {
    if (codec === 'vp8') return 'video/webm; codecs="vp8"';
    if (codec === 'vp9') return 'video/webm; codecs="vp9"';
    return 'video/webm';
  }
  if (codec === 'hevc' || codec === 'h265') return 'video/mp4; codecs="hvc1"';
  if (codec === 'av1') return 'video/mp4; codecs="av01"';
  return 'video/mp4';
}

export function castController() {
  const session = currentCastSession();
  if (!session) { remoteCache = null; return null; }
  if (remoteCache?.session === session) return remoteCache;
  const player = new window.cast.framework.RemotePlayer();
  const controller = new window.cast.framework.RemotePlayerController(player);
  remoteCache = { session, player, controller };
  return remoteCache;
}

export function isCastPlaybackConfirmed(player: any) {
  const playingState = window.chrome?.cast?.media?.PlayerState?.PLAYING || 'PLAYING';
  return Boolean(player?.isMediaLoaded && player?.playerState === playingState && !player?.isPaused);
}

/**
 * A successful LOAD only means that the receiver accepted the request. Keep
 * the previous playback source alive until the official RemotePlayer reports
 * that media is actually playing.
 */
export async function waitForCurrentCastPlaying(timeoutMs = 20_000) {
  const remote = castController();
  if (!remote) throw new Error('De Google Cast-sessie is niet meer verbonden.');
  if (isCastPlaybackConfirmed(remote.player)) return remote;
  const eventTypes = window.cast?.framework?.RemotePlayerEventType || {};
  const types = [
    eventTypes.PLAYER_STATE_CHANGED,
    eventTypes.IS_MEDIA_LOADED_CHANGED,
    eventTypes.IS_PAUSED_CHANGED,
    eventTypes.IS_CONNECTED_CHANGED,
  ].filter((value, index, list) => value && list.indexOf(value) === index);
  if (!types.length || typeof remote.controller?.addEventListener !== 'function') {
    throw new Error('De Google Cast-browserbibliotheek kan de afspeelstatus niet bevestigen.');
  }
  const boundedTimeout = Math.min(60_000, Math.max(1_000, Number(timeoutMs) || 20_000));
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      for (const type of types) remote.controller.removeEventListener?.(type, changed);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const changed = () => {
      if (currentCastSession() !== remote.session || remote.player?.isConnected === false) {
        finish(new Error('De Google Cast-sessie werd verbroken voordat het afspelen begon.'));
      } else if (isCastPlaybackConfirmed(remote.player)) finish();
    };
    const timer = setTimeout(() => finish(new Error('De Google Cast-ontvanger bevestigde het afspelen niet op tijd.')), boundedTimeout);
    for (const type of types) remote.controller.addEventListener(type, changed);
    changed();
  });
  return remote;
}

export async function disconnectCast() {
  const session = currentCastSession();
  remoteCache = null;
  if (session) await session.endSession(true);
}
