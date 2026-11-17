// Runs inside music.youtube.com. Exposes window.__res — the bridge Resonance's UI talks to.
(() => {
  if (location.hostname !== 'music.youtube.com' || window.__res) return;
  const $ = (s, r = document) => (r ? r.querySelector(s) : null);
  const $$ = (s, r = document) => (r ? Array.from(r.querySelectorAll(s)) : []);
  const bar = () => $('ytmusic-player-bar');
  const video = () => $('video');
  const player = () => $('#movie_player');
  const text = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const runs = (o) => (o && o.runs ? o.runs.map((r) => r.text).join('') : (o && o.simpleText) || '');
  const dataOf = (el) => (el && (el.data || (el.__data && el.__data.data) || (el.polymerController && el.polymerController.data))) || null;

  const clickFirst = (sels, root) => {
    for (const s of sels) { const el = $(s, root || document); if (el) { el.click(); return true; } }
    return false;
  };

  const bigArt = (u) => {
    if (!u) return '';
    return u.replace(/=w\d+-h\d+[^&?#]*/, '=w544-h544-l90-rj').replace(/\/(default|mqdefault|sddefault)\.jpg/, '/hqdefault.jpg');
  };

  const BROWSE = { home: 'FEmusic_home', explore: 'FEmusic_explore', library: 'FEmusic_library_landing' };

  function guideEntries() {
    return $$('ytmusic-guide-entry-renderer').map((el) => {
      const d = dataOf(el) || {};
      const ep = d.navigationEndpoint && d.navigationEndpoint.browseEndpoint;
      return { el, id: ep && ep.browseId, title: runs(d.formattedTitle) || text($('.title', el)) || text(el), subtitle: runs(d.formattedSubtitle) };
    });
  }

  function ytNavigate(endpoint) {
    const app = $('ytmusic-app');
    if (!app) return false;
    app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } }));
    return true;
  }

  function navTo(browseId, fallbackPath) {
    const before = location.href;
    const pivot = $(`ytmusic-pivot-bar-item-renderer[tab-id="${browseId}"]`);
    const entry = guideEntries().find((g) => g.id === browseId);
    if (entry) (($('tp-yt-paper-item', entry.el)) || entry.el).click();
    else if (pivot) pivot.click();
    else ytNavigate({ browseEndpoint: { browseId } });
    // Last resort if the in-app navigation did nothing. Never full-reload while music plays.
    setTimeout(() => {
      if (location.href !== before || !fallbackPath) return;
      const v = video();
      if (v && !v.paused) ytNavigate({ browseEndpoint: { browseId } });
      else location.assign(fallbackPath);
    }, 2500);
  }

  function likeStatus(b) {
    const r = $('ytmusic-like-button-renderer', b);
    if (!r) return 'INDIFFERENT';
    return r.getAttribute('like-status') || (dataOf(r) && dataOf(r).likeStatus) || 'INDIFFERENT';
  }

  // ---- library playlists (with cover art) via YouTube Music's own API ----
  let libCache = null;
  async function sha1hex(str) {
    const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  // Authenticated call to YouTube Music's own internal API (same as the website does).
  async function innertube(endpoint, body) {
    const cfg = window.ytcfg;
    if (!cfg || !cfg.get) return null;
    const key = cfg.get('INNERTUBE_API_KEY');
    const ctx = cfg.get('INNERTUBE_CONTEXT');
    if (!ctx) return null;
    const headers = { 'Content-Type': 'application/json', 'X-Origin': location.origin, 'X-Goog-AuthUser': String(cfg.get('SESSION_INDEX') || 0) };
    const m = document.cookie.match(/(?:^|;\s*)SAPISID=([^;]+)/) || document.cookie.match(/(?:^|;\s*)__Secure-3PAPISID=([^;]+)/);
    if (m) {
      const ts = Math.floor(Date.now() / 1000);
      headers.Authorization = `SAPISIDHASH ${ts}_${await sha1hex(`${ts} ${m[1]} ${location.origin}`)}`;
    }
    const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false${key ? '&key=' + key : ''}`, {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify(Object.assign({ context: ctx }, body || {})),
    });
    return res.ok ? res.json() : null;
  }

  // Signed-in account: name + profile picture (from the account menu, like the website's avatar button).
  let acctCache = null;
  async function fetchAccount() {
    const json = await innertube('account/account_menu', {});
    if (!json) return null;
    let found = null;
    const walk = (o) => {
      if (!o || typeof o !== 'object' || found) return;
      const h = o.activeAccountHeaderRenderer;
      if (h) {
        const th = h.accountPhoto && h.accountPhoto.thumbnails;
        found = {
          name: runs(h.accountName),
          handle: runs(h.channelHandle) || runs(h.email) || '',
          photo: th && th.length ? th[th.length - 1].url.replace(/=s\d+[^&?#]*/, '=s256-c-k-c0x00ffffff-no-rj') : '',
        };
        return;
      }
      for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
    };
    walk(json);
    return found;
  }

  async function fetchLibraryPlaylists() {
    const json = await innertube('browse', { browseId: 'FEmusic_liked_playlists' });
    if (!json) return null;
    const out = [], seen = new Set();
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      const r = o.musicTwoRowItemRenderer;
      if (r) {
        const id = r.navigationEndpoint && r.navigationEndpoint.browseEndpoint && r.navigationEndpoint.browseEndpoint.browseId;
        const th = r.thumbnailRenderer && r.thumbnailRenderer.musicThumbnailRenderer && r.thumbnailRenderer.musicThumbnailRenderer.thumbnail && r.thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails;
        if (id && id.startsWith('VL') && !seen.has(id)) {
          seen.add(id);
          let thumb = th && th.length ? th[th.length - 1].url : '';
          thumb = thumb.replace(/=w\d+-h\d+[^&?#]*/, '=w120-h120-l90-rj');
          out.push({ id, title: runs(r.title), subtitle: runs(r.subtitle), thumb });
        }
      }
      for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
    };
    walk(json);
    return out;
  }


  // ---- YouTube Music's "⋮" menus (songs, albums, playlists), shown in Resonance's own style ----
  const ROW_SEL = 'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-player-queue-item, ytmusic-multi-row-list-item-renderer, ytmusic-responsive-header-renderer, ytmusic-detail-header-renderer, ytmusic-immersive-header-renderer, ytmusic-card-shelf-renderer, ytmusic-player-bar';
  // "Save to library" / likes are left out (likes live on the heart button)
  const SKIP_ICON = /^(LIBRARY_ADD|LIBRARY_SAVED|LIBRARY_REMOVE|ADD_TO_LIBRARY|REMOVE_FROM_LIBRARY|BOOKMARK|BOOKMARK_BORDER|LIKE|DISLIKE|THUMB_UP|THUMB_DOWN|FAVORITE)$/;
  const SKIP_TEXT = /\blibrary\b|bibliotek|biblioth|biblioteca|libreria|\blike\b|dislike|polub|nie podoba/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let menuRef = null;

  function ownMenu(row) {
    if (!row) return null;
    return $$('ytmusic-menu-renderer', row).find((m) => m.closest(ROW_SEL) === row) || null;
  }
  function findIds(o) {
    const out = {};
    const walk = (x, d) => {
      if (!x || typeof x !== 'object' || d > 9 || (out.videoId && out.playlistId)) return;
      if (typeof x.videoId === 'string' && !out.videoId) out.videoId = x.videoId;
      if (typeof x.playlistId === 'string' && !out.playlistId) out.playlistId = x.playlistId;
      for (const k in x) if (x[k] && typeof x[k] === 'object') walk(x[k], d + 1);
    };
    walk(o, 0);
    return out;
  }
  function itemsFromData(menu) {
    const d = dataOf(menu);
    if (!d || !Array.isArray(d.items)) return null;
    const out = [];
    d.items.forEach((it) => {
      const r = it.menuNavigationItemRenderer || it.menuServiceItemRenderer || it.toggleMenuServiceItemRenderer || it.menuServiceItemDownloadRenderer;
      if (!r) return;
      const label = runs(r.text) || runs(r.defaultText) || (it.menuServiceItemDownloadRenderer ? 'Download' : '');
      const icon = ((r.icon || r.defaultIcon || {}).iconType) || '';
      if (!label || SKIP_ICON.test(icon) || (!icon && SKIP_TEXT.test(label)) || it.toggleMenuServiceItemRenderer && /LIBRARY/.test(icon + ((r.toggledIcon || {}).iconType || ''))) return;
      const ep = r.navigationEndpoint || r.serviceEndpoint || r.defaultServiceEndpoint || {};
      const atp = ep.addToPlaylistEndpoint;
      out.push({
        label, icon,
        kind: atp ? 'playlist' : ep.shareEntityEndpoint ? 'share' : '',
        target: atp ? (atp.videoId ? { videoId: atp.videoId } : { playlistId: atp.playlistId }) : null,
      });
    });
    return out;
  }
  function openDropdowns() {
    return $$('tp-yt-iron-dropdown').filter((d) => d.opened || (d.style.display !== 'none' && d.getAttribute('aria-hidden') !== 'true' && d.offsetParent !== null));
  }
  function closeDropdowns() {
    openDropdowns().forEach((d) => { try { d.close ? d.close() : (d.style.display = 'none'); } catch (e) {} });
  }
  function popupItems() {
    const pops = openDropdowns().map((d) => $('ytmusic-menu-popup-renderer', d)).filter(Boolean);
    const root = pops[pops.length - 1];
    return root ? $$('ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer, ytmusic-toggle-menu-service-item-renderer, ytmusic-menu-service-item-download-renderer', root) : [];
  }
  // Open YouTube Music's own menu invisibly ("ghost") and optionally click one of its items.
  async function ghostMenu(menu, pick) {
    const html = document.documentElement;
    html.classList.add('res-menu-ghost');
    let result = null;
    try {
      closeDropdowns();
      const btn = $('yt-button-shape button, #button, yt-icon-button button, yt-icon-button, button', menu);
      if (!btn) return null;
      btn.click();
      for (let k = 0, n = pick ? 25 : 10; k < n; k++) {
        await sleep(60);
        const items = popupItems();
        if (!items.length) continue;
        await sleep(40);
        result = pick ? pick(popupItems()) : popupItems();
        break;
      }
    } finally {
      setTimeout(() => { html.classList.remove('res-menu-ghost'); }, pick ? 450 : 0);
      if (!pick) closeDropdowns();
    }
    return result;
  }

  // ---- keep Resonance's color glow behind the content ----
  // Finds large elements near the top of the page that paint their own background
  // (YouTube Music's header strips, page backdrops) and makes them transparent.
  const KEEP = 'ytmusic-player, #player, #song-media-window, ytmusic-menu-popup-renderer, tp-yt-paper-dialog, tp-yt-iron-dropdown, ytmusic-search-box, ytmusic-dropdown-renderer, ytmusic-toggle-menu-service-item-renderer';
  const SKIP_TAG = /^(IMG|VIDEO|CANVAS|YT-IMG-SHADOW|YT-ICON|BUTTON|INPUT|A|TP-YT-PAPER-ICON-BUTTON|YTMUSIC-PLAYER-PAGE|HTML|BODY)$/;
  function clearBackdrops() {
    const box = window.__resBox || { t: 44, l: 300, r: 8, b: 88 };
    const x0 = box.l + 4, x1 = innerWidth - box.r - 4, y0 = box.t + 2, y1 = innerHeight - box.b - 4;
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0, seen = new Set();
    for (const fy of [0, 0.04, 0.09, 0.14, 0.2, 0.28, 0.38, 0.55, 0.8]) {
      const y = y0 + (y1 - y0) * fy;
      for (const fx of [0.15, 0.5, 0.85]) {
        for (const el of document.elementsFromPoint(x0 + w * fx, y)) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (el.tagName === 'RES-SHELL' || SKIP_TAG.test(el.tagName) || el.closest(KEEP)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < w * 0.45) continue;
          const cs = getComputedStyle(el);
          const solid = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
          const grad = /gradient/.test(cs.backgroundImage);
          if (solid || grad) el.style.setProperty('background', 'transparent', 'important');
          if (cs.backdropFilter && cs.backdropFilter !== 'none') el.style.setProperty('backdrop-filter', 'none', 'important');
        }
      }
    }
  }

  // "Cover" mode: draw the album art over the video area (YouTube Music leaves it grey).
  function syncCoverOverlay(art) {
    const on = document.documentElement.classList.contains('res-cover');
    const p = $('ytmusic-player#player') || $('ytmusic-player');
    let ov = document.getElementById('res-cover-art');
    if (!on || !p || !art) { if (ov) ov.remove(); return; }
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'res-cover-art';
      ov.style.cssText = 'position:absolute;inset:0;z-index:60;pointer-events:none;overflow:hidden;background:#0b0b0f;border-radius:inherit';
      const blur = document.createElement('div');
      blur.className = 'res-cover-blur';
      blur.style.cssText = 'position:absolute;inset:-40px;background:center/cover no-repeat;filter:blur(40px) saturate(1.4) brightness(.55)';
      const img = document.createElement('div');
      img.className = 'res-cover-img';
      img.style.cssText = 'position:absolute;inset:6%;background:center/contain no-repeat;filter:drop-shadow(0 12px 32px rgba(0,0,0,.55))';
      ov.appendChild(blur); ov.appendChild(img);
    }
    if (ov.parentNode !== p) {
      if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
      p.appendChild(ov);
    }
    if (ov.dataset.art !== art) {
      ov.dataset.art = art;
      const u = `url("${art.replace(/"/g, '%22')}")`;
      ov.firstChild.style.backgroundImage = u;
      ov.lastChild.style.backgroundImage = u;
    }
  }

  // ---- remember the last song (and the playlist it was in) so Play can resume it on next launch ----
  function currentSession() {
    const p = player();
    if (!p || !p.getVideoData) return null;
    const d = p.getVideoData() || {};
    if (!d.video_id) return null;
    let list = '';
    let idx = null;
    try { list = (p.getPlaylistId && p.getPlaylistId()) || ''; } catch (e) {}
    try { const i = p.getPlaylistIndex && p.getPlaylistIndex(); if (typeof i === 'number' && i >= 0) idx = i; } catch (e) {}
    if (!list) { try { list = new URLSearchParams(location.search).get('list') || ''; } catch (e) {} }
    return { videoId: d.video_id, playlistId: list, index: idx };
  }
  function loadLast() { try { return JSON.parse(localStorage.getItem('res-last') || 'null'); } catch (e) { return null; } }
  setInterval(() => {
    try {
      const s = api.state();
      if (!s.hasTrack || s.ad) return;
      const ses = currentSession();
      if (!ses) return;
      localStorage.setItem('res-last', JSON.stringify(Object.assign(ses, { time: Math.floor(s.time), title: s.title, artist: s.artist, art: s.art, at: Date.now() })));
    } catch (e) {}
  }, 4000);
  // after a full-page resume, jump to the saved position once the song has loaded
  try {
    const pending = JSON.parse(sessionStorage.getItem('res-resume-seek') || 'null');
    if (pending) {
      sessionStorage.removeItem('res-resume-seek');
      const t0 = Date.now();
      const iv = setInterval(() => {
        const p = player(), v = video();
        const id = p && p.getVideoData && (p.getVideoData() || {}).video_id;
        if (id === pending.id && v && v.readyState >= 1) {
          clearInterval(iv);
          if (pending.t > 5 && p.seekTo) p.seekTo(pending.t, true);
          setTimeout(() => api.cmd('closePlayerPage'), 800);
        } else if (Date.now() - t0 > 15000) clearInterval(iv);
      }, 300);
    }
  } catch (e) {}

  let resuming = 0;
  function resume(r) {
    if (!r || !r.videoId) return false;
    if (Date.now() - resuming < 6000) return true; // already resuming — ignore repeated presses
    resuming = Date.now();
    const ep = { videoId: r.videoId };
    if (r.playlistId) ep.playlistId = r.playlistId;
    if (r.index != null) ep.index = r.index;
    ytNavigate({ watchEndpoint: ep });
    const t0 = Date.now();
    let found = false;
    const iv = setInterval(() => {
      const p = player(), v = video();
      const id = p && p.getVideoData && (p.getVideoData() || {}).video_id;
      if (id === r.videoId) found = true;
      if (found && v && v.readyState >= 1) {
        clearInterval(iv);
        resuming = 0;
        if (r.time > 5 && r.time < (v.duration || Infinity) - 3 && p.seekTo) p.seekTo(r.time, true);
        if (v.paused) { try { v.play(); } catch (e) {} }
        setTimeout(() => api.cmd('closePlayerPage'), 700);
      } else if (found && Date.now() - t0 > 15000) {
        clearInterval(iv); resuming = 0;            // song is there but slow to load: leave it be
      } else if (!found && Date.now() - t0 > 4000) {
        // in-app navigation didn't take: load the song's page directly
        clearInterval(iv);
        try { sessionStorage.setItem('res-resume-seek', JSON.stringify({ id: r.videoId, t: r.time || 0 })); } catch (e) {}
        location.assign('/watch?v=' + encodeURIComponent(r.videoId) + (r.playlistId ? '&list=' + encodeURIComponent(r.playlistId) : ''));
      }
    }, 250);
    return true;
  }

  // ---- keep YouTube Music's content between the sidebar and the right edge ----
  function contentEl() {
    const cands = [
      ...$$('ytmusic-app-layout > #content > *'),
      ...$$('#content.ytmusic-app-layout > *'),
      ...$$('ytmusic-browse-response, ytmusic-search-page, ytmusic-tabbed-search-results-renderer'),
    ];
    for (const el of cands) {
      if (!el || el.closest('ytmusic-player-page') || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 200 && r.height > 50) return el;
    }
    return null;
  }
  function fit() {
    const box = window.__resBox;
    const el = contentEl();
    if (!box || !el) return;
    const r = el.getBoundingClientRect();
    const dl = box.l - r.left;
    const dr = (innerWidth - box.r) - r.right;
    if (Math.abs(dl) < 1.5 && Math.abs(dr) < 1.5) return;
    // only push content out from under the sidebar / panel, or undo our own earlier push
    const ml = Math.max(0, (parseFloat(el.style.marginLeft) || 0) + dl);
    const mr = Math.max(0, (parseFloat(el.style.marginRight) || 0) - dr);
    if (Math.abs(ml - (parseFloat(el.style.marginLeft) || 0)) < 1 && Math.abs(mr - (parseFloat(el.style.marginRight) || 0)) < 1) return;
    el.style.setProperty('margin-left', ml + 'px', 'important');
    el.style.setProperty('margin-right', mr + 'px', 'important');
    el.style.setProperty('box-sizing', 'border-box', 'important');
    clearTimeout(fit._t);
    fit._t = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  }
  setInterval(() => { try { fit(); } catch (e) {} }, 700);
  window.addEventListener('yt-navigate-finish', () => setTimeout(() => { try { fit(); } catch (e) {} }, 50));

  // ---- Shuffle on/off. YouTube Music only has a one-shot "shuffle the queue" action, so:
  // ON  = shuffle the queue now, and again whenever a new playlist starts;
  // OFF = reload the playlist in its original order, continuing from the current song.
  let shuffleOn = false;
  try { shuffleOn = localStorage.getItem('res-shuffle') === '1'; } catch (e) {}
  let shuffledFor = '', lastShuffleAt = 0;
  const shuffleQueue = () => {
    if (Date.now() - lastShuffleAt < 3000) return false;
    lastShuffleAt = Date.now();
    const ok = clickFirst(['.shuffle', 'yt-icon-button.shuffle', '[aria-label*="Shuffle" i]'], bar());
    // YouTube Music may give the shuffled queue a new playlist id; remember whatever it ends up as
    setTimeout(() => { const s = currentSession(); if (s && s.playlistId) shuffledFor = s.playlistId; }, 2500);
    return ok;
  };
  function setShuffle(on) {
    shuffleOn = !!on;
    try { localStorage.setItem('res-shuffle', shuffleOn ? '1' : '0'); } catch (e) {}
    const ses = currentSession();
    if (shuffleOn) {
      shuffleQueue();
      shuffledFor = (ses && ses.playlistId) || '';
    } else if (ses && ses.playlistId && !/^RD/.test(ses.playlistId)) {
      const v = video();
      shuffledFor = '';
      resume({ videoId: ses.videoId, playlistId: ses.playlistId, time: v ? v.currentTime : 0 });
    }
  }
  setInterval(() => {
    if (!shuffleOn) return;
    const ses = currentSession();
    if (ses && ses.playlistId && ses.playlistId !== shuffledFor && Date.now() - lastShuffleAt > 15000) { shuffledFor = ses.playlistId; setTimeout(shuffleQueue, 800); }
  }, 1500);

  // ---- audio effects: crossfade (fade out/in between songs) and volume leveling ----
  // Uses the browser's Web Audio on YouTube Music's own player. Only hooks MediaSource (blob:)
  // playback, which is what YouTube Music uses — never cross-origin media that would go silent.
  const EQ_FREQ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const fx = { fade: 0, level: false, eqOn: false, eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], viz: false };
  try { Object.assign(fx, JSON.parse(localStorage.getItem('res-fx') || '{}')); } catch (e) {}
  let actx = null, srcNode = null, comp = null, makeup = null, fadeGain = null, hooked = null, eqNodes = [], analyser = null, vizBuf = null, vizOut = null;
  const fxWanted = () => fx.fade > 0 || fx.level || fx.eqOn || fx.viz;
  function audioRoute() {
    if (!srcNode) return;
    try { srcNode.disconnect(); comp.disconnect(); makeup.disconnect(); fadeGain.disconnect(); eqNodes.forEach((n) => n.disconnect()); } catch (e) {}
    let node = srcNode;
    if (fx.eqOn && eqNodes.length) {
      eqNodes.forEach((n, i) => { n.gain.value = Math.max(-12, Math.min(12, Number(fx.eq[i]) || 0)); node.connect(n); node = n; });
    }
    if (fx.level) { node.connect(comp); comp.connect(makeup); node = makeup; }
    node.connect(fadeGain);
    fadeGain.connect(actx.destination);
    // visualizer: listens in on the final signal (doesn't change the sound)
    if (analyser) { try { fadeGain.connect(analyser); } catch (e) {} }
  }
  function hookAudio() {
    const v = video();
    if (!v || hooked === v) return !!hooked;
    if (!fxWanted()) return false;
    if (!String(v.currentSrc || v.src || '').startsWith('blob:')) return false;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      srcNode = actx.createMediaElementSource(v);
      comp = actx.createDynamicsCompressor();
      comp.threshold.value = -26; comp.knee.value = 24; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.3;
      makeup = actx.createGain(); makeup.gain.value = 1.35;
      fadeGain = actx.createGain();
      analyser = actx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.78;
      vizBuf = new Uint8Array(analyser.frequencyBinCount);
      eqNodes = EQ_FREQ.map((f, i) => {
        const b = actx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === EQ_FREQ.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0;
        return b;
      });
      hooked = v;
      audioRoute();
      return true;
    } catch (e) { return false; }
  }
  document.addEventListener('pointerdown', () => { if (actx && actx.state === 'suspended') actx.resume(); }, true);
  setInterval(() => {
    const v = video();
    if (!v) return;
    if (fxWanted()) hookAudio();
    if (actx && actx.state === 'suspended' && !v.paused) actx.resume().catch(() => {});
    if (!fadeGain || hooked !== v) return;
    let f = 1;
    const d = isFinite(v.duration) ? v.duration : 0, t = v.currentTime;
    if (fx.fade > 0 && d > fx.fade * 3 && !(player() && player().classList.contains('ad-showing'))) {
      if (t < fx.fade) f = Math.max(0.02, t / fx.fade);
      else if (d - t < fx.fade) f = Math.max(0.02, (d - t) / fx.fade);
    }
    fadeGain.gain.setTargetAtTime(f, actx.currentTime, 0.08);
  }, 100);

  // ---- YouTube Music's own lyrics (untimed), used when no synced lyrics are found ----
  async function lyricsYT(videoId) {
    const next = await innertube('next', { videoId });
    let browseId = '';
    const walk = (o) => {
      if (!o || typeof o !== 'object' || browseId) return;
      const b = o.browseEndpoint;
      if (b && typeof b.browseId === 'string' && b.browseId.startsWith('MPLY')) { browseId = b.browseId; return; }
      for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
    };
    walk(next);
    if (!browseId) return null;
    const res = await innertube('browse', { browseId });
    let found = null;
    const walk2 = (o) => {
      if (!o || typeof o !== 'object' || found) return;
      const d = o.musicDescriptionShelfRenderer;
      if (d) { found = { plain: runs(d.description), credit: runs(d.footer), source: 'YouTube Music' }; return; }
      for (const k in o) if (o[k] && typeof o[k] === 'object') walk2(o[k]);
    };
    walk2(res);
    return found && found.plain ? found : null;
  }

  let volSet = { v: -1, at: 0 }, volFix = 0;
  // A queue entry's picture. YouTube Music only loads the pictures of entries that have been on
  // screen (the rest are a blank placeholder), so read the address from the entry's data instead.
  function itemArt(el) {
    const img = $('img', el);
    if (img && img.src && !img.src.startsWith('data:')) return img.src.replace(/(i\.ytimg\.com\/vi\/[\w-]+\/)(default|hqdefault|sddefault)\.jpg/, '$1mqdefault.jpg');
    let d = null;
    try { d = el.data || (el.__data && el.__data.data) || null; } catch (e) {}
    if (d && d.playlistPanelVideoRenderer) d = d.playlistPanelVideoRenderer;
    const th = d && d.thumbnail && d.thumbnail.thumbnails;
    if (th && th.length) {
      const u = th[th.length - 1].url || '';
      // videos: the 16:9 picture without black bars (cropped to a square on screen)
      if (u && !u.startsWith('data:')) return (u.startsWith('//') ? 'https:' + u : u).replace(/=w\d+-h\d+[^&?#]*/, '=w120-h120-l90-rj').replace(/(i\.ytimg\.com\/vi\/[\w-]+\/)(default|hqdefault|sddefault)\.jpg/, '$1mqdefault.jpg');
    }
    const id = d && d.videoId;
    return id && /^[\w-]{6,20}$/.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '';
  }

  const queueItems = () => Array.from(new Set($$('ytmusic-player-queue ytmusic-player-queue-item, #queue ytmusic-player-queue-item')));

  const api = {
    v: 7,
    state() {
      const v = video(), b = bar(), p = player();
      const md = navigator.mediaSession && navigator.mediaSession.metadata;
      const title = (md && md.title) || text($('.title', b));
      const byline = text($('.byline', b));
      const artist = (md && md.artist) || byline.split('•')[0].trim();
      const album = (md && md.album) || '';
      let art = '';
      if (md && md.artwork && md.artwork.length) art = md.artwork[md.artwork.length - 1].src;
      if (art && art.startsWith('data:image/gif')) art = ''; // YouTube's blank placeholder
      if (!art) { const img = $('.image', b) || $('img', $('.thumbnail-image-wrapper', b)); art = img && img.src && !img.src.startsWith('data:image/gif') ? img.src : ''; }
      // videos (and tracks whose picture hasn't loaded yet): YouTube's own thumbnail for the video
      if (!art && p && p.getVideoData) { const id = (p.getVideoData() || {}).video_id; if (id && /^[\w-]{6,20}$/.test(id)) art = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; }
      // artist: a channel link (or a browse link that isn't an album); album: a browse/MPRE… link
      const bylineLinks = b ? Array.from(b.querySelectorAll('.byline a[href]')) : [];
      const artistLink = bylineLinks.find((x) => /channel\//.test(x.getAttribute('href'))) || bylineLinks.find((x) => /browse\/(?!MPRE)/.test(x.getAttribute('href')));
      const albumLink = bylineLinks.find((x) => /browse\/MPRE/.test(x.getAttribute('href')));
      let artistId = '', albumId = '';
      if (artistLink) { const m = artistLink.getAttribute('href').match(/(?:channel|browse)\/([\w-]+)/); if (m) artistId = m[1]; }
      if (albumLink) { const m = albumLink.getAttribute('href').match(/browse\/([\w-]+)/); if (m) albumId = m[1]; }
      const dur = v && isFinite(v.duration) ? v.duration : 0;
      let repeat = 'NONE';
      if (b) repeat = b.repeatMode_ || b.repeatMode || b.getAttribute('repeat-mode_') || b.getAttribute('repeat-mode') || 'NONE';
      const layout = $('ytmusic-app-layout');
      const uiState = (layout && (layout.getAttribute('player-ui-state') || layout.getAttribute('player-ui-state_') || layout.playerUiState_ || layout.playerUiState)) || '';
      const ppOpen = !!(layout && (layout.hasAttribute('player-page-open') || layout.playerPageOpen_ || /PLAYER_PAGE_OPEN|FULLSCREEN/.test(String(uiState))));
      document.documentElement.classList.toggle('res-pp', ppOpen); // page.css: YouTube's floating mini player stays hidden otherwise
      const avatar = $('ytmusic-settings-button img') || $('#avatar img');
      return {
        hasTrack: !!(title && v && (v.src || v.currentSrc)),
        title, artist, album, art: bigArt(art), artistId, albumId,
        playing: !!(v && !v.paused && !v.ended),
        time: v ? v.currentTime : 0,
        duration: dur,
        // right after a change, report the value that was asked for (the player can lag a moment)
        volume: Date.now() - volSet.at < 1500 ? volSet.v : p && p.getVolume ? p.getVolume() : Math.round(((v && v.volume) || 1) * 100),
        muted: p && p.isMuted ? p.isMuted() : !!(v && v.muted),
        like: likeStatus(b),
        repeat: String(repeat).toUpperCase(),
        playerPageOpen: ppOpen,
        url: location.href,
        avatar: avatar && avatar.src && !/data:image\/gif/.test(avatar.src) ? avatar.src : '',
        signedOutUI: !!$('a.sign-in-link, ytmusic-nav-bar a[href*="ServiceLogin"]'),
        av: (() => {
          // YouTube Music's own Song/Video switch, if it exists for this track
          const t = $('ytmusic-av-toggle');
          const native = !!(t && !t.hasAttribute('toggle-disabled') && !t.hidden && $('.video-button, .song-button', t));
          const pl = $('ytmusic-player');
          const pm = (pl && pl.getAttribute('playback-mode')) || (t && t.getAttribute('playback-mode')) || '';
          let mode = /OMV/.test(pm) ? 'video' : /ATV/.test(pm) ? 'song' : '';
          if (document.documentElement.classList.contains('res-cover')) mode = 'song';
          else if (!mode) mode = 'video';
          return { available: true, native, mode };
        })(),
        _cover: syncCoverOverlay(bigArt(art)),
        shuffle: shuffleOn,
        inPlaylist: (() => { const ses = currentSession(); return !!(ses && ses.playlistId); })(),
        videoId: (() => { try { return (p && p.getVideoData && (p.getVideoData() || {}).video_id) || ''; } catch (e) { return ''; } })(),
        adsBlocked: window.__resAdblock ? window.__resAdblock.blocked + window.__resAdblock.skipped : 0,
        ad: !!(p && p.classList && p.classList.contains('ad-showing')),
      };
    },

    cmd(name, arg) {
      const b = bar(), v = video(), p = player();
      switch (name) {
        case 'toggle':
          if (!(v && (v.src || v.currentSrc))) {
            // nothing loaded yet (fresh start): resume the last song, or do nothing at all
            resume(loadLast());
            break;
          }
          if (!clickFirst(['#play-pause-button', '.play-pause-button'], b) && v) v.paused ? v.play() : v.pause();
          break;
        case 'play': if (v && v.paused) api.cmd('toggle'); break;
        case 'pause': if (v && !v.paused) api.cmd('toggle'); break;
        case 'next': if (!clickFirst(['.next-button'], b) && p && p.nextVideo) p.nextVideo(); break;
        case 'prev': if (!clickFirst(['.previous-button'], b) && p && p.previousVideo) p.previousVideo(); break;
        case 'seek':
          if (p && p.seekTo) p.seekTo(arg, true); else if (v) v.currentTime = arg;
          break;
        case 'volume': {
          const vol = Math.max(0, Math.min(100, Math.round(Number(arg) || 0)));
          volSet = { v: vol, at: Date.now() };
          // YouTube Music's own (hidden) slider first, so its listeners can't push an old value
          // back into the player afterwards…
          const slider = $('#volume-slider', b);
          if (slider) {
            try { slider.value = vol; slider.immediateValue = vol; } catch (e) {}
            slider.dispatchEvent(new CustomEvent('immediate-value-change', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
          }
          // …then the player itself, which is what actually sets the loudness.
          const apply = () => {
            if (p && p.setVolume) { p.setVolume(vol); if (vol > 0 && p.isMuted && p.isMuted()) p.unMute(); }
            if (v) { if (!(p && p.setVolume)) v.volume = vol / 100; if (vol > 0 && v.muted) v.muted = false; }
          };
          apply();
          try { localStorage.setItem('yt-player-volume', JSON.stringify({ data: JSON.stringify({ volume: vol, muted: false }), expiration: Date.now() + 2592e6, creation: Date.now() })); } catch {}
          // if anything put the old value back, set it again
          clearTimeout(volFix);
          volFix = setTimeout(() => { const cur = p && p.getVolume ? p.getVolume() : v ? Math.round(v.volume * 100) : vol; if (Math.abs(cur - vol) > 1) apply(); }, 300);
          break;
        }
        case 'mute':
          if (p && p.isMuted) { p.isMuted() ? p.unMute() : p.mute(); } else if (v) v.muted = !v.muted;
          break;
        case 'like': clickFirst(['ytmusic-like-button-renderer #button-shape-like button', 'ytmusic-like-button-renderer .like', 'ytmusic-like-button-renderer [aria-label*="Like" i]'], b); break;
        case 'dislike': clickFirst(['ytmusic-like-button-renderer #button-shape-dislike button', 'ytmusic-like-button-renderer .dislike'], b); break;
        case 'shuffle': setShuffle(arg == null ? !shuffleOn : !!arg); break;
        case 'shuffleOnce': shuffleQueue(); break;
        case 'repeat': clickFirst(['.repeat', 'yt-icon-button.repeat', '[aria-label*="Repeat" i]'], b); break;
        case 'av': {
          const want = arg === 'video' ? 'video' : 'song';
          const t = $('ytmusic-av-toggle');
          let clicked = false;
          if (t && !t.hasAttribute('toggle-disabled')) {
            clicked = clickFirst([want === 'video' ? '.video-button' : '.song-button'], t);
            if (!clicked) {
              const btn = $$('button, tp-yt-paper-button, yt-formatted-string', t).find((x) => new RegExp(want, 'i').test(x.textContent || ''));
              if (btn) { btn.click(); clicked = true; }
            }
          }
          // Fallback (and for tracks without YouTube's switch): hide the video and show the cover art.
          document.documentElement.classList.toggle('res-cover', want === 'song' && !clicked);
          if (want === 'video') document.documentElement.classList.remove('res-cover');
          break;
        }
        case 'resume': resume(arg || loadLast()); break;
        case 'volUp': case 'volDown': {
          const cur = Date.now() - volSet.at < 1500 ? volSet.v : p && p.getVolume ? p.getVolume() : Math.round(((v && v.volume) || 0.5) * 100);
          api.cmd('volume', cur + (name === 'volUp' ? 5 : -5));
          break;
        }
        case 'seekPct': { const d = v && isFinite(v.duration) ? v.duration : 0; if (d) api.cmd('seek', Math.max(0, Math.min(1, Number(arg) || 0)) * d); break; }
        case 'playerPage': clickFirst(['.toggle-player-page-button', '.middle-controls', '.content-info-wrapper'], b); break;
        case 'closePlayerPage': {
          const layout = $('ytmusic-app-layout');
          if (layout && (layout.hasAttribute('player-page-open') || layout.playerPageOpen_)) clickFirst(['.toggle-player-page-button'], b);
          break;
        }
      }
      return true;
    },

    nav(where) {
      api.cmd('closePlayerPage');
      if (typeof where === 'string' && BROWSE[where]) return navTo(BROWSE[where], where === 'home' ? '/' : '/' + where);
      if (where && where.browseId) {
        const id = where.browseId;
        const path = id.startsWith('VL') ? '/playlist?list=' + id.slice(2) : id.startsWith('UC') ? '/channel/' + id : '/browse/' + id;
        return navTo(id, path);
      }
    },

    search(q) {
      api.cmd('closePlayerPage');
      const before = location.href;
      const sb = $('ytmusic-search-box');
      const input = sb && $('input', sb);
      if (input) {
        try { if ('opened' in sb) sb.opened = true; } catch {}
        input.focus();
        input.value = q;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.blur();
      } else {
        ytNavigate({ searchEndpoint: { query: q } });
      }
      setTimeout(() => {
        if (location.href !== before) return;
        const v = video();
        if (v && !v.paused) ytNavigate({ searchEndpoint: { query: q } });
        else location.assign('/search?q=' + encodeURIComponent(q));
      }, 2500);
    },

    async playlists() {
      const now = Date.now();
      if (!libCache || now - libCache.at > 300000) {
        try { const l = await fetchLibraryPlaylists(); if (l && l.length) libCache = { at: now, list: l }; } catch (e) {}
      }
      const lib = (libCache && libCache.list) || [];
      const byId = new Map(lib.map((p) => [p.id, p]));
      const out = [], seen = new Set();
      for (const g of guideEntries()) {
        if (!g.id || !g.id.startsWith('VL') || seen.has(g.id)) continue;
        seen.add(g.id);
        const l = byId.get(g.id);
        out.push({ id: g.id, title: g.title || (l && l.title) || '', subtitle: g.subtitle || (l && l.subtitle) || '', thumb: (l && l.thumb) || '' });
      }
      for (const l of lib) if (!seen.has(l.id)) { seen.add(l.id); out.push(l); }
      return out;
    },

    queue() {
      return queueItems().slice(0, 80).map((el, i) => {
        return {
          i,
          title: text($('.song-title', el)),
          artist: text($('.byline', el)),
          duration: text($('.duration', el)),
          art: itemArt(el),
          current: el.hasAttribute('selected') || ['playing', 'paused'].includes(el.getAttribute('play-button-state')),
        };
      });
    },

    playQueue(i) {
      const el = queueItems()[i];
      if (!el) return;
      const btn = $('ytmusic-play-button-renderer', el) || $('.song-info', el) || el;
      btn.click();
    },

    setFx(o) { Object.assign(fx, o || {}); try { localStorage.setItem('res-fx', JSON.stringify(fx)); } catch (e) {} if (fxWanted()) hookAudio(); audioRoute(); },
    fxState() { return { fade: fx.fade, level: fx.level, eqOn: fx.eqOn, eq: fx.eq.slice(), viz: !!fx.viz, active: !!hooked }; },

    // ---- pop-out video (picture in picture) ----
    async pip() {
      const v = video();
      if (!v) return 'none';
      try {
        if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'off'; }
        if (!document.pictureInPictureEnabled) return 'unsupported';
        v.removeAttribute('disablepictureinpicture'); v.disablePictureInPicture = false;
        await v.requestPictureInPicture();
        return 'on';
      } catch (e) { return 'error: ' + e.message; }
    },
    pipActive() { return !!document.pictureInPictureElement; },

    // ---- queue actions through YouTube Music's own queue menus ----
    async queueAction(i, action) {
      const el = queueItems()[i];
      if (!el) return false;
      const btn = $('ytmusic-menu-renderer yt-button-shape button, ytmusic-menu-renderer #button, ytmusic-menu-renderer yt-icon-button, ytmusic-menu-renderer button', el);
      if (!btn) return false;
      btn.click();
      const re = action === 'next' ? /play next|odtwórz jako następn|als nächstes|reproducir a continuación|lire ensuite/i : /remove from queue|usuń z kolejki|aus der warteschlange|quitar de la cola|retirer de la file/i;
      for (let k = 0; k < 15; k++) {
        await new Promise((r) => setTimeout(r, 80));
        const items = $$('ytmusic-menu-popup-renderer ytmusic-menu-service-item-renderer, ytmusic-menu-popup-renderer ytmusic-menu-navigation-item-renderer, tp-yt-paper-listbox [role=menuitem]');
        const hit = items.find((x) => re.test(text(x)));
        if (hit) { hit.click(); return true; }
      }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return false;
    },
    // Move a queue song: tries YouTube Music's own drag handle, then checks whether it worked.
    async moveQueue(from, to) {
      const items = queueItems();
      const a = items[from], b = items[to];
      if (!a || !b || from === to) return false;
      const before = items.map((x) => text($('.song-title', x)));
      const handle = $('#drag-handle, .drag-handle, [class*="drag"], ytmusic-thumbnail-renderer, .thumbnail', a) || a;
      const ra = handle.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const fire = (t, x, y, target) => {
        const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: t.endsWith('up') ? 0 : 1, pointerId: 1, isPrimary: true };
        (target || document).dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, o) : new MouseEvent(t, o));
      };
      const x0 = ra.left + ra.width / 2, y0 = ra.top + ra.height / 2;
      const y1 = rb.top + rb.height * (to > from ? 0.8 : 0.2);
      fire('pointerdown', x0, y0, handle); fire('mousedown', x0, y0, handle);
      for (let k = 1; k <= 10; k++) { const y = y0 + ((y1 - y0) * k) / 10; fire('pointermove', x0, y, document); fire('mousemove', x0, y, document); await new Promise((r) => setTimeout(r, 16)); }
      fire('pointerup', x0, y1, document); fire('mouseup', x0, y1, document);
      await new Promise((r) => setTimeout(r, 500));
      const after = queueItems().map((x) => text($('.song-title', x)));
      return after.join('|') !== before.join('|');
    },


    // ---- right-click menus: YouTube Music's own items for a song / album / playlist ----
    // where: an element in the page, 'current' (the playing song) or { queue: index }
    async songMenu(where) {
      let row = null;
      if (where === 'current') row = bar();
      else if (where && typeof where === 'object' && 'queue' in where) row = queueItems()[where.queue];
      else if (where && where.closest) row = where.closest(ROW_SEL);
      const menu = ownMenu(row);
      if (!menu) return null;
      let items = itemsFromData(menu);
      if (!items) {
        // no data on the element (YouTube changed something): read the menu itself
        const els = (await ghostMenu(menu)) || [];
        items = els.map((el) => ({ label: text($('yt-formatted-string, .text', el) || el), icon: '', kind: '', target: null }))
          .filter((x) => x.label && !SKIP_TEXT.test(x.label));
        const ids = findIds(dataOf(row));
        items.forEach((x) => { if (/playlist|playlist|playlisty|wiedergabeliste|lista/i.test(x.label) && /save|add|zapisz|dodaj|speichern|guardar|ajouter/i.test(x.label)) { x.kind = 'playlist'; x.target = ids.videoId ? { videoId: ids.videoId } : ids.playlistId ? { playlistId: ids.playlistId } : null; } });
      }
      const d = dataOf(row) || {};
      let title = '';
      if (where === 'current') { const md = navigator.mediaSession && navigator.mediaSession.metadata; title = (md && md.title) || text($('.title', row)); }
      else title = text($('.title, .song-title, yt-formatted-string.title', row)) || runs(d.title) || '';
      menuRef = { menu, row };
      const ids = {};
      [d.playlistItemData, d.navigationEndpoint, d.overlay, d.thumbnailOverlay, d.flexColumns, d].forEach((o) => {
        const f = findIds(o);
        if (!ids.videoId && f.videoId) ids.videoId = f.videoId;
        if (!ids.playlistId && f.playlistId) ids.playlistId = f.playlistId;
      });
      if (where === 'current') { try { ids.videoId = (player().getVideoData() || {}).video_id || ids.videoId; } catch (e) {} }
      return { title, items, ids };
    },
    async runMenu(label) {
      if (!menuRef || !menuRef.menu.isConnected) return false;
      const ok = await ghostMenu(menuRef.menu, (els) => {
        const hit = els.find((x) => text($('yt-formatted-string, .text', x) || x) === label) || els.find((x) => text(x).includes(label));
        if (!hit) return false;
        ($('a', hit) || $('tp-yt-paper-item', hit) || hit).click();
        return true;
      });
      if (!ok) closeDropdowns();
      return !!ok;
    },
    closeMenus() { closeDropdowns(); },
    // video ids of the songs in the queue, in order (for "Save queue as playlist")
    queueVideoIds() {
      const out = [];
      for (const el of queueItems()) { const id = findIds(dataOf(el)).videoId; if (id && !out.includes(id)) out.push(id); }
      return out;
    },
    // visualizer: n bar levels 0…1 (log-spaced, 40 Hz – 14 kHz), or null when audio isn't routed yet
    viz(n) {
      if (!analyser || !hooked || !actx) return null;
      analyser.getByteFrequencyData(vizBuf);
      if (!vizOut || vizOut.length !== n) vizOut = new Array(n);
      const out = vizOut, ny = actx.sampleRate / 2, len = vizBuf.length;
      for (let i = 0; i < n; i++) {
        const f0 = 40 * Math.pow(14000 / 40, i / n), f1 = 40 * Math.pow(14000 / 40, (i + 1) / n);
        const a = Math.max(0, Math.floor((f0 / ny) * len)), b = Math.min(len - 1, Math.max(a, Math.ceil((f1 / ny) * len)));
        let m = 0; for (let k = a; k <= b; k++) m = Math.max(m, vizBuf[k]);
        out[i] = m / 255;
      }
      return out;
    },

    // ---- save to playlist (Resonance's own picker, using YouTube Music's API) ----
    async addToPlaylistOptions(target) {
      if (!target) return null;
      const body = target.videoId ? { videoIds: [target.videoId] } : { playlistId: target.playlistId };
      let j = null;
      try { j = await innertube('playlist/get_add_to_playlist', Object.assign({ excludeWatchLater: true }, body)); } catch (e) {}
      if (!j) return null;
      const out = [];
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        const r = o.playlistAddToOptionRenderer;
        if (r && r.playlistId) { out.push({ id: r.playlistId, title: runs(r.title), has: r.containsSelectedVideos === 'ALL', privacy: r.privacy || '' }); return; }
        for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
      };
      walk(j);
      return out;
    },
    async editPlaylist(playlistId, target, add) {
      if (!target) return false;
      const action = target.videoId
        ? (add ? { action: 'ACTION_ADD_VIDEO', addedVideoId: target.videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' } : { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: target.videoId })
        : { action: 'ACTION_ADD_PLAYLIST', addedFullListId: target.playlistId };
      let j = null;
      try { j = await innertube('browse/edit_playlist', { playlistId: String(playlistId).replace(/^VL/, ''), actions: [action] }); } catch (e) {}
      libCache = null;
      return !!(j && (j.status === 'STATUS_SUCCEEDED' || j.playlistEditResults || j.actions));
    },
    async createPlaylist(title, target) {
      const body = { title: String(title).slice(0, 150), privacyStatus: 'PRIVATE' };
      if (target && Array.isArray(target.videoIds)) body.videoIds = target.videoIds.slice(0, 500);
      else if (target && target.videoId) body.videoIds = [target.videoId];
      else if (target && target.playlistId) body.sourcePlaylistId = target.playlistId;
      let j = null;
      try { j = await innertube('playlist/create', body); } catch (e) {}
      libCache = null;
      return (j && j.playlistId) || null;
    },

    // ---- health check: which connections to YouTube Music still work ----
    async diagnostics() {
      const b = bar(), p = player(), v = video();
      const md = navigator.mediaSession && navigator.mediaSession.metadata;
      const out = [];
      const add = (group, name, ok, detail) => out.push({ group, name, ok: ok === null ? null : !!ok, detail: detail || '' });
      add('Player', 'Player bridge', true, 'v' + api.v);
      add('Player', 'YouTube player', !!p, p ? (p.getVideoData ? 'API available' : 'found, but no API') : 'not found');
      add('Player', 'Audio / video element', !!v, v ? (String(v.currentSrc || '').startsWith('blob:') ? 'streaming (MediaSource)' : v.currentSrc ? 'playing a direct file' : 'idle') : 'not found');
      add('Player', 'Song info (title / artist / cover)', !!(md && md.title), md && md.title ? md.title + ' — ' + md.artist : 'nothing playing yet');
      add('Controls', 'Hidden player bar', !!b, b ? '' : 'not found — controls fall back to the player API');
      add('Controls', 'Play / pause', !!$('#play-pause-button, .play-pause-button', b) || !!v);
      add('Controls', 'Next / previous', !!($('.next-button', b) && $('.previous-button', b)) || !!(p && p.nextVideo));
      add('Controls', 'Like button', !!$('ytmusic-like-button-renderer', b));
      add('Controls', 'Shuffle', !!$('.shuffle, [aria-label*="Shuffle" i]', b));
      add('Controls', 'Repeat', !!$('.repeat, [aria-label*="Repeat" i]', b));
      add('Controls', 'Volume', !!(p && p.setVolume) || !!v);
      add('Controls', 'Cover / Video switch', $('ytmusic-av-toggle') ? true : null, $('ytmusic-av-toggle') ? "YouTube's own switch" : 'not on this song — Resonance draws the cover itself');
      const q = queueItems();
      add('Queue & pages', 'Queue', !!$('ytmusic-player-queue'), q.length + ' songs');
      add('Queue & pages', 'Full player page', !!$('ytmusic-player-page'));
      add('Queue & pages', 'Sidebar playlists (from the page)', guideEntries().length > 0 ? true : null, guideEntries().length + ' found');
      try { const lib = await fetchLibraryPlaylists(); add('Account', 'Library playlists with covers', !!(lib && lib.length), lib ? lib.length + ' playlists' : 'no answer'); } catch (e) { add('Account', 'Library playlists with covers', false, e.message); }
      try { const a = await fetchAccount(); add('Account', 'Account name & picture', !!a, a ? a.name : 'not signed in or no answer'); } catch (e) { add('Account', 'Account name & picture', false, e.message); }
      const ab = window.__resAdblock;
      add('Extras', 'Ad blocker', ab ? (ab.enabled ? true : null) : false, ab ? (ab.enabled ? (ab.blocked + ab.skipped) + ' ad items blocked this session' : 'turned off') : 'not loaded');
      add('Extras', 'Audio effects (crossfade / leveling / EQ)', fxWanted() ? !!hooked : null, fxWanted() ? (hooked ? 'active' : 'waiting for playback') : 'all off');
      add('Extras', 'Pop-out video', document.pictureInPictureEnabled ? true : null, document.pictureInPictureEnabled ? 'supported' : 'not supported by this WebView2');
      const m = navigator.userAgent.match(/Edg\/([\d.]+)/);
      add('System', 'WebView2', true, m ? 'version ' + m[1] : navigator.userAgent.slice(0, 60));
      return out;
    },
    async lyricsYT(videoId) { try { return await lyricsYT(videoId); } catch (e) { return null; } },
    async account() {
      if (acctCache && Date.now() - acctCache.at < 600000) return acctCache.data;
      try { const a = await fetchAccount(); if (a) acctCache = { at: Date.now(), data: a }; return a; } catch (e) { return null; }
    },
    fit() { try { fit(); } catch (e) {} },
    last: loadLast,
    setTint(rgb) {
      document.documentElement.style.setProperty('--res-tint', rgb ? rgb.join(',') : '40,40,48');
    },
  };

  window.__res = api;

  // Page backdrops only appear when YouTube Music changes page, so check often right after a
  // navigation and rarely otherwise (each check measures the page, which isn't free).
  let lastNav = Date.now(), bdTick = 0;
  setInterval(() => {
    if (document.hidden) return;
    bdTick++;
    if (Date.now() - lastNav > 10000 && bdTick % 5) return;
    try { clearBackdrops(); } catch (e) {}
  }, 1200);
  window.addEventListener('yt-navigate-finish', () => { lastNav = Date.now(); setTimeout(clearBackdrops, 200); });
  window.addEventListener('resize', () => { lastNav = Date.now(); });

  // Quietly dismiss the "Video paused. Continue watching?" prompt.
  setInterval(() => {
    const yt = $('ytmusic-you-there-renderer');
    if (yt && yt.offsetParent !== null) clickFirst(['button', 'yt-button-renderer'], yt);
  }, 3000);
})();
