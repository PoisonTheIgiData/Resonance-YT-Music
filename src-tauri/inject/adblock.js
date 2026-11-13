// Resonance ad blocker — runs at document start on music.youtube.com, before YouTube's own scripts.
// 1) strips ad data out of player responses, 2) blocks ad/ad-tracking requests,
// 3) as a fallback, fast-forwards and skips any ad that still starts playing.
(() => {
  if (location.hostname !== 'music.youtube.com' || window.__resAdblock) return;
  let enabled = true;
  try { enabled = (JSON.parse(localStorage.getItem('res-settings') || '{}').adblock) !== false; } catch (e) {}
  const stats = (window.__resAdblock = { enabled, blocked: 0, skipped: 0 });
  if (!enabled) return;

  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams', 'adBreakParams'];
  function prune(o, depth) {
    if (!o || typeof o !== 'object' || (depth || 0) > 4) return o;
    if (Array.isArray(o)) { for (const x of o) prune(x, (depth || 0) + 1); return o; }
    let hit = false;
    for (const k of AD_KEYS) if (k in o) { try { delete o[k]; hit = true; } catch (e) {} }
    if (hit) stats.blocked++;
    if (o.playerResponse) prune(o.playerResponse, (depth || 0) + 1);
    if (o.response) prune(o.response, (depth || 0) + 1);
    return o;
  }
  const looksLikePlayer = (r) => r && typeof r === 'object' && (r.adPlacements || r.playerAds || r.adSlots || r.playerResponse || r.streamingData);

  // JSON.parse (XHR / text responses)
  const origParse = JSON.parse;
  JSON.parse = function () {
    const r = origParse.apply(this, arguments);
    try { if (looksLikePlayer(r) || Array.isArray(r)) prune(r); } catch (e) {}
    return r;
  };
  // fetch().json()
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    return origJson.call(this).then((r) => { try { if (looksLikePlayer(r)) prune(r); } catch (e) {} return r; });
  };
  // Initial player response embedded in the page
  for (const name of ['ytInitialPlayerResponse', 'playerResponse']) {
    let v;
    try {
      Object.defineProperty(window, name, { configurable: true, get: () => v, set: (x) => { v = prune(x); } });
    } catch (e) {}
  }

  // Block ad + ad-tracking requests
  const AD_URL = /(doubleclick\.net|googlesyndication\.com|googleadservices\.com|google\.com\/pagead|youtube\.com\/pagead|\/api\/stats\/ads|\/ptracking|\/get_midroll_|\/youtubei\/v1\/player\/ad_break|imasdk\.googleapis\.com)/;
  const origFetch = window.fetch;
  window.fetch = function (input) {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    if (AD_URL.test(u)) {
      stats.blocked++;
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return origFetch.apply(this, arguments);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (AD_URL.test(String(url))) { stats.blocked++; arguments[1] = 'data:application/json,{}'; }
    return origOpen.apply(this, arguments);
  };
  if (navigator.sendBeacon) {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (u, d) => (AD_URL.test(String(u)) ? true : origBeacon(u, d));
  }

  // Hide ad UI
  const css = document.createElement('style');
  css.textContent = `.ytp-ad-module,.ytp-ad-overlay-container,.ytp-ad-image-overlay,.ytp-ad-text-overlay,.video-ads,#player-ads,
    ytmusic-mealbar-promo-renderer,ytmusic-statement-banner-renderer,ytmusic-brand-video-singleton-renderer,
    ytmusic-promoted-sparkles-web-renderer{display:none!important}`;
  const addCss = () => (document.head || document.documentElement).appendChild(css);
  if (document.documentElement) addCss();
  else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); addCss(); } }).observe(document, { childList: true });

  // Fallback: if an ad still plays, mute it, fast-forward and press "Skip".
  let inAd = false, wasMuted = false;
  setInterval(() => {
    const p = document.getElementById('movie_player');
    if (!p) return;
    const v = p.querySelector('video');
    const ad = p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting');
    if (ad) {
      if (!inAd) { inAd = true; wasMuted = v ? v.muted : false; stats.skipped++; }
      document.querySelectorAll('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button')
        .forEach((b) => b.click());
      if (v) {
        v.muted = true;
        try { v.playbackRate = 16; } catch (e) {}
        if (isFinite(v.duration) && v.duration > 0) v.currentTime = Math.max(0, v.duration - 0.05);
      }
    } else if (inAd) {
      inAd = false;
      if (v) { v.muted = wasMuted; try { v.playbackRate = 1; } catch (e) {} }
    }
  }, 250);
})();
