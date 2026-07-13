import type { MediaItem } from './api';

declare global {
  interface Window { cast?: any; chrome?: any; __onGCastApiAvailable?: (available:boolean)=>void }
}

let initializedFor = '';

export function castAvailable() { return Boolean(window.cast?.framework && window.chrome?.cast); }

export function initializeCast(receiverApplicationId = '') {
  if (!castAvailable()) return false;
  const appId = receiverApplicationId || window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
  if (initializedFor === appId) return true;
  window.cast.framework.CastContext.getInstance().setOptions({ receiverApplicationId: appId, autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED, resumeSavedSession: true });
  initializedFor = appId;
  return true;
}

export async function castMedia(item: MediaItem, playback: { playback: string; subtitle?: string }, decision: any) {
  if (!castAvailable()) throw new Error('Google Cast is in deze browser niet beschikbaar. Gebruik Chrome of Edge op hetzelfde thuisnetwerk.');
  // Preserve the custom receiver selected by CastButton. Only fall back to
  // Google's default receiver when no receiver has been selected yet.
  if (!initializedFor && !initializeCast()) throw new Error('Google Cast kon niet worden geinitialiseerd.');
  const context = window.cast.framework.CastContext.getInstance();
  await context.requestSession();
  const session = context.getCurrentSession();
  if (!session) throw new Error('Er is geen Cast-apparaat geselecteerd.');
  const contentType = decision?.mode === 'direct_play' ? contentTypeFor(item) : 'application/vnd.apple.mpegurl';
  const info = new window.chrome.cast.media.MediaInfo(playback.playback, contentType);
  info.metadata = new window.chrome.cast.media.GenericMediaMetadata();
  info.metadata.title = item.kind === 'episode' ? `${item.seriesTitle} · S${item.season} A${item.episode}` : item.title;
  info.metadata.subtitle = item.kind === 'episode' ? item.title : String(item.year || '');
  if (item.posterUrl) info.metadata.images = [{ url: item.posterUrl }];
  info.customData = { source: 'ThuisHub', mediaId: item.id, playbackDecision: decision?.mode };
  if (playback.subtitle) {
    const track = new window.chrome.cast.media.Track(1, window.chrome.cast.media.TrackType.TEXT);
    track.trackContentId = playback.subtitle; track.trackContentType = 'text/vtt'; track.subtype = window.chrome.cast.media.TextTrackType.SUBTITLES;
    track.name = 'Nederlands'; track.language = 'nl-NL'; info.tracks = [track];
  }
  const request = new window.chrome.cast.media.LoadRequest(info);
  request.autoplay = true;
  if (playback.subtitle) request.activeTrackIds = [1];
  await session.loadMedia(request);
  return session;
}

function contentTypeFor(item: MediaItem) {
  const codec = String(item.videoCodec || '').toLowerCase();
  if (codec === 'hevc' || codec === 'h265') return 'video/mp4; codecs="hvc1"';
  if (codec === 'av1') return 'video/mp4; codecs="av01"';
  return 'video/mp4';
}

export function castController() {
  if (!castAvailable()) return null;
  const context = window.cast.framework.CastContext.getInstance();
  const session = context.getCurrentSession();
  if (!session) return null;
  const player = new window.cast.framework.RemotePlayer();
  const controller = new window.cast.framework.RemotePlayerController(player);
  return { session, player, controller };
}

export function disconnectCast() { const session=castAvailable()?window.cast.framework.CastContext.getInstance().getCurrentSession():null;return session?.endSession(true); }
