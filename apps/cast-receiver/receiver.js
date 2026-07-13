(function () {
  'use strict';

  var framework = window.cast && cast.framework;
  var ui = {
    artwork: document.getElementById('artwork'), poster: document.getElementById('poster'), state: document.getElementById('state'),
    title: document.getElementById('title'), subtitle: document.getElementById('subtitle'), badges: document.getElementById('badges'),
    progress: document.getElementById('progress'), elapsed: document.getElementById('elapsed'), duration: document.getElementById('duration'),
    tracks: document.getElementById('tracks'), queue: document.getElementById('queue'), error: document.getElementById('error'),
    errorMessage: document.getElementById('error-message')
  };

  if (!framework) {
    showError('Google Cast Application Framework kon niet worden geladen.');
    return;
  }

  var context = framework.CastReceiverContext.getInstance();
  var player = context.getPlayerManager();
  var queueLength = 0;
  var lastRequest = null;

  function isPrivatePlaybackUrl(value) {
    try {
      var url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      var host = url.hostname.toLowerCase();
      if (!host || host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127\./.test(host)) return false;
      var parts = host.split('.').map(Number);
      if (parts.length === 4 && parts.every(Number.isInteger)) {
        return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
      }
      if (host.indexOf(':') >= 0) {
        var ipv6 = host.split('%')[0];
        return /^f[cd]/.test(ipv6) || /^fe[89ab]/.test(ipv6);
      }
      return /\.local$/.test(host) || host.indexOf('.') < 0;
    } catch (error) { return false; }
  }

  function validateMedia(media) {
    var custom = media && media.customData || {};
    var contentUrl = media && (media.contentUrl || media.contentId) || '';
    if (custom.source !== 'ThuisHub') throw new Error('Alleen beveiligde ThuisHub-media is toegestaan.');
    if (!isPrivatePlaybackUrl(contentUrl)) throw new Error('De afspeellink wijst niet naar de privé-LAN-server.');
    if (typeof context.canDisplayType === 'function' && media.contentType) {
      var technical = custom.technical || {};
      var codec = technical.videoCodec || custom.videoCodec || '';
      var supported = context.canDisplayType(media.contentType, codec, technical.width, technical.height, technical.frameRate);
      if (supported === false && custom.playbackDecision === 'direct_play') throw new Error('Dit Cast-apparaat meldt dat de gekozen Direct Play-codec niet wordt ondersteund.');
    }
    return media;
  }

  player.setMessageInterceptor(framework.messages.MessageType.LOAD, function (request) {
    validateMedia(request.media);
    lastRequest = request;
    queueLength = request.queueData && request.queueData.items ? request.queueData.items.length : 1;
    hideError();
    renderMedia(request.media, request.queueData);
    return request;
  });

  if (framework.messages.MessageType.QUEUE_LOAD) {
    player.setMessageInterceptor(framework.messages.MessageType.QUEUE_LOAD, function (request) {
      var items = request.items || request.queueData && request.queueData.items || [];
      items.forEach(function (item) { validateMedia(item.media || item); });
      queueLength = items.length;
      lastRequest = request;
      if (items[0]) renderMedia(items[0].media || items[0], request.queueData);
      return request;
    });
  }

  function mediaInformation() {
    try { return player.getMediaInformation(); } catch (error) { return lastRequest && lastRequest.media || null; }
  }

  function renderMedia(media, queueData) {
    if (!media) return;
    var metadata = media.metadata || {};
    var custom = media.customData || {};
    var images = metadata.images || [];
    var artwork = images[0] && images[0].url || custom.posterUrl || '';
    var backdrop = images[1] && images[1].url || custom.backdropUrl || artwork;
    ui.title.textContent = metadata.title || custom.title || 'ThuisHub';
    ui.subtitle.textContent = metadata.subtitle || custom.subtitle || (media.streamType === 'LIVE' ? 'Live TV' : '');
    if (artwork) { ui.poster.src = artwork; ui.poster.alt = metadata.title || ''; } else { ui.poster.removeAttribute('src'); ui.poster.alt = ''; }
    ui.artwork.style.backgroundImage = backdrop ? 'url("' + String(backdrop).replace(/["\\]/g, '') + '")' : '';
    var technical = custom.technical || {};
    var badges = [
      custom.playbackDecision ? String(custom.playbackDecision).replace(/_/g, ' ') : '',
      technical.height ? technical.height + 'p' : '', technical.hdr && technical.hdr !== 'sdr' ? String(technical.hdr).toUpperCase() : '',
      technical.atmos ? 'Dolby Atmos' : '', technical.audioCodec || '', media.streamType === 'LIVE' ? 'LIVE' : ''
    ].filter(Boolean);
    ui.badges.innerHTML = badges.map(function (badge) { return '<b>' + escapeHtml(badge) + '</b>'; }).join('');
    renderTracks(media.tracks || []);
    queueLength = queueData && queueData.items ? queueData.items.length : queueLength;
    ui.queue.textContent = queueLength > 1 ? queueLength + ' items in wachtrij · autoplay actief' : 'Geen volgende titel in de wachtrij';
  }

  function renderTracks(tracks) {
    var audio = tracks.filter(function (track) { return String(track.type).toUpperCase().indexOf('AUDIO') >= 0; });
    var text = tracks.filter(function (track) { return String(track.type).toUpperCase().indexOf('TEXT') >= 0; });
    var labels = [];
    if (audio.length) labels.push(audio.length + ' audiotrack' + (audio.length === 1 ? '' : 's'));
    if (text.length) labels.push(text.length + ' ondertiteling' + (text.length === 1 ? '' : 'en'));
    ui.tracks.textContent = labels.length ? labels.join(' · ') : 'Geen extra audio- of ondertiteltracks';
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor(seconds % 3600 / 60);
    var remainder = Math.floor(seconds % 60);
    return (hours ? hours + ':' + String(minutes).padStart(2, '0') : minutes) + ':' + String(remainder).padStart(2, '0');
  }

  function refreshProgress() {
    var current = 0;
    var duration = 0;
    var state = '';
    try { current = player.getCurrentTimeSec() || 0; duration = player.getDurationSec() || 0; state = String(player.getPlayerState() || ''); } catch (error) {}
    ui.elapsed.textContent = formatTime(current);
    ui.duration.textContent = formatTime(duration);
    ui.progress.style.width = duration > 0 ? Math.min(100, current / duration * 100) + '%' : '0%';
    ui.state.textContent = state === 'PLAYING' ? 'AFSPELEN OP CAST' : state === 'PAUSED' ? 'GEPAUZEERD' : state === 'BUFFERING' ? 'BUFFEREN…' : state || 'VERBONDEN MET THUISHUB';
  }

  function showError(message) {
    ui.error.hidden = false;
    ui.errorMessage.textContent = message || 'Onbekende receiverfout.';
    ui.state.textContent = 'AFSPEELFOUT';
  }
  function hideError() { ui.error.hidden = true; ui.errorMessage.textContent = ''; }
  function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]; }); }

  [framework.events.EventType.PLAYER_LOAD_COMPLETE, framework.events.EventType.MEDIA_STATUS, framework.events.EventType.PLAYING,
    framework.events.EventType.PAUSE, framework.events.EventType.BUFFERING, framework.events.EventType.TIME_UPDATE].filter(Boolean).forEach(function (eventType) {
    player.addEventListener(eventType, function () { renderMedia(mediaInformation()); refreshProgress(); });
  });
  player.addEventListener(framework.events.EventType.ERROR, function (event) {
    showError('Receiverfout ' + (event && (event.detailedErrorCode || event.errorCode) || 'onbekend') + '. Controleer de LAN-streamingserver en codecinstellingen.');
  });

  setInterval(refreshProgress, 500);
  context.start({ disableIdleTimeout: false, maxInactivity: 3600, statusText: 'ThuisHub is klaar' });
}());
