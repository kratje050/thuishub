(function () {
  'use strict';

  var APP_VERSION = '1.2.13';
  var SERVICE_TYPE = '_thuishub._tcp';
  var root = document.getElementById('app');
  var prefs = { server: localStorage.server || '', token: localStorage.deviceToken || '' };
  var currentMediaId = 0;
  var currentSessionId = '';
  var lastProgressAt = 0;
  var serverConfirmed = false;
  var pairingBusy = false;
  var deviceSocket = null;
  var socketRetry = 0;
  var executedCommands = {};
  var deviceId = localStorage.deviceId || createUuid();
  localStorage.deviceId = deviceId;

  function createUuid() {
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.prototype.map.call(bytes, function (value) { return ('0' + value.toString(16)).slice(-2); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function request(path, method, body, device, base) {
    var target = (base || prefs.server) + path;
    if (!target || target.charAt(0) === '/') return Promise.reject(new Error('ThuisHub is nog niet gevonden.'));
    return fetch(target, {
      method: method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, device && prefs.token ? { Authorization: 'Device ' + prefs.token } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (error) { if (response.ok) throw new Error('Ongeldig antwoord van de server.'); }
        if (!response.ok) {
          var failure = new Error(data.error || ('Serverfout ' + response.status));
          failure.status = response.status;
          throw failure;
        }
        return data;
      });
    });
  }

  function isSafeLocalServer(value) {
    try {
      var parser = document.createElement('a');
      parser.href = String(value || '').replace(/\/$/, '');
      var protocol = parser.protocol.toLowerCase();
      var host = parser.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if ((protocol !== 'http:' && protocol !== 'https:') || !host || parser.username || parser.password) return false;
      if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127\./.test(host)) return false;
      var parts = host.split('.').map(Number);
      if (parts.length === 4 && parts.every(function (part) { return Number.isInteger(part) && part >= 0 && part <= 255; })) {
        return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
      }
      if (host.indexOf(':') >= 0) {
        var ipv6 = host.split('%')[0];
        return /^f[cd]/.test(ipv6) || /^fe[89ab]/.test(ipv6);
      }
      return /\.local$/.test(host) || host.indexOf('.') < 0;
    } catch (error) { return false; }
  }

  function verifyServer(candidate) {
    candidate = String(candidate || '').replace(/\/$/, '');
    if (!isSafeLocalServer(candidate)) return Promise.resolve(false);
    return request('/api/health', 'GET', null, false, candidate).then(function (health) {
      return health.app === 'thuishub' && health.status === 'ok';
    }).catch(function () { return false; });
  }

  function candidateUrl(service) {
    if (!service) return '';
    if (typeof service === 'string') return service;
    if (service.url) return service.url;
    if (service.txt && service.txt.url) return service.txt.url;
    var host = service.host || service.address || service.ip || '';
    var port = Number(service.port || 8788);
    if (!host || port < 1 || port > 65535) return '';
    if (host.indexOf(':') >= 0 && host.charAt(0) !== '[') host = '[' + host.replace(/%/g, '%25') + ']';
    return 'http://' + host + ':' + port;
  }

  function considerService(service) {
    if (serverConfirmed) return;
    var candidate = candidateUrl(service);
    verifyServer(candidate).then(function (valid) { if (valid && !serverConfirmed) selectServer(candidate); });
  }

  function discoverServer() {
    setStatus('ThuisHub wordt automatisch op het thuisnetwerk gezocht…');
    var started = false;
    try {
      if (window.webapis && webapis.serviceDiscovery && typeof webapis.serviceDiscovery.browse === 'function') {
        webapis.serviceDiscovery.browse(SERVICE_TYPE, considerService, function () {});
        started = true;
      }
    } catch (error) {}
    try {
      if (window.tizen && tizen.dnssd && typeof tizen.dnssd.browse === 'function') {
        tizen.dnssd.browse(SERVICE_TYPE, considerService, function () {});
        started = true;
      }
    } catch (error) {}
    try {
      if (window.thuishubServiceDiscovery && typeof window.thuishubServiceDiscovery.discover === 'function') {
        window.thuishubServiceDiscovery.discover(SERVICE_TYPE, considerService);
        started = true;
      }
    } catch (error) {}
    if (!started) setStatus('Deze Samsung-versie biedt geen mDNS-browser. Gebruik zo nodig Geavanceerd; er wordt geen IP-scan uitgevoerd.');
  }

  function selectServer(candidate) {
    if (serverConfirmed && prefs.server !== candidate) return;
    serverConfirmed = true;
    prefs.server = String(candidate).replace(/\/$/, '');
    localStorage.server = prefs.server;
    if (prefs.token) { library(); connectDeviceSocket(); }
    else beginPairing();
  }

  function capabilities() {
    var width = screen.width || 1920;
    var height = screen.height || 1080;
    var hdr = [];
    try {
      if (webapis.productinfo.isUdPanelSupported()) hdr.push('hdr10');
      if (webapis.productinfo.isHdrTvSupport()) hdr.push('hdr10', 'hdr10plus', 'hlg');
    } catch (error) {}
    var hdrFormats = ['sdr'].concat(hdr.filter(function (value, index, all) { return all.indexOf(value) === index; }));
    return {
      maxWidth: width, maxHeight: height, maxFrameRate: 60, maxBitrateMbps: width >= 3840 || height >= 2160 ? 40 : 20,
      containers: ['mp4', 'mpegts', 'mkv'], videoCodecs: ['h264', 'hevc'], maxBitDepth: hdrFormats.length > 1 ? 10 : 8,
      hdrFormats: hdrFormats, dolbyVisionProfiles: [],
      audioCodecs: ['aac', 'ac3', 'eac3'], maxAudioChannels: 6, passthrough: false, atmos: false,
      trueHd: false, eac3: true, dts: false, subtitleFormats: ['srt', 'webvtt'], arc: 'unknown',
      play: true, pause: true, stop: true, seek: true, position: true, volume: false,
      next: false, previous: false, audioTrackSelection: false, subtitleTrackSelection: false, qualitySelection: false
    };
  }

  function pairScreen() {
    root.innerHTML = '<section class="pair"><div><h2>Koppel deze Samsung-tv</h2>' +
      '<p id="pair-status">ThuisHub wordt automatisch gezocht…</p><div class="code" id="code"></div>' +
      '<button id="advanced">Geavanceerd: handmatig adres</button><div id="manual" hidden>' +
      '<input id="server" value="' + escapeHtml(prefs.server) + '" placeholder="http://192.168.1.10:8788">' +
      '<button id="manual-connect">Handmatig verbinden</button></div></div></section>';
    document.getElementById('advanced').onclick = function () {
      var manual = document.getElementById('manual');
      manual.hidden = !manual.hidden;
      if (!manual.hidden) document.getElementById('server').focus();
    };
    document.getElementById('manual-connect').onclick = function () {
      var candidate = document.getElementById('server').value.replace(/\/$/, '');
      if (!isSafeLocalServer(candidate)) { setStatus('Gebruik een privé-LAN-adres, bijvoorbeeld http://192.168.1.10:8788.'); return; }
      setStatus('Adres controleren…');
      verifyServer(candidate).then(function (valid) {
        if (valid) selectServer(candidate); else setStatus('Op dit adres is geen bereikbare ThuisHub-server gevonden.');
      });
    };
  }

  function beginPairing() {
    if (pairingBusy || !prefs.server) return;
    pairingBusy = true;
    setStatus('Veilige koppelcode aanvragen…');
    request('/api/devices/pair/request', 'POST', {
      id: deviceId,
      name: 'Samsung ' + safeModel(), manufacturer: 'Samsung', model: safeModel(), platform: 'tizen', appVersion: APP_VERSION,
      capabilities: capabilities()
    }, false).then(function (result) {
      document.getElementById('code').textContent = result.code;
      setStatus('Voer deze code in bij Dashboard → TV en afspeelapparaten.');
      pollPairing(result.deviceId, result.pairingSecret);
    }).catch(function (error) { pairingBusy = false; showError(error); });
  }

  function pollPairing(id, secret) {
    var timer = setInterval(function () {
      request('/api/devices/pair/claim', 'POST', { deviceId: id, pairingSecret: secret }, false).then(function (result) {
        if (result.status === 'approved') {
          clearInterval(timer);
          pairingBusy = false;
          prefs.token = result.token;
          localStorage.deviceToken = result.token;
          library();
          connectDeviceSocket();
        } else if (result.status === 'expired') {
          clearInterval(timer);
          pairingBusy = false;
          showError(new Error('Koppelcode verlopen.'));
        }
      }).catch(function () { /* Een korte netwerkonderbreking mag pairing niet afbreken. */ });
    }, 2000);
  }

  function library() {
    request('/api/device/library', 'GET', null, true).then(function (items) {
      root.innerHTML = '<h2>Bibliotheek</h2><div class="grid">' + items.map(function (item) {
        return '<button class="card" data-id="' + item.id + '"><b>' + escapeHtml(item.seriesTitle || item.title) + '</b><br><span>' +
          (item.kind === 'episode' ? 'S' + item.season + ' A' + item.episode : item.year || '') + '</span><p class="technical">' +
          (item.height || '?') + 'p · ' + (item.hdrType || 'sdr') + (item.atmos ? ' · Atmos' : '') + '</p></button>';
      }).join('') + '</div>';
      Array.prototype.forEach.call(document.querySelectorAll('.card'), function (card) {
        card.onclick = function () { play(Number(card.dataset.id)); };
      });
      var first = document.querySelector('.card');
      if (first) first.focus();
    }).catch(function (error) {
      if (error.status === 401) {
        localStorage.removeItem('deviceToken');
        prefs.token = '';
        pairScreen();
        beginPairing();
      } else showError(error);
    });
  }

  function play(id) {
    if (!id) return Promise.resolve(false);
    return request('/api/device/media/' + id + '/session', 'POST', { quality: 'auto' }, true).then(function (result) {
      return startPlayback(id, result.session && result.session.id || '', result.urls.playback,
        result.session && result.session.position || 0);
    }).catch(function (error) { showError(error); return false; });
  }

  function isSafePlaybackUrl(value) {
    try {
      var parser = document.createElement('a');
      parser.href = String(value || '');
      if (parser.protocol !== 'http:' && parser.protocol !== 'https:') return false;
      if (parser.username || parser.password || parser.hash || parser.pathname.indexOf('/api/playback/') !== 0) return false;
      return isSafeLocalServer(parser.protocol + '//' + parser.host);
    } catch (error) { return false; }
  }

  function startPlayback(id, sessionId, playbackUrl, startPositionSeconds) {
    if (!id || !isSafePlaybackUrl(playbackUrl)) return Promise.resolve(false);
    if (currentMediaId === id && currentSessionId === String(sessionId || '')) return Promise.resolve(true);
    var object = document.getElementById('av-player');
    object.style.display = 'block';
    try {
      try { webapis.avplay.close(); } catch (error) {}
      webapis.avplay.open(playbackUrl);
      webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
      webapis.avplay.setListener({
        onbufferingstart: function () { sendState('buffering'); },
        onbufferingcomplete: function () { sendState('playing'); },
        onstreamcompleted: function () { stopPlayback(true); },
        oncurrentplaytime: function (milliseconds) {
          if (Date.now() - lastProgressAt >= 9000) { lastProgressAt = Date.now(); progress(milliseconds, 'playing'); }
        },
        onerror: function (error) { playbackFailed(object, new Error(error)); }
      });
    } catch (error) {
      playbackFailed(object, error);
      return Promise.resolve(false);
    }
    currentMediaId = id;
    currentSessionId = String(sessionId || '');
    lastProgressAt = 0;
    return new Promise(function (resolve) {
      webapis.avplay.prepareAsync(function () {
        var startSeconds = Number(startPositionSeconds);
        var startMilliseconds = isFinite(startSeconds) ? Math.max(0, startSeconds) * 1000 : 0;
        var started = false;
        var begin = function () {
          if (started) return;
          started = true;
          try {
            webapis.avplay.play();
            sendState('playing');
            resolve(true);
          } catch (error) {
            playbackFailed(object, error);
            resolve(false);
          }
        };
        if (startMilliseconds > 0) {
          try { webapis.avplay.seekTo(startMilliseconds, begin, begin); } catch (error) { begin(); }
        } else begin();
      }, function (error) { playbackFailed(object, new Error(error)); resolve(false); });
    });
  }

  function playbackFailed(object, error) {
    if (currentMediaId && currentSessionId) sendState('error');
    try { webapis.avplay.close(); } catch (closeError) {}
    if (object) object.style.display = 'none';
    currentMediaId = 0;
    currentSessionId = '';
    showError(error);
  }

  function socketUrl() {
    return prefs.server.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/api/device/ws';
  }

  function connectDeviceSocket() {
    if (!prefs.server || !prefs.token || !window.WebSocket) return;
    if (deviceSocket && (deviceSocket.readyState === WebSocket.OPEN || deviceSocket.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(socketRetry);
    try {
      deviceSocket = new WebSocket(socketUrl());
      deviceSocket.onopen = function () {
        deviceSocket.send(JSON.stringify({ type: 'authenticate', token: prefs.token, deviceId: deviceId }));
      };
      deviceSocket.onmessage = function (event) {
        var message;
        try { message = JSON.parse(event.data); } catch (error) { return; }
        if (message.type === 'command') handleSocketCommand(message);
      };
      deviceSocket.onclose = function () {
        deviceSocket = null;
        if (prefs.token) socketRetry = setTimeout(connectDeviceSocket, 5000);
      };
      deviceSocket.onerror = function () { try { deviceSocket.close(); } catch (error) {} };
    } catch (error) { socketRetry = setTimeout(connectDeviceSocket, 5000); }
  }

  function socketReady() { return deviceSocket && deviceSocket.readyState === WebSocket.OPEN; }

  function handleSocketCommand(message) {
    var id = Number(message.id);
    if (!id) return;
    if (executedCommands[id]) { acknowledgeCommand(id, true); return; }
    executeCommand({ id: id, command: message.command, payload: message.payload || {} }).then(function (executed) {
      if (executed) { rememberExecuted(id); acknowledgeCommand(id, true); }
    });
  }

  function rememberExecuted(id) {
    executedCommands[id] = true;
    var ids = Object.keys(executedCommands).map(Number).sort(function (left, right) { return left - right; });
    while (ids.length > 500) delete executedCommands[ids.shift()];
  }

  function acknowledgeCommand(id, preferSocket) {
    if (preferSocket && socketReady()) {
      try { deviceSocket.send(JSON.stringify({ type: 'ack', commandId: id })); return; } catch (error) {}
    }
    request('/api/device/commands/' + id + '/ack', 'POST', {}, true).catch(function () {});
  }

  function executeCommand(entry) {
    var payload = entry.payload || {};
    try {
      if (entry.command !== 'load' && payload.sessionId && currentSessionId && String(payload.sessionId) !== currentSessionId) return Promise.resolve(true);
      if (entry.command === 'play' && currentMediaId) { webapis.avplay.play(); sendState('playing'); return Promise.resolve(true); }
      if (entry.command === 'pause' && currentMediaId) { webapis.avplay.pause(); sendState('paused'); return Promise.resolve(true); }
      if (entry.command === 'stop' && currentMediaId) return Promise.resolve(stopPlayback(true));
      if (entry.command === 'seek' && currentMediaId) {
        if (payload.positionSeconds != null) webapis.avplay.seekTo(Number(payload.positionSeconds) * 1000);
        else if (Number(payload.deltaSeconds) > 0) webapis.avplay.jumpForward(Number(payload.deltaSeconds) * 1000);
        else if (Number(payload.deltaSeconds) < 0) webapis.avplay.jumpBackward(Math.abs(Number(payload.deltaSeconds)) * 1000);
        else return Promise.resolve(false);
        return Promise.resolve(true);
      }
      if (entry.command === 'disconnect') { stopPlayback(false); library(); return Promise.resolve(true); }
      if (entry.command === 'load' && Number(payload.mediaId) > 0 && payload.sessionId && payload.urls && payload.urls.playback) {
        return startPlayback(Number(payload.mediaId), payload.sessionId, payload.urls.playback,
          payload.position != null ? payload.position : payload.positionSeconds);
      }
    } catch (error) { return Promise.resolve(false); }
    return Promise.resolve(false);
  }

  function pollCommands() {
    if (!prefs.token || socketReady()) return;
    request('/api/device/commands', 'GET', null, true).then(function (result) {
      (result.items || []).reduce(function (chain, entry) {
        return chain.then(function () {
          if (executedCommands[entry.id]) { acknowledgeCommand(entry.id, false); return false; }
          return executeCommand(entry).then(function (executed) {
            if (executed) { rememberExecuted(entry.id); acknowledgeCommand(entry.id, false); }
          });
        });
      }, Promise.resolve());
    }).catch(function () {});
  }

  function progress(milliseconds, state) {
    if (!currentMediaId) return;
    var duration = 0;
    try { duration = webapis.avplay.getDuration(); } catch (error) {}
    var payload = { sessionId: currentSessionId, position: milliseconds / 1000, duration: duration / 1000, state: state || 'playing' };
    if (socketReady() && currentSessionId) {
      try { deviceSocket.send(JSON.stringify(Object.assign({ type: 'progress' }, payload))); return; } catch (error) {}
    }
    request('/api/device/media/' + currentMediaId + '/progress', 'PUT', payload, true).catch(function () {});
  }

  function sendState(state) {
    var position = 0;
    try { position = webapis.avplay.getCurrentTime(); } catch (error) {}
    progress(position, state);
  }

  function stopPlayback(showLibrary) {
    var wasPlaying = Boolean(currentMediaId);
    if (wasPlaying) sendState('stopped');
    try { webapis.avplay.stop(); webapis.avplay.close(); } catch (error) {}
    document.getElementById('av-player').style.display = 'none';
    currentMediaId = 0;
    currentSessionId = '';
    if (showLibrary) library();
    return wasPlaying;
  }

  function safeModel() { try { return webapis.productinfo.getRealModel(); } catch (error) { return 'Smart TV'; } }
  function setStatus(message) {
    var target = document.getElementById('pair-status') || document.getElementById('status');
    if (target) target.textContent = message;
  }
  function showError(error) { setStatus(error.message || String(error)); }
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  document.addEventListener('keydown', function (event) {
    if (!currentMediaId) return;
    if (event.keyCode === 10009 || event.keyCode === 413) stopPlayback(true);
    else if (event.keyCode === 415) { webapis.avplay.play(); sendState('playing'); }
    else if (event.keyCode === 19) { webapis.avplay.pause(); sendState('paused'); }
    else if (event.keyCode === 417) webapis.avplay.jumpForward(30000);
    else if (event.keyCode === 412) webapis.avplay.jumpBackward(30000);
  });
  try { tizen.tvinputdevice.registerKeyBatch(['MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind']); } catch (error) {}

  setInterval(pollCommands, 2000);
  pairScreen();
  discoverServer();
  if (prefs.server) verifyServer(prefs.server).then(function (valid) {
    if (valid) selectServer(prefs.server);
    else setStatus('Opgeslagen server niet bereikbaar; automatisch zoeken gaat door.');
  });
}());
