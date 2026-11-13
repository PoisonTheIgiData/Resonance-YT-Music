// Resonance UI — injected into every page. On music.youtube.com it draws the whole app
// (title bar, sidebar, player bar, now-playing panel, login screen) in a Shadow DOM around
// YouTube Music. On Google sign-in / consent pages it only draws a slim title bar.
(() => {
  if (window.top !== window || window.__resUI) return;
  window.__resUI = true;

  // Grab native DOM functions before YouTube's scripts (Polymer / ShadyDOM) can patch them.
  const NATIVE = {
    attachShadow: Element.prototype.attachShadow,
    appendChild: Node.prototype.appendChild,
    createElement: Document.prototype.createElement,
  };
  const ERR = (window.__resErrors = window.__resErrors || []);
  const IS_YTM = location.hostname === 'music.youtube.com';
  const YTM = 'https://music.youtube.com/';
  const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=' +
    encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=' + encodeURIComponent(YTM));

  const invoke = (cmd, args) => {
    const t = window.__TAURI_INTERNALS__;
    return t && t.invoke ? t.invoke(cmd, args || {}) : Promise.reject(new Error('Tauri IPC unavailable'));
  };
  const win = (action) => invoke('res_win', { action }).then((m) => { setMaxIcon(m); return m; }).catch(() => {});

  // ---------- settings (stored in YouTube Music's localStorage) ----------
  const S = { dynamicColor: true, closeToTray: false, adblock: true, npOpen: false, sidebarCollapsed: false, avMode: '', taskbarWidget: false, widgetLayouts: [], widgetLayoutId: 'classic' };
  Object.assign(S, {
    colorMode: 'song', customColor: '#ff486c', accentMode: 'brand', glow: 100, corners: 'normal', plCovers: true,
    pb_shuffle: true, pb_repeat: true, pb_like: true, pb_av: true, pb_full: true, pb_queue: true, pb_volume: true,
    timeMode: 'elapsed', startPage: 'home', showResume: true,
    pb_sleep: true, pb_pip: true, pb_fs: true, pb_remote: true, theme: 'dark', sleepFade: true, notify: false, lyrTranslate: false, lyrLang: 'en',
    sb: { items: [] }, devices: true,
    vizStyle: 'bars', vizStrength: 35,
    autoPause: true, autoResume: false, lowBattery: true, eqPerOutput: false, eqByOut: {}, karaoke: 'auto', viz: 'off', uiScale: 1,
    overlay: false, overlayCorner: 'bottom-right', overlayAlways: false, lyrRoman: false, remote: false, lastVersion: '',
    themes: [], themeId: '', themeCustom: { bg: '#07070a', panel: '#121216', accent: '#ff486c' },
    autoUpdate: false, updateRepo: '', lastUpdateCheck: 0,
    discord: false, discordId: '',
    hotkeys: { palette: 'Control+Alt+KeyK', toggle: 'Control+Alt+Space', next: 'Control+Alt+ArrowRight', prev: 'Control+Alt+ArrowLeft', volUp: 'Control+Alt+ArrowUp', volDown: 'Control+Alt+ArrowDown', like: '', shuffle: '', mute: '', show: 'Control+Alt+KeyM' },
  });
  try { Object.assign(S, JSON.parse(localStorage.getItem('res-settings') || '{}')); } catch (e) {}
  if (S.hotkeys && !('palette' in S.hotkeys)) S.hotkeys.palette = 'Control+Alt+KeyK';
  if (S.dynamicColor === false && !S.colorModeMigrated) { S.colorMode = 'custom'; S.customColor = '#46326e'; }
  S.colorModeMigrated = true;
  const saveS = () => { try { localStorage.setItem('res-settings', JSON.stringify(S)); } catch (e) {} };
  // Official releases: Resonance only ever checks this repository for updates.
  const UPDATE_REPO = 'PoisonTheIgiData/Ressonance-YT-Music';
  S.updateRepo = UPDATE_REPO;
  const RW = () => window.ResWidget;
  const allLayouts = () => (RW() ? RW().PRESETS : []).concat(S.widgetLayouts || []);
  const activeLayout = () => allLayouts().find((l) => l.id === S.widgetLayoutId) || (RW() ? RW().PRESETS[0] : {});
  const sendLayout = () => invoke('res_set_widget_layout', { layout: activeLayout() }).catch(() => {});
  if (IS_YTM) {
    invoke('res_set_close_to_tray', { value: !!S.closeToTray }).catch(() => {});
    invoke('res_set_widget', { value: !!S.taskbarWidget }).catch(() => {});
    invoke('res_set_overlay', { enabled: !!S.overlay, corner: S.overlayCorner || 'bottom-right', always: !!S.overlayAlways }).catch(() => {});
    sendLayout();
  }

  // ---------- problem log (Settings → Health check → Recent problems) ----------
  const LOG = [];
  const logAdd = (src, msg) => {
    msg = String(msg || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!msg) return;
    const last = LOG[LOG.length - 1];
    if (last && last.msg === msg) { last.n++; last.at = Date.now(); return; }
    LOG.push({ at: Date.now(), src, msg, n: 1 });
    if (LOG.length > 150) LOG.shift();
  };
  window.__resLog = (m) => logAdd('Resonance', m);
  if (IS_YTM) {
    window.addEventListener('error', (e) => { if (e && e.message) logAdd('YouTube page', e.message + (e.filename ? ' (' + String(e.filename).split('/').pop().slice(0, 40) + ':' + e.lineno + ')' : '')); }, true);
    window.addEventListener('unhandledrejection', (e) => { const r = e && e.reason; logAdd('YouTube page', 'Unhandled: ' + ((r && (r.message || r)) || 'unknown')); });
    const ce = console.error;
    console.error = function (...a) {
      try {
        const txt = a.map((x) => (x && x.stack ? String(x.stack).split('\n').slice(0, 2).join(' ') : typeof x === 'string' ? x : String(x))).join(' ');
        if (/\[resonance\]/i.test(txt)) logAdd('Resonance', txt.replace(/\[resonance\]\s*/i, ''));
      } catch (x) {}
      return ce.apply(this, a);
    };
  }

  // ---------- right-click: registered at document start so it runs before YouTube Music's own
  // handlers; the menu itself is built once the UI exists (onCtx).
  let onCtx = null;
  if (IS_YTM) {
    window.addEventListener('contextmenu', (e) => {
      if (onCtx) return onCtx(e);
      const t = e.composedPath()[0];
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }

  // ---------- page CSS (as early as possible, before YouTube Music paints) ----------
  const pageStyle = document.createElement('style');
  pageStyle.textContent = IS_YTM ? (window.__RES_PAGE_CSS__ || '') : 'html{padding-top:44px!important;box-sizing:border-box!important}';
  const addPageStyle = () => (document.head || document.documentElement).appendChild(pageStyle);
  if (document.documentElement) addPageStyle();
  else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); addPageStyle(); } }).observe(document, { childList: true });

  // ---------- icons ----------
  const P = {
    home: 'M12 3.2 2.5 11.1l1.3 1.5L5 11.6V20a1 1 0 0 0 1 1h4.5v-6h3v6H18a1 1 0 0 0 1-1v-8.4l1.2 1 1.3-1.5z',
    explore: 'M12 10.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zM12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z',
    library: 'M20 2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 5h-3v5.5a2.5 2.5 0 1 1-2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6z',
    search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    back: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    fwd: 'M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z',
    play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.5-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
    pause: 'M7.2 5h2.6A1.2 1.2 0 0 1 11 6.2v11.6a1.2 1.2 0 0 1-1.2 1.2H7.2A1.2 1.2 0 0 1 6 17.8V6.2A1.2 1.2 0 0 1 7.2 5zm7 0h2.6A1.2 1.2 0 0 1 18 6.2v11.6a1.2 1.2 0 0 1-1.2 1.2h-2.6a1.2 1.2 0 0 1-1.2-1.2V6.2A1.2 1.2 0 0 1 14.2 5z',
    next: 'M5.5 6.6v10.8a1 1 0 0 0 1.55.83l7.6-5.4a1 1 0 0 0 0-1.66l-7.6-5.4a1 1 0 0 0-1.55.83zM16.5 6h2v12h-2z',
    prev: 'M18.5 6.6v10.8a1 1 0 0 1-1.55.83l-7.6-5.4a1 1 0 0 1 0-1.66l7.6-5.4a1 1 0 0 1 1.55.83zM5.5 6h2v12h-2z',
    shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
    repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
    repeatOne: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
    heart: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
    heartFill: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
    volLow: 'M18.5 12A4.5 4.5 0 0 0 16 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z',
    volOff: 'M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z',
    queue: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18A3 3 0 1 0 19 17V8h3V6h-5z',
    expand: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    collapse: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
    gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
    logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4V5z',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
    note: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
    refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    shield: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
    sparkle: 'M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7zM19 15l1 2.7 2.7 1-2.7 1L19 22.4l-1-2.7-2.7-1 2.7-1z',
    keyboard: 'M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z',
    sidebar: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM9 19H5V5h4v14zm10 0h-8V5h8v14z',
    image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
    video: 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z',
    plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    palette: 'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    taskbar: 'M20 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H4v-3h16v3zM8 17.5h8v1H8z',
    sliders: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
    upload: 'M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z',
    download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    pip: 'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
    moon: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
    chart: 'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z',
    lyrics: 'M14 3v10.55A4 4 0 1 0 16 17V7h4V3h-6zM3 5h8v2H3zm0 4h8v2H3zm0 4h5v2H3z',
    play2: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.5-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
    link: 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z',
    full: 'M3 3h7v2H5v5H3V3zm11 0h7v7h-2V5h-5V3zM3 14h2v5h5v2H3v-7zm16 5v-5h2v7h-7v-2h5z',
    eq: 'M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z',
    history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A8.95 8.95 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12z',
    pipOut: 'M19 7h-8v6h8V7zm2-4H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16.01H3V4.98h18v14.03z',
    pulse: 'M3 13h2l2-6 4 12 3-8 2 4h5v-2h-3.76L15 8l-3 8-4-12-3 9H3z',
    gift: 'M20 6h-2.18A3 3 0 0 0 12 3.03 3 3 0 0 0 6.18 6H4a2 2 0 0 0-2 2v2a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V8a2 2 0 0 0-2-2zM9 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM3 13v7a2 2 0 0 0 2 2h6v-9H3zm10 9h6a2 2 0 0 0 2-2v-7h-8v9z',
    folder: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z',
    pin: 'M16 9V4h1V2H7v2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',
    chevron: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
    translate: 'm12.87 15.07-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7 1.62-4.33L19.12 17h-3.24z',
    save: 'M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    radio: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-2-3.5 6-4.5-6-4.5v9z',
    playNext: 'M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13-1v8l6-4-6-4z',
    playlistAdd: 'M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z',
    album: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 14.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A2.99 2.99 0 0 0 3 12a3 3 0 0 0 5.04 2.19l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z',
    trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    flag: 'M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    bt: 'M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z',
    btConn: 'M7 12l-2-2-2 2 2 2 2-2zm10.71-4.29L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88zM19 10l-2 2 2 2 2-2-2-2z',
    btOff: 'M13 5.83l1.88 1.88-1.6 1.6 1.41 1.41 3.02-3.02L12 2h-1v5.03l2 2v-3.2zM5.41 4 4 5.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l4.29-4.29 2.3 2.29L20 18.59 5.41 4zM13 18.17v-3.76l1.88 1.88L13 18.17z',
    speaker: 'M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-5 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 16a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    headphones: 'M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h4v-8H5v-1a7 7 0 0 1 14 0v1h-4v8h4a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z',
    mouse: 'M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93zM4 15a8 8 0 0 0 16 0v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z',
    phone: 'M17 1.01 7 1a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-1.99zM17 19H7V5h10v14z',
    devices: 'M4 6h18V4H4a2 2 0 0 0-2 2v11H0v3h14v-3H4V6zm19 2h-6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1zm-1 9h-4v-7h4v7z',
    monitor: 'M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12z',
    skipStart: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
    skipEnd: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    dots: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    block: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.9 7.9 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.9 7.9 0 0 1 20 12c0 4.42-3.58 8-8 8z',
  };
  const ic = (n) => `<svg viewBox="0 0 24 24"><path d="${P[n]}"/></svg>`;
  const CAP = {
    min: '<svg viewBox="0 0 10 10"><path d="M0 5h10v1H0z"/></svg>',
    max: '<svg viewBox="0 0 10 10"><path d="M0 0v10h10V0H0zm1 1h8v8H1V1z"/></svg>',
    restore: '<svg viewBox="0 0 10 10"><path d="M2 0v2H0v8h8V8h2V0H2zm5 9H1V3h6v6zm2-2H8V2H3V1h6v6z"/></svg>',
    close: '<svg viewBox="0 0 10 10"><path d="M.7 0 0 .7 4.3 5 0 9.3l.7.7L5 5.7 9.3 10l.7-.7L5.7 5 10 .7 9.3 0 5 4.3z"/></svg>',
  };
  const LOGO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff486c"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#g)"/><path d="M20 18.5v27L41 32z" fill="#fff"/><path d="M44 22.5a14 14 0 0 1 0 19" stroke="#fff" stroke-width="3.6" fill="none" stroke-linecap="round"/><path d="M49 17.5a21 21 0 0 1 0 29" stroke="#fff" stroke-width="3.6" fill="none" stroke-linecap="round" opacity=".75"/></svg>');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // YouTube enforces Trusted Types, which blocks innerHTML. This tiny builder turns our own
  // (trusted, static) markup into DOM nodes with createElement instead.
  const VOID = /^(input|img|br|hr|meta|link)$/i;
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
  const decode = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] !== undefined ? ENT[e] : m;
  });
  const SVGNS = 'http://www.w3.org/2000/svg';
  function buildNodes(html) {
    const frag = document.createDocumentFragment();
    const stack = [{ node: frag, svg: false }];
    const re = /<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
    const attrRe = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let m;
    while ((m = re.exec(html))) {
      const top = stack[stack.length - 1];
      if (m[1]) { // closing tag
        for (let k = stack.length - 1; k > 0; k--) { if (stack[k].tag === m[1].toLowerCase()) { stack.length = k; break; } }
      } else if (m[2]) {
        const tag = m[2].toLowerCase();
        const svg = top.svg || tag === 'svg';
        const el = svg ? document.createElementNS(SVGNS, m[2]) : document.createElement(tag);
        let a;
        attrRe.lastIndex = 0;
        while ((a = attrRe.exec(m[3] || ''))) {
          const v = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
          try { el.setAttribute(a[1], decode(v)); } catch (e) {}
        }
        top.node.appendChild(el);
        if (!m[4] && !VOID.test(tag)) stack.push({ node: el, tag, svg });
      } else if (m[5]) {
        top.node.appendChild(document.createTextNode(decode(m[5])));
      }
    }
    return frag;
  }
  // Swap an element's icon only when it actually changes (the player re-renders several times a second).
  function setIcon(el, name) {
    if (!el || el.__ic === name) return;
    el.__ic = name;
    setHTML(el, ic(name));
  }
  function setHTML(el, html) {
    if (!el) return;
    html = String(html);
    if (el.__resHTML === html) return;
    el.__resHTML = html;
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(buildNodes(String(html)));
  }
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const hashHue = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const captions = () => `<div class="captions">
      <button class="cap" data-cap="minimize" title="Minimize">${CAP.min}</button>
      <button class="cap" data-cap="toggle_max" title="Maximize" id="capMax">${CAP.max}</button>
      <button class="cap close" data-cap="close" title="Close">${CAP.close}</button></div>`;

  let root, $, $$, setMaxIcon = () => {};

  document.addEventListener('keydown', (e) => { if (e.key === 'F12') invoke('res_win', { action: 'devtools' }).catch(() => {}); }, true);

  function mount() {
    try { mountInner(); } catch (e) { ERR.push('mount: ' + ((e && e.stack) || e)); }
    // sign-in / consent pages: nothing to restore, show the window right away
    if (!IS_YTM) invoke('res_win', { action: 'ready' }).catch(() => {});
    setTimeout(selfCheck, 3500);
  }

  // If the interface didn't appear, show what went wrong instead of a bare YouTube page.
  function selfCheck() {
    const h = document.querySelector('res-shell');
    const bar = h && h.shadowRoot && h.shadowRoot.querySelector('.titlebar, .signin-bar');
    const r = bar && bar.getBoundingClientRect();
    const visible = !!(r && r.width > 100 && r.height > 20);
    if (visible && !ERR.length) return;
    const box = NATIVE.createElement.call(document, 'div');
    box.setAttribute('style', 'position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:2147483647;width:min(760px,92vw);max-height:80vh;overflow:auto;' +
      'background:#1a1a20;color:#eee;border:1px solid #ff486c;border-radius:12px;padding:16px 20px;font:12.5px/1.5 Consolas,monospace;box-shadow:0 30px 80px rgba(0,0,0,.6);user-select:text;white-space:pre-wrap');
    const title = document.createElement('div');
    title.setAttribute('style', 'font:600 15px Segoe UI,sans-serif;margin-bottom:8px');
    title.textContent = 'Resonance: the interface did not load — please send a screenshot of this box';
    const pre = document.createElement('div');
    const sd = window.ShadyDOM;
    pre.textContent = [
      'errors: ' + (ERR.length ? '\n  ' + ERR.join('\n  ') : 'none'),
      'res-shell: ' + (h ? 'present' : 'missing') + ', shadowRoot: ' + !!(h && h.shadowRoot) + ', bar: ' + (r ? `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}` : 'none'),
      'host style: ' + (h ? getComputedStyle(h).position + ' z=' + getComputedStyle(h).zIndex + ' display=' + getComputedStyle(h).display : '-'),
      'ShadyDOM: ' + (sd ? JSON.stringify(sd.settings || { inUse: sd.inUse }) : 'no'),
      'attachShadow patched: ' + (Element.prototype.attachShadow !== NATIVE.attachShadow),
      'Tauri IPC: ' + !!window.__TAURI_INTERNALS__ + ', bridge: ' + !!window.__res + ', adblock: ' + !!window.__resAdblock,
      'url: ' + location.href + '  readyState: ' + document.readyState,
      'UA: ' + navigator.userAgent,
    ].join('\n');
    const btns = document.createElement('div');
    btns.setAttribute('style', 'margin-top:12px;display:flex;gap:8px');
    for (const [label, fn] of [['Reload', () => location.reload()], ['Developer tools (F12)', () => invoke('res_win', { action: 'devtools' })], ['Close app', () => invoke('res_win', { action: 'close' })], ['Dismiss', () => box.remove()]]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('style', 'font:600 12px Segoe UI,sans-serif;padding:6px 12px;border-radius:8px;border:0;background:#2e2e38;color:#fff;cursor:pointer');
      b.onclick = fn;
      btns.appendChild(b);
    }
    box.appendChild(title); box.appendChild(pre); box.appendChild(btns);
    NATIVE.appendChild.call(document.documentElement, box);
  }

  function mountInner() {
    if (document.querySelector('res-shell')) return;
    const host = NATIVE.createElement.call(document, 'res-shell');
    host.setAttribute('style', 'display:block;position:fixed;inset:0;z-index:2147483000;pointer-events:none');
    root = NATIVE.attachShadow.call(host, { mode: 'open' });
    $ = (s) => root.querySelector(s);
    $$ = (s) => Array.from(root.querySelectorAll(s));
    const style = document.createElement('style');
    style.textContent = window.__RES_UI_CSS__ || '';
    root.appendChild(style);
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    root.appendChild(wrap);
    NATIVE.appendChild.call(document.body || document.documentElement, host);

    // images that fail to load fall back to the placeholder underneath instead of a broken-image icon
    root.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG') t.classList.add('broken'); }, true);
    root.addEventListener('load', (e) => { const t = e.target; if (t && t.tagName === 'IMG') t.classList.remove('broken'); }, true);

    // keep YouTube's keyboard shortcuts from firing while typing in our inputs
    for (const t of ['keydown', 'keypress', 'keyup']) {
      root.addEventListener(t, (e) => { const el = e.composedPath()[0]; if (el && /INPUT|TEXTAREA/.test(el.tagName)) e.stopPropagation(); });
    }

    if (IS_YTM) buildApp(wrap); else buildSigninBar(wrap);

    // caption buttons + dragging
    setMaxIcon = (m) => { wrap.classList.toggle('maxed', !!m); setMaxIcon2(m); };
    const setMaxIcon2 = (m) => { const b = $('#capMax'); if (b) { setHTML(b, m ? CAP.restore : CAP.max); b.title = m ? 'Restore' : 'Maximize'; } };
    $$('.cap').forEach((b) => (b.onclick = () => win(b.dataset.cap)));
    const bar = $('.titlebar') || $('.signin-bar');
    bar.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.composedPath()[0].closest('button, input, form, .menu')) return;
      if (e.detail === 2) win('toggle_max'); else win('drag');
    });
    win('state');
    let rt, lastW = innerWidth, lastH = innerHeight;
    window.addEventListener('resize', () => {
      if (innerWidth === lastW && innerHeight === lastH) return; // synthetic resize (layout refresh)
      lastW = innerWidth; lastH = innerHeight;
      clearTimeout(rt); rt = setTimeout(() => win('state'), 150);
    });

    // YouTube Music sometimes rebuilds <body>; re-attach if we get removed
    new MutationObserver(() => { if (!host.isConnected) NATIVE.appendChild.call(document.body || document.documentElement, host); })
      .observe(document.documentElement, { childList: true, subtree: false });
  }

  // =====================================================================
  // Google sign-in / consent pages
  // =====================================================================
  function buildSigninBar(wrap) {
    setHTML(wrap, `<div class="signin-bar auto">
        <div class="brand"><img src="${LOGO}" alt="">Resonance</div>
        <button class="back-pill" id="backHome">${ic('back')}Back to Resonance</button>
        <div class="signin-note">${ic('shield')}You're on Google's own sign-in page — you'll come back automatically.</div>
        ${captions()}</div>`);
    $('#backHome').onclick = () => location.assign(YTM);
  }

  // =====================================================================
  // The app (music.youtube.com)
  // =====================================================================
  function buildApp(wrap) {
    setHTML(wrap, `
    <div class="glow"></div>
    <div class="frame"></div>

    <header class="titlebar auto">
      <div class="tb-left">
        <div class="brand"><img src="${LOGO}" alt="">Resonance</div>
        <button class="icon-btn main-only" id="btnSidebar" title="Collapse sidebar">${ic('sidebar')}</button>
        <div class="history main-only">
          <button class="icon-btn round" id="btnBack" title="Back (Alt+←)">${ic('back')}</button>
          <button class="icon-btn round" id="btnFwd" title="Forward (Alt+→)">${ic('fwd')}</button>
        </div>
      </div>
      <div class="tb-center main-only">
        <form class="searchbox" id="searchForm" autocomplete="off">${ic('search')}
          <input id="searchInput" type="text" placeholder="What do you want to listen to?  ( type > for commands )" spellcheck="false" /><kbd>Ctrl K</kbd>
          <div class="palette" id="palette" hidden></div>
        </form>
      </div>
      <div class="tb-right main-only">
        <button class="icon-btn" id="btnMini" title="Mini player (always on top)">${ic('pip')}</button>
        <button class="icon-btn" id="btnReload" title="Reload">${ic('refresh')}</button>
        <div class="account">
          <button class="avatar-btn" id="btnAccount" title="Account"><span id="avFallback">${ic('user')}</span><img id="avatarImg" alt="" hidden></button>
          <div class="menu" id="menu" hidden>
            <div class="menu-head"><div class="menu-avatar">${ic('user')}<img id="menuAvatar" alt="" hidden></div>
              <div><div class="menu-title" id="menuName">YouTube Music</div><div class="menu-sub" id="menuSub">Signed in</div></div></div>
            <button class="menu-item" id="miSettings">${ic('gear')}Settings</button>
            <button class="menu-item" id="miStats">${ic('chart')}Your listening stats</button>
            <button class="menu-item" id="miHistory">${ic('history')}Listening history</button>
            <button class="menu-item" id="miRecap">${ic('gift')}Your year in music</button>
            <button class="menu-item" id="miShortcuts">${ic('keyboard')}Keyboard shortcuts</button>
            <button class="menu-item" id="miSignIn" hidden>${ic('user')}Sign in</button>
            <div class="menu-sep"></div>
            <button class="menu-item danger" id="miSignOut">${ic('logout')}Sign out</button>
          </div>
        </div>
      </div>
      ${captions()}
    </header>

    <aside class="sidebar auto main-only">
      <nav class="panel nav">
        <button class="nav-item" data-nav="home">${ic('home')}<span>Home</span></button>
        <button class="nav-item" data-nav="explore">${ic('explore')}<span>Explore</span></button>
        <button class="nav-item" data-nav="library">${ic('library')}<span>Library</span></button>
      </nav>
      <section class="panel lib">
        <div class="lib-head">Your playlists</div>
        <div class="lib-list">
          <button class="pl-item" data-browse="VLLM" title="Liked Music"><div class="pl-cover liked-cover">${ic('heartFill')}</div>
            <div class="pl-meta"><div class="pl-title">Liked Music</div><div class="pl-sub">Auto playlist</div></div></button>
          <div id="plDyn"></div>
          <div class="lib-empty" id="plEmpty">Your playlists appear here once YouTube Music finishes loading.</div>
        </div>
      </section>
    </aside>

    <aside class="np panel auto main-only" id="np">
      <div class="np-head"><span>Now playing</span><button class="icon-btn" id="btnCloseNp" title="Close">${ic('close')}</button></div>
      <div class="np-scroll">
        <div class="np-art">${ic('note')}<img id="npArt" alt=""></div>
        <div class="np-title" id="npTitle">Nothing playing</div>
        <div class="np-artist" id="npArtist">Pick something to start</div>
        <div class="np-tabs"><button data-np="queue" class="on">Up next</button><button data-np="lyrics">Lyrics</button><button class="np-save icon-btn" id="btnSaveQueue" title="Save this queue as a playlist">${ic('playlistAdd')}</button></div>
        <div id="queue"><div class="lib-empty">Your queue will show up here.</div></div>
        <div id="lyrics" class="lyrics" hidden><div class="lib-empty">Lyrics will show up here.</div></div>
      </div>
    </aside>

    <div class="vscroll auto main-only" id="vscroll"><div class="vthumb" id="vthumb"></div></div>

    <footer class="playerbar auto main-only"><canvas class="viz pb-viz" id="pbViz" aria-hidden="true"></canvas>
      <div class="pb-left">
        <button class="pb-art" id="pbArtBtn" title="Now playing">${ic('note')}<img id="pbArt" alt=""></button>
        <div class="pb-meta"><button class="pb-title" id="pbTitle">Nothing playing</button><button class="pb-artist" id="pbArtist"></button></div>
        <button class="icon-btn pb-remote" id="btnRemote" title="Phone remote — control Resonance from your phone">${ic('phone')}</button>
        <button class="icon-btn like" id="btnLike" title="Like">${ic('heart')}</button>
      </div>
      <div class="pb-center">
        <div class="controls">
          <button class="icon-btn" id="btnShuffle" title="Shuffle">${ic('shuffle')}</button>
          <button class="icon-btn" id="btnPrev" title="Previous">${ic('prev')}</button>
          <button class="play-btn" id="btnPlay" title="Play">${ic('play')}</button>
          <button class="icon-btn" id="btnNext" title="Next">${ic('next')}</button>
          <button class="icon-btn" id="btnRepeat" title="Repeat">${ic('repeat')}</button>
        </div>
        <div class="progress"><span class="time" id="tCur">0:00</span>
          <div class="slider" id="seek"><div class="track"><div class="fill"></div></div><div class="thumb"></div></div>
          <span class="time" id="tDur">0:00</span></div>
      </div>
      <div class="pb-right">
        <div class="avseg" id="avSeg" hidden>
          <button data-av="song" title="Audio only — show the cover art">${ic('image')}<span>Cover</span></button>
          <button data-av="video" title="Play the music video">${ic('video')}<span>Video</span></button>
        </div>
        <button class="icon-btn" id="btnPip" title="Pop-out video">${ic('pipOut')}</button>
        <button class="icon-btn" id="btnFs" title="Full-screen view (F11)">${ic('full')}</button>
        <button class="icon-btn" id="btnSleep" title="Sleep timer">${ic('moon')}<span class="sleep-badge" id="sleepBadge" hidden></span></button>
        <button class="icon-btn" id="btnPlayerPage" title="Full player (video, lyrics, related)">${ic('expand')}</button>
        <button class="icon-btn" id="btnQueue" title="Now playing &amp; queue">${ic('queue')}</button>
        <button class="icon-btn dev-btn" id="btnDev" hidden><span class="dev-i"></span><span class="dev-p"></span></button>
        <button class="icon-btn" id="btnMute" title="Mute">${ic('vol')}</button>
        <div class="slider vol" id="vol"><div class="track"><div class="fill"></div></div><div class="thumb"></div></div>
      </div>
    </footer>

    <section class="login auto" id="login" hidden>
      <div class="aurora"><i></i><i></i><i></i><i></i></div><div class="login-grid"></div>
      <div class="login-card">
        <img class="login-logo" src="${LOGO}" alt="">
        <h1>Resonance</h1>
        <p class="lead">Your YouTube Music library, playlists and mixes — in a desktop app that feels like one.</p>
        <div class="eq">${'<span></span>'.repeat(12)}</div>
        <button class="btn-primary" id="btnSignIn">${ic('user')}Sign in with Google</button>
        <button class="btn-ghost" id="btnGuest">Continue without signing in</button>
        <div class="features">
          <div>${ic('sparkle')}Colors that follow your music</div>
          <div>${ic('block')}Built-in ad blocker</div>
          <div>${ic('shield')}Sign-in happens on Google's own page</div>
        </div>
      </div>
      <p class="login-foot">Resonance is an independent app and is not affiliated with Google or YouTube. Your password is entered on accounts.google.com and is never stored by Resonance.</p>
    </section>

    <div class="backdrop auto" id="settingsModal" hidden><div class="modal settings">
      <div class="modal-head"><h2>Settings</h2><button class="icon-btn" data-close>${ic('close')}</button></div>
      <div class="st">
        <nav class="st-tabs">
          <button data-tab="general" class="on">${ic('gear')}<span>General</span></button>
          <button data-tab="appearance">${ic('palette')}<span>Appearance</span></button>
          <button data-tab="player">${ic('sliders')}<span>Player bar</span></button>
          <button data-tab="taskbar">${ic('taskbar')}<span>Taskbar</span></button>
          <button data-tab="playback">${ic('play2')}<span>Playback</span></button>
          <button data-tab="eq">${ic('eq')}<span>Equalizer</span></button>
          <button data-tab="shortcuts">${ic('keyboard')}<span>Shortcuts</span></button>
          <button data-tab="integrations">${ic('link')}<span>Connections</span></button>
          <button data-tab="updates">${ic('download')}<span>Updates</span></button>
          <button data-tab="data">${ic('save')}<span>Backup &amp; stats</span></button>
          <button data-tab="health">${ic('pulse')}<span>Health check</span></button>
          <button data-tab="account">${ic('user')}<span>Account</span></button>
        </nav>
        <div class="st-body">
          <section data-pane="general">
            <label class="setting"><div><div class="s-title">Block ads</div><div class="s-sub" id="adSub">Removes audio &amp; video ads. Takes effect after a reload.</div></div><input type="checkbox" class="toggle" id="setAdblock"></label>
            <label class="setting"><div><div class="s-title">Close to tray</div><div class="s-sub">Keep playing in the background when the window is closed</div></div><input type="checkbox" class="toggle" id="setTray"></label>
            <label class="setting"><div><div class="s-title">Start with Windows</div><div class="s-sub">Open Resonance when you sign in to Windows</div></div><input type="checkbox" class="toggle" id="setAutostart"></label>
            <label class="setting" id="rowStartMin"><div><div class="s-title">…straight into the tray</div><div class="s-sub">Start hidden (the taskbar player shows if it's on)</div></div><input type="checkbox" class="toggle" id="setStartMin"></label>
            <label class="setting"><div><div class="s-title">Bluetooth &amp; audio output</div><div class="s-sub">Battery of connected Bluetooth devices, turning Bluetooth on / off and switching speakers or headphones — in the player bar, the mini player and the taskbar player</div></div><input type="checkbox" class="toggle" id="setDevices"></label>
            <label class="setting sub-setting dev-dep"><div><div class="s-title">Pause when headphones disconnect</div><div class="s-sub">So music doesn't suddenly play out loud from the speakers</div></div><input type="checkbox" class="toggle" data-set="autoPause"></label>
            <label class="setting sub-setting dev-dep"><div><div class="s-title">…and resume when they reconnect</div></div><input type="checkbox" class="toggle" data-set="autoResume"></label>
            <label class="setting sub-setting dev-dep"><div><div class="s-title">Low-battery warning</div><div class="s-sub">A notification once a device drops to 15% (once per charge)</div></div><input type="checkbox" class="toggle" data-set="lowBattery"></label>
            <label class="setting"><div><div class="s-title">Song-change pop-up</div><div class="s-sub">A small card with the cover in a corner of the screen when the song changes. Click it to open Resonance.</div></div><input type="checkbox" class="toggle" data-set="overlay"></label>
            <div class="setting sub-setting ov-dep"><div><div class="s-title">Corner</div></div>
              <div class="seg" data-set="overlayCorner"><button data-v="top-left">Top left</button><button data-v="top-right">Top right</button><button data-v="bottom-left">Bottom left</button><button data-v="bottom-right">Bottom right</button></div></div>
            <label class="setting sub-setting ov-dep"><div><div class="s-title">Also when Resonance is in front</div></div><input type="checkbox" class="toggle" data-set="overlayAlways"></label>
            <label class="setting"><div><div class="s-title">Song-change notifications</div><div class="s-sub">A small Windows notification when the song changes and Resonance isn't in front</div></div><input type="checkbox" class="toggle" data-set="notify"></label>
            <div class="setting"><div><div class="s-title">Start page</div><div class="s-sub">What Resonance opens on</div></div>
              <div class="seg" data-set="startPage"><button data-v="home">Home</button><button data-v="explore">Explore</button><button data-v="library">Library</button><button data-v="liked">Liked</button></div></div>
            <label class="setting"><div><div class="s-title">Offer to continue the last song</div><div class="s-sub">Show it in the player bar on start-up; Play picks up where you left off</div></div><input type="checkbox" class="toggle" data-set="showResume"></label>
            <div class="setting"><div><div class="s-title">Keyboard shortcuts</div><div class="s-sub">Search, playback, volume and navigation keys</div></div><button class="btn-small" id="btnShowKeys">View</button></div>
          </section>
          <section data-pane="appearance" hidden>
            <div class="setting"><div><div class="s-title">Theme</div><div class="s-sub">Light is experimental: YouTube Music itself is dark-only, so its pages are recolored</div></div>
              <div class="seg" data-set="theme"><button data-v="dark">Dark</button><button data-v="light">Light</button><button data-v="system">System</button><button data-v="custom">Custom</button></div></div>
            <div class="theme-ed" id="themeEd">
              <div class="te-row">
                <label class="te-col"><input type="color" id="teBg"><span>Background</span></label>
                <label class="te-col"><input type="color" id="tePanel"><span>Panels</span></label>
                <label class="te-col"><input type="color" id="teAccent"><span>Accent</span></label>
                <div class="te-prev" id="tePrev"><i></i><b></b><s></s></div>
              </div>
              <div class="te-list" id="teList"></div>
              <div class="btn-row te-btns"><button class="btn-small" id="teSave">${ic('save')}Save as theme…</button><button class="btn-small" id="teExport">${ic('download')}Export</button><button class="btn-small" id="teImport">${ic('upload')}Import…</button></div>
              <input type="file" id="teFile" accept=".json,application/json" hidden>
            </div>
            <div class="setting"><div><div class="s-title">Interface size</div><div class="s-sub">Makes text and controls bigger or smaller, YouTube Music pages included</div></div>
              <div class="seg" data-set="uiScale"><button data-v="0.9">90%</button><button data-v="1">100%</button><button data-v="1.1">110%</button><button data-v="1.25">125%</button><button data-v="1.4">140%</button></div></div>
            <div class="setting"><div><div class="s-title">Color scheme</div><div class="s-sub" id="colorSub">The app's glow and tint follow the current song's cover</div></div>
              <div class="seg" data-set="colorMode"><button data-v="song">Song</button><button data-v="pfp">Profile picture</button><button data-v="custom">Custom</button></div></div>
            <div class="setting" id="customColorRow"><div><div class="s-title">Custom color</div><div class="s-sub">Pick any color</div></div>
              <div class="swatches" id="swatches"></div></div>
            <div class="setting"><div><div class="s-title">Accent color</div><div class="s-sub">Buttons, highlights and toggles</div></div>
              <div class="seg" data-set="accentMode"><button data-v="brand">Resonance pink</button><button data-v="theme">Match color scheme</button></div></div>
            <div class="setting"><div><div class="s-title">Glow strength</div><div class="s-sub">How strongly the color shows behind the app</div></div>
              <div class="range-row"><input type="range" min="0" max="100" step="5" data-set="glow"><span class="le-val" id="glowV"></span></div></div>
            <div class="setting"><div><div class="s-title">Corners</div><div class="s-sub">Roundness of panels</div></div>
              <div class="seg" data-set="corners"><button data-v="sharp">Sharp</button><button data-v="normal">Normal</button><button data-v="round">Round</button></div></div>
            <label class="setting"><div><div class="s-title">Playlist covers in the sidebar</div><div class="s-sub">Off shows colored letter tiles instead</div></div><input type="checkbox" class="toggle" data-set="plCovers"></label>
          </section>
          <section data-pane="player" hidden>
            <div class="st-note">Choose which controls appear in the player bar.</div>
            <label class="setting"><div class="s-title">Shuffle</div><input type="checkbox" class="toggle" data-set="pb_shuffle"></label>
            <label class="setting"><div class="s-title">Repeat</div><input type="checkbox" class="toggle" data-set="pb_repeat"></label>
            <label class="setting"><div class="s-title">Like button</div><input type="checkbox" class="toggle" data-set="pb_like"></label>
            <label class="setting"><div class="s-title">Phone remote button</div><input type="checkbox" class="toggle" data-set="pb_remote"></label>
            <label class="setting"><div class="s-title">Cover / Video switch</div><input type="checkbox" class="toggle" data-set="pb_av"></label>
            <label class="setting"><div class="s-title">Pop-out video button</div><input type="checkbox" class="toggle" data-set="pb_pip"></label>
            <label class="setting"><div class="s-title">Full-screen view button</div><input type="checkbox" class="toggle" data-set="pb_fs"></label>
            <label class="setting"><div class="s-title">Sleep timer button</div><input type="checkbox" class="toggle" data-set="pb_sleep"></label>
            <label class="setting"><div class="s-title">Full player button</div><input type="checkbox" class="toggle" data-set="pb_full"></label>
            <label class="setting"><div class="s-title">Now playing &amp; queue button</div><input type="checkbox" class="toggle" data-set="pb_queue"></label>
            <label class="setting"><div class="s-title">Volume</div><input type="checkbox" class="toggle" data-set="pb_volume"></label>
            <div class="setting"><div><div class="s-title">Song length shows</div><div class="s-sub">Tip: click the time in the player bar to switch</div></div>
              <div class="seg" data-set="timeMode"><button data-v="elapsed">Total length</button><button data-v="remaining">Time left</button></div></div>
          </section>
          <section data-pane="playback" hidden>
            <div class="setting"><div><div class="s-title">Crossfade</div><div class="s-sub">Fade out the end of each song and fade in the next</div></div>
              <div class="range-row"><input type="range" min="0" max="12" step="1" id="setFade"><span class="le-val" id="fadeV"></span></div></div>
            <label class="setting"><div><div class="s-title">Volume leveling</div><div class="s-sub">Evens out quiet and loud songs</div></div><input type="checkbox" class="toggle" id="setLevel"></label>
            <div class="st-note">If a song ever goes silent with crossfade or leveling on, turn them off and tell me — YouTube may have changed how it plays audio.</div>
            <div class="setting"><div><div class="s-title">Karaoke lyrics</div><div class="s-sub">Highlight synced lyrics word by word. "When available" uses real word timings (some songs on LRCLIB have them); "Always" estimates them for every song.</div></div>
              <div class="seg" data-set="karaoke"><button data-v="off">Off</button><button data-v="auto">When available</button><button data-v="always">Always</button></div></div>
            <div class="setting"><div><div class="s-title">Visualizer</div><div class="s-sub">Bars that move with the music. Uses the same audio processing as the equalizer — if a song ever goes silent, turn it off.</div></div>
              <div class="seg" data-set="viz"><button data-v="off">Off</button><button data-v="bar">Player bar</button><button data-v="fs">Full screen</button><button data-v="both">Both</button></div></div>
            <div class="setting sub-setting viz-dep"><div><div class="s-title">Style</div><div class="s-sub">Glow makes the album art pulse with the beat instead of drawing bars</div></div>
              <div class="seg" data-set="vizStyle"><button data-v="bars">Bars</button><button data-v="wave">Wave</button><button data-v="glow">Glow</button></div></div>
            <div class="setting sub-setting viz-dep"><div><div class="s-title">Strength</div><div class="s-sub">How visible the visualizer is</div></div>
              <div class="range-row"><input type="range" min="10" max="100" step="5" id="setVizStr"><span class="le-val" id="vizStrV"></span></div></div>
            <label class="setting"><div><div class="s-title">Windows media controls</div><div class="s-sub">Song, cover and controls in the Windows volume popup and on the lock screen. Media keys go through Windows. Takes effect after restarting Resonance.</div></div><input type="checkbox" class="toggle" id="setSmtc"></label>
            <label class="setting"><div><div class="s-title">Translate lyrics</div><div class="s-sub">Shows a translation under each line when a song is in another language. Uses Google Translate's free web service (unofficial — it may stop working some day).</div></div><input type="checkbox" class="toggle" data-set="lyrTranslate"></label>
            <label class="setting"><div><div class="s-title">Romanize lyrics</div><div class="s-sub">Japanese, Korean, Chinese, Russian, Greek, Arabic, Hindi… lyrics also shown in Latin letters (romaji, romaja, pinyin…). Uses the same Google Translate service.</div></div><input type="checkbox" class="toggle" data-set="lyrRoman"></label>
            <div class="setting"><div><div class="s-title">Translate into</div></div>
              <select class="le-input sel" id="setLyrLang">
                <option value="en">English</option><option value="pl">Polski</option><option value="de">Deutsch</option><option value="es">Español</option><option value="fr">Français</option>
                <option value="it">Italiano</option><option value="pt">Português</option><option value="nl">Nederlands</option><option value="uk">Українська</option><option value="ru">Русский</option>
                <option value="cs">Čeština</option><option value="sv">Svenska</option><option value="tr">Türkçe</option><option value="ja">日本語</option><option value="ko">한국어</option><option value="zh-CN">中文</option>
              </select></div>
            <div class="setting"><div><div class="s-title">Sleep timer fade-out</div><div class="s-sub">Gently lower the volume over the last 30 seconds</div></div><input type="checkbox" class="toggle" data-set="sleepFade"></div>
          </section>
          <section data-pane="eq" hidden>
            <label class="setting"><div><div class="s-title">Equalizer</div><div class="s-sub">Shape the sound with 10 bands</div></div><input type="checkbox" class="toggle" id="setEq"></label>
            <div class="setting"><div class="s-title">Preset</div><div class="seg" id="eqPresets"></div></div>
            <div class="eq-wrap" id="eqBands"></div>
            <label class="setting"><div><div class="s-title">Remember per audio output</div><div class="s-sub" id="eqOutSub">Each speaker or pair of headphones keeps its own equalizer and switches automatically</div></div><input type="checkbox" class="toggle" data-set="eqPerOutput"></label>
            <div class="st-note">Changes apply instantly. The equalizer uses the same audio processing as crossfade and leveling.</div>
          </section>
          <section data-pane="health" hidden>
            <div class="setting"><div><div class="s-title">Health check</div><div class="s-sub">Tests each connection Resonance uses with YouTube Music. If YouTube changes its site, this shows what broke — send a screenshot.</div></div>
              <div class="btn-row"><button class="btn-small" id="hcRun">${ic('refresh')}Run again</button><button class="btn-small" id="hcCopy">Copy report</button></div></div>
            <div id="hcList" class="hc"></div>
            <div class="setting hc-logs-head"><div><div class="s-title">Recent problems</div><div class="s-sub">Errors Resonance noticed this session, newest first, plus the app's crash log</div></div>
              <div class="btn-row"><button class="btn-small" id="logCopy">Copy errors</button><button class="btn-small" id="logClear">Clear</button></div></div>
            <div class="logs" id="logList"></div>
          </section>
          <section data-pane="shortcuts" hidden>
            <div class="st-note">Global shortcuts work even when Resonance isn't focused. Click a box and press the keys you want; press Backspace to clear.</div>
            <div id="hkList"></div>
            <div class="setting"><div><div class="s-title">Keys inside the app</div><div class="s-sub">Ctrl+K search, Space play/pause, Ctrl+←/→ previous/next…</div></div><button class="btn-small" id="btnShowKeys2">View</button></div>
          </section>
          <section data-pane="integrations" hidden>
            <label class="setting"><div><div class="s-title">Phone remote</div><div class="s-sub">Control Resonance from your phone's browser — no app needed. Your phone has to be on the same Wi-Fi as this PC.</div></div><input type="checkbox" class="toggle" id="setRemote"></label>
            <div class="remote" id="remoteBox" hidden>
              <canvas class="qr" id="remoteQr" width="180" height="180"></canvas>
              <div class="remote-r">
                <div class="remote-h">Scan with your phone's camera</div>
                <div class="remote-url" id="remoteUrl"></div>
                <div class="btn-row"><button class="btn-small" id="remoteCopy">${ic('link')}Copy link</button><button class="btn-small" id="remoteNew">${ic('refresh')}New link</button></div>
                <div class="remote-note">The link contains a secret code, so only people you give it to can use it. "New link" makes old links stop working. If Windows asks whether Resonance may use the network, allow it on <b>private</b> networks.</div>
              </div>
            </div>
            <div class="st-sep"></div>
            <label class="setting"><div><div class="s-title">Show what you're listening to on Discord</div><div class="s-sub" id="dcSub">"Listening to … " on your Discord profile while music plays</div></div><input type="checkbox" class="toggle" id="setDiscord"></label>
            <div class="setting"><div><div class="s-title">Discord application ID</div><div class="s-sub">Discord requires every app to have its own ID — it's free, see the steps below</div></div><input class="le-input dc-id" id="dcId" placeholder="e.g. 1234567890123456789" spellcheck="false" maxlength="24"></div>
            <ol class="steps">
              <li>Open the <button class="link" id="dcPortal">Discord Developer Portal</button> and sign in.</li>
              <li>Click <b>New Application</b>, name it <b>Resonance</b> (that's the name your friends will see), accept and create.</li>
              <li>On the <b>General Information</b> page, copy the <b>Application ID</b> and paste it above.</li>
            </ol>
            <div class="st-note">Discord must be open on this PC. Nothing is shown while music is paused.</div>
          </section>
          <section data-pane="updates" hidden>
            <div class="setting"><div><div class="s-title">What's new</div><div class="s-sub">Changes in this version, from its GitHub release notes</div></div><button class="btn-small" id="wnOpen">${ic('sparkle')}What's new</button></div>
            <div class="st-note info">${ic('shield')}<span>How updates work: Resonance asks <b>GitHub</b> for the latest release of its official repository (below) and compares that release's version number with this one (<b id="curVer">1.0.0</b>). If it's newer, it offers the installer from that same GitHub release. No other server is contacted.</span></div>
            <div class="setting"><div><div class="s-title">Releases</div><div class="s-sub">github.com/${UPDATE_REPO}</div></div><button class="btn-small" id="upRepoOpen">${ic('link')}Open on GitHub</button></div>
            <label class="setting"><div><div class="s-title">Check for updates automatically</div><div class="s-sub">Once a day when Resonance starts. Off by default.</div></div><input type="checkbox" class="toggle" data-set="autoUpdate"></label>
            <div class="setting"><div><div class="s-title" id="upTitle">Check now</div><div class="s-sub" id="upStatus">Not checked yet</div></div>
              <div class="btn-row"><button class="btn-small" id="upCheck">Check for updates</button><button class="btn-small primary" id="upInstall" hidden>${ic('download')}Install update</button></div></div>
          </section>
          <section data-pane="data" hidden>
            <div class="setting"><div><div class="s-title">Back up settings</div><div class="s-sub">Layouts, colors, shortcuts, picture and preferences, saved as a file in your Downloads folder</div></div><button class="btn-small" id="bkExport">${ic('download')}Export</button></div>
            <div class="setting"><div><div class="s-title">Restore settings</div><div class="s-sub">Load a Resonance backup file (replaces your current settings)</div></div><button class="btn-small" id="bkImport">${ic('upload')}Import…</button></div>
            <input type="file" id="bkFile" accept=".json,application/json" hidden>
            <div class="setting"><div><div class="s-title">Listening stats</div><div class="s-sub" id="statsSub">Kept only on this PC</div></div><div class="btn-row"><button class="btn-small" id="stOpenStats">${ic('chart')}View stats</button><button class="btn-small danger" id="stClearStats">Clear</button></div></div>
          </section>
          <section data-pane="taskbar" hidden>
            <label class="setting"><div><div class="s-title">Taskbar mini player</div><div class="s-sub">When Resonance is minimized or in the tray, show play controls on the taskbar</div></div><input type="checkbox" class="toggle" id="setWidget"></label>
            <div class="setting"><div><div class="s-title">Layout</div><div class="s-sub" id="layoutSub">Classic</div></div><button class="btn-small" id="btnEditLayout">Edit layouts</button></div>
          </section>
          <section data-pane="account" hidden>
            <div class="acct">
              <div class="acct-pic"><span>${ic('user')}</span><img id="acctPic" alt=""></div>
              <div class="acct-meta"><div class="acct-name" id="acctName">YouTube Music</div><div class="acct-sub" id="acctSub">Not signed in</div></div>
            </div>
            <div class="setting"><div><div class="s-title">Profile picture in Resonance</div><div class="s-sub" id="pfpSub">Using your YouTube Music picture</div></div>
              <div class="btn-row"><button class="btn-small" id="pfpUpload">${ic('upload')}Choose picture…</button><button class="btn-small" id="pfpReset">Use YouTube Music's</button></div></div>
            <div class="st-note info">${ic('shield')}<span>A custom picture is only shown inside Resonance. Your Google / YouTube Music profile picture is <b>not</b> changed.</span></div>
            <input type="file" id="pfpFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
            <div class="setting"><div><div class="s-title">Google account</div><div class="s-sub">Sign out of YouTube Music in Resonance</div></div><button class="btn-small danger" id="stSignOut">${ic('logout')}Sign out</button></div>
          </section>
        </div>
      </div>
      <div class="modal-foot">Resonance 1.0 · Tauri + WebView2 · Not affiliated with Google or YouTube</div>
    </div></div>

    <div class="ctx auto" id="ctx" hidden></div>
    <div class="dev-pop rm-pop auto" id="remotePop" hidden>
      <div class="rmp-head"><div class="dv-ic on">${ic('phone')}</div><div class="dv-hm"><div class="dv-t">Phone remote</div><div class="dv-s" id="rmpSub">Scan with your phone's camera</div></div><input type="checkbox" class="toggle" id="rmpOn" title="Phone remote on / off"></div>
      <div class="rmp-body" id="rmpBody">
        <canvas class="qr rmp-qr" id="rmpQr" width="180" height="180"></canvas>
        <div class="remote-url rmp-url" id="rmpUrl"></div>
        <div class="btn-row rmp-btns"><button class="btn-small" id="rmpCopy">${ic('link')}Copy link</button><button class="btn-small" id="rmpNew">${ic('refresh')}New link</button></div>
        <div class="remote-note">Your phone has to be on the same Wi-Fi as this PC.</div>
      </div>
    </div>
    <div class="dev-pop auto" id="devPop" hidden><div class="dv" id="devPopBody"></div></div>

    <div class="backdrop auto" id="savePlModal" hidden><div class="modal small spl-modal">
      <div class="modal-head"><div class="spl-h"><h2>Save to playlist</h2><div class="spl-sub" id="splSub"></div></div><button class="icon-btn" data-close>${ic('close')}</button></div>
      <button class="spl-new" id="splNew"><span class="spl-plus">${ic('plus')}</span>New playlist</button>
      <div class="spl-list" id="splList"></div>
    </div></div>

    <div class="sleep-pop auto" id="sleepPop" hidden>
      <div class="sp-title">Sleep timer</div>
      <div class="sp-status" id="sleepStatus">Off</div>
      <div class="sp-grid">
        <button data-min="15">15 min</button><button data-min="30">30 min</button><button data-min="45">45 min</button>
        <button data-min="60">1 hour</button><button data-min="90">1.5 hours</button><button data-min="end">End of song</button>
      </div>
      <button class="btn-small danger sp-off" id="sleepOff">Turn off</button>
    </div>

    <div class="mini auto" id="mini" hidden>
      <div class="mini-bg" id="miniBg"></div>
      <div class="mini-row">
        <div class="mini-art" id="miniArt"></div>
        <div class="mini-meta"><div class="mini-title" id="miniTitle">Nothing playing</div><div class="mini-artist" id="miniArtist"></div></div>
        <div class="mini-win">
          <button class="icon-btn mini-dev" id="miniDev" hidden><span class="dev-i"></span><span class="dev-p"></span></button>
          <button class="icon-btn" id="miniExit" title="Back to full window">${ic('expand')}</button>
          <button class="icon-btn" id="miniClose" title="Close">${ic('close')}</button>
        </div>
      </div>
      <div class="mini-ctrl">
        <button class="icon-btn" id="miniLike" title="Like">${ic('heart')}</button>
        <button class="icon-btn" id="miniPrev" title="Previous">${ic('prev')}</button>
        <button class="play-btn" id="miniPlay" title="Play / pause">${ic('play')}</button>
        <button class="icon-btn" id="miniNext" title="Next">${ic('next')}</button>
        <button class="icon-btn" id="miniShuffle" title="Shuffle">${ic('shuffle')}</button>
      </div>
      <div class="mini-prog" id="miniProg"><i></i></div>
      <div class="mini-devp" id="miniDevP" hidden>
        <div class="mdp-head"><span>Devices &amp; output</span><button class="icon-btn" id="miniDevClose" title="Close">${ic('close')}</button></div>
        <div class="dv mdp-body" id="miniDevBody"></div>
      </div>
    </div>

    <div class="backdrop auto" id="statsModal" hidden><div class="modal wide">
      <div class="modal-head"><h2>Your listening</h2><div class="seg stats-range" id="statsRange"><button data-r="7" class="on">7 days</button><button data-r="30">30 days</button><button data-r="365">This year</button></div><button class="icon-btn" data-close>${ic('close')}</button></div>
      <div class="stats" id="statsBody"></div>
      <div class="modal-foot">Stats are recorded only on this PC and are never uploaded.</div>
    </div></div>

    <div class="fsv auto" id="fsv" hidden>
      <div class="fsv-bg" id="fsvBg"></div><div class="fsv-shade"></div><canvas class="viz fsv-viz" id="fsvViz" aria-hidden="true"></canvas>
      <div class="fsv-top"><div class="brand"><img src="${LOGO}" alt="">Resonance</div><div class="fsv-top-r"><button class="icon-btn" id="fsvLyrToggle" title="Show / hide lyrics">${ic('lyrics')}</button><button class="icon-btn" id="fsvExit" title="Exit full screen (Esc)">${ic('collapse')}</button></div></div>
      <div class="fsv-main">
        <div class="fsv-left">
          <div class="fsv-art" id="fsvArt"></div>
          <div class="fsv-title" id="fsvTitle">Nothing playing</div>
          <div class="fsv-artist" id="fsvArtist"></div>
          <div class="fsv-prog"><span id="fsvCur">0:00</span><div class="fsv-bar" id="fsvBar"><i></i></div><span id="fsvDur">0:00</span></div>
          <div class="fsv-ctrl">
            <button class="icon-btn" id="fsvShuffle">${ic('shuffle')}</button><button class="icon-btn" id="fsvPrev">${ic('prev')}</button>
            <button class="play-btn" id="fsvPlay">${ic('play')}</button>
            <button class="icon-btn" id="fsvNext">${ic('next')}</button><button class="icon-btn" id="fsvLike">${ic('heart')}</button>
          </div>
        </div>
        <div class="fsv-lyrics" id="fsvLyrics"></div>
      </div>
    </div>

    <div class="backdrop auto" id="historyModal" hidden><div class="modal wide hist-modal">
      <div class="modal-head"><h2>Listening history</h2><input class="le-input hist-search" id="histSearch" placeholder="Search songs or artists" spellcheck="false"><button class="icon-btn" data-close>${ic('close')}</button></div>
      <div class="hist" id="histList"></div>
      <div class="modal-foot">Kept only on this PC (last 1,000 songs). Click a song to play it.</div>
    </div></div>

    <div class="backdrop auto" id="recapModal" hidden><div class="modal recap-modal"><div class="recap" id="recap"></div></div></div>

    <div class="backdrop auto" id="wnModal" hidden><div class="modal wn-modal">
      <div class="wn-hero"><img src="${LOGO}" alt=""><div><div class="wn-k">Updated</div><h2 id="wnTitle">What's new</h2></div><button class="icon-btn" data-close>${ic('close')}</button></div>
      <div class="wn-body" id="wnBody"></div>
      <div class="btn-row wn-btns"><button class="btn-small" id="wnGh" hidden>${ic('link')}View on GitHub</button><button class="btn-small primary" data-close>Got it</button></div>
    </div></div>

    <div class="backdrop auto" id="promptModal" hidden><div class="modal small">
      <div class="modal-head"><h2 id="promptTitle">Name</h2><button class="icon-btn" data-close>${ic('close')}</button></div>
      <input class="le-input prompt-in" id="promptInput" maxlength="60" spellcheck="false">
      <div class="btn-row prompt-btns"><button class="btn-small" data-close>Cancel</button><button class="btn-small primary" id="promptOk">Save</button></div>
    </div></div>

    <div class="splash auto" id="splash"><img src="${LOGO}" alt=""><div class="eq">${'<span></span>'.repeat(9)}</div><div class="splash-t">Loading YouTube Music…</div></div>

    <div class="backdrop auto" id="layoutModal" hidden><div class="modal wide">
      <div class="modal-head"><h2>Taskbar player layouts</h2><button class="icon-btn" data-close>${ic('close')}</button></div>
      <div class="le">
        <div class="le-side">
          <div class="le-list" id="leList"></div>
          <button class="btn-small le-new" id="leNew">${ic('plus')}New layout</button>
        </div>
        <div class="le-main">
          <div class="le-preview"><div class="le-taskbar" id="leTaskbar"><div class="le-slot" id="leSlot"></div></div></div>
          <div class="le-note" id="leBuiltin">Built-in layout — <button class="link" id="leDup">duplicate it</button> to make your own version.</div>
          <div class="le-form" id="leForm">
            <div class="le-row"><span class="le-l">Name</span><input class="le-input" id="leName" maxlength="40" spellcheck="false"></div>
            <div class="le-row top"><span class="le-l">Elements</span><div><div class="le-chips" id="leChips"></div><div class="le-add" id="leAdd"></div><div class="le-hint">Drag to reorder · × to remove</div></div></div>
            <div class="le-row"><span class="le-l">Width</span><input type="range" min="100" max="1000" step="10" id="leWidth"><span class="le-val" id="leWidthV"></span></div>
            <div class="le-row"><span class="le-l">Shape</span><div class="seg" data-k="shape"><button data-v="pill">Pill</button><button data-v="rounded">Rounded</button><button data-v="square">Square</button></div></div>
            <div class="le-row"><span class="le-l">Background</span><div class="seg" data-k="bg"><button data-v="tint">Album glow</button><button data-v="solid">Album solid</button><button data-v="glass">Glass</button><button data-v="dark">Dark</button></div></div>
            <div class="le-row"><span class="le-l">Progress</span><div class="seg" data-k="progress"><button data-v="none">None</button><button data-v="bottom">Line</button><button data-v="fill">Fill</button></div></div>
            <div class="le-row"><span class="le-l">Position</span><div class="seg" data-k="align"><button data-v="left">Left</button><button data-v="center">Center</button><button data-v="right">Right</button></div></div>
            <div class="le-row"><span class="le-l">Nudge</span><input type="range" min="-800" max="800" step="5" id="leOffset"><span class="le-val" id="leOffsetV"></span></div>
            <label class="le-row"><span class="le-l">Show artist</span><input type="checkbox" class="toggle" id="leArtist"></label>
            <div class="le-row"><span class="le-l"></span><button class="btn-small danger" id="leDelete">Delete layout</button></div>
          </div>
        </div>
      </div>
    </div></div>

    <div class="backdrop auto" id="kbModal" hidden><div class="modal">
      <div class="modal-head"><h2>Keyboard shortcuts</h2><button class="icon-btn" data-close>${ic('close')}</button></div>
      <div class="kb-grid">
        <span>Search</span><span><kbd>Ctrl</kbd> <kbd>K</kbd></span>
        <span>Play / pause</span><span><kbd>Space</kbd> or media key</span>
        <span>Next / previous</span><span><kbd>Ctrl</kbd> <kbd>→</kbd> / <kbd>←</kbd></span>
        <span>Volume up / down</span><span><kbd>Ctrl</kbd> <kbd>↑</kbd> / <kbd>↓</kbd></span>
        <span>Back / forward</span><span><kbd>Alt</kbd> <kbd>←</kbd> / <kbd>→</kbd></span>
      </div>
    </div></div>

    <button class="mini-x auto" id="miniX" title="Close mini player (music keeps playing)" hidden>${ic('close')}</button>
    <div class="toast" id="toast" hidden></div>`);

    const R = () => window.__res;
    const cmd = (name, arg) => { try { R() && R().cmd(name, arg); } catch (e) {} setTimeout(poll, 120); };
    let toastT;
    const toast = (m, ms) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms || 2200); };

    // ---------- layout ----------
    function layout() {
      const compact = innerWidth < 1100 || !!S.sidebarCollapsed;
      wrap.classList.toggle('compact', compact);
      const L = compact ? 92 : 300, Rr = S.npOpen ? 336 : 8;
      const de = document.documentElement.style;
      de.setProperty('--res-l', L + 'px');
      de.setProperty('--res-r', Rr + 'px');
      window.__resBox = { t: 44, l: L, r: Rr, b: 88 };
      for (const d of [0, 120, 260, 420]) setTimeout(() => { try { R() && R().fit(); } catch (e) {} }, d);
      $('#np').classList.toggle('open', !!S.npOpen);
      $('#btnSidebar').classList.toggle('active', !!S.sidebarCollapsed);
      $('#btnSidebar').title = S.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
      $('#btnQueue').classList.toggle('active', !!S.npOpen);
    }
    window.addEventListener('resize', layout);
    layout();
    $('#btnSidebar').onclick = () => { S.sidebarCollapsed = !S.sidebarCollapsed; saveS(); layout(); };

    // ---------- login ----------
    const signedIn = () => /(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=/.test(document.cookie);
    let guest = false;
    try { guest = localStorage.getItem('res-guest') === '1'; } catch (e) {}
    function updateAuthUI() {
      const ok = signedIn();
      $('#login').hidden = ok || guest;
      wrap.classList.toggle('locked', !(ok || guest));
      $('#miSignOut').hidden = !ok;
      $('#miSignIn').hidden = ok;
      $('#menuSub').textContent = ok ? 'Signed in with Google' : 'Browsing as guest';
    }
    updateAuthUI();
    $('#btnSignIn').onclick = () => location.assign(LOGIN_URL);
    $('#miSignIn').onclick = () => location.assign(LOGIN_URL);
    $('#btnGuest').onclick = () => { guest = true; try { localStorage.setItem('res-guest', '1'); } catch (e) {} updateAuthUI(); };
    $('#miSignOut').onclick = () => {
      closeMenu(); cmd('pause');
      try { localStorage.removeItem('res-cache-acct'); localStorage.removeItem('res-cache-pl'); } catch (e) {}
      invoke('res_sign_out').catch(() => location.assign('https://www.youtube.com/logout?next=' + encodeURIComponent(YTM)));
    };

    // ---------- menus / modals ----------
    const menu = $('#menu');
    const closeMenu = () => (menu.hidden = true);
    $('#btnAccount').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    root.addEventListener('click', (e) => { if (!menu.hidden && !e.composedPath().includes(menu) && !e.composedPath().includes($('#btnAccount'))) closeMenu(); });
    document.addEventListener('click', closeMenu);
    $$('.backdrop').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m || e.composedPath()[0].closest('[data-close]')) m.hidden = true; }));
    $('#miSettings').onclick = () => openSettings('general');
    $('#miShortcuts').onclick = () => { closeMenu(); $('#kbModal').hidden = false; };
    const SWATCHES = ['#ff486c', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#94a3b8'];
    setHTML($('#swatches'), SWATCHES.map((c) => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('') +
      '<label class="sw sw-pick" title="Any color"><input type="color" id="setColor"></label>');
    function syncSettings() {
      $('#setAdblock').checked = S.adblock !== false;
      $('#setTray').checked = !!S.closeToTray;
      $('#setWidget').checked = !!S.taskbarWidget;
      $('#setDevices').checked = S.devices !== false;
      $$('#settingsModal [data-set]').forEach((el) => {
        const k = el.dataset.set;
        if (el.classList.contains('seg')) el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(S[k]) === b.dataset.v));
        else if (el.type === 'checkbox') el.checked = !!S[k];
        else if (el.type === 'range') el.value = S[k];
      });
      $('#glowV').textContent = S.glow + '%';
      $('#customColorRow').hidden = S.colorMode !== 'custom';
      $('#setColor').value = S.customColor;
      $$('#swatches .sw[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c.toLowerCase() === String(S.customColor).toLowerCase()));
      syncExtras();
      drawThemeEd();
      $$('.dev-dep').forEach((r) => r.classList.toggle('dim', S.devices === false));
      $$('.ov-dep').forEach((r) => r.classList.toggle('dim', !S.overlay));
      $$('.viz-dep').forEach((r) => r.classList.toggle('dim', !S.viz || S.viz === 'off'));
      $('#setVizStr').value = S.vizStrength; $('#vizStrV').textContent = S.vizStrength + '%';
      $('#setRemote').checked = !!S.remote;
      $('#colorSub').textContent = { song: "The app's glow and tint follow the current song's cover", pfp: 'The app takes its colors from your profile picture', custom: 'One color of your choice' }[S.colorMode];
      updatePfp();
      const ab = window.__resAdblock;
      $('#adSub').textContent = ab && ab.enabled ? `Active — ${ab.blocked + ab.skipped} ad items blocked this session.` : 'Removes audio & video ads. Takes effect after a reload.';
    }
    $('#setAdblock').onchange = (e) => { S.adblock = e.target.checked; saveS(); toast('Reloading to apply…'); setTimeout(() => location.reload(), 700); };
    // generic bindings for [data-set] controls
    $$('#settingsModal [data-set]').forEach((el) => {
      const k = el.dataset.set;
      if (el.classList.contains('seg')) el.addEventListener('click', (e) => { const b = e.composedPath()[0].closest('button'); if (!b) return; S[k] = b.dataset.v; saveS(); applyPrefs(); syncSettings(); if (/^overlay/.test(k)) sendOverlay(); });
      else if (el.type === 'checkbox') el.addEventListener('change', () => { S[k] = el.checked; saveS(); applyPrefs(); syncSettings(); if (k === 'lyrTranslate' || k === 'lyrRoman') { if (k === 'lyrTranslate' && !el.checked) lyr.trans = null; if (k === 'lyrRoman' && !el.checked) lyr.roman = null; drawLyrics(); fsDrawLyrics(); translateLyrics(); } if (/^overlay/.test(k)) sendOverlay(); });
      else if (el.type === 'range') el.addEventListener('input', () => { S[k] = Number(el.value); saveS(); applyPrefs(); $('#glowV').textContent = S.glow + '%'; });
    });
    $('#swatches').addEventListener('click', (e) => { const b = e.composedPath()[0].closest('[data-c]'); if (!b) return; S.customColor = b.dataset.c; saveS(); applyPrefs(); syncSettings(); });
    $('#setColor').addEventListener('input', (e) => { S.customColor = e.target.value; saveS(); applyPrefs(); $$('#swatches .sw[data-c]').forEach((b) => b.classList.remove('on')); });
    $$('.st-tabs button').forEach((t) => (t.onclick = () => openSettings(t.dataset.tab)));
    function openSettings(tab) {
      closeMenu(); closeCtx();
      syncSettings();
      $$('.st-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      $$('.st-body section').forEach((p) => (p.hidden = p.dataset.pane !== tab));
      if (tab === 'health') runHealth();
      if (tab === 'eq') drawEq();
      $('#settingsModal').hidden = false;
    }
    $('#btnShowKeys').onclick = () => { $('#settingsModal').hidden = true; $('#kbModal').hidden = false; };
    $('#stSignOut').onclick = () => { $('#settingsModal').hidden = true; $('#miSignOut').click(); };

    // ---------- profile picture ----------
    let ytAccount = (() => { try { return signedIn() ? JSON.parse(localStorage.getItem('res-cache-acct') || 'null') : null; } catch (e) { return null; } })();
    const customPfp = () => { try { return localStorage.getItem('res-pfp') || ''; } catch (e) { return ''; } };
    function pfpUrl() { return customPfp() || (ytAccount && ytAccount.photo) || (state && state.avatar) || ''; }
    let lastPfpForColor = '';
    function updatePfp() {
      const url = pfpUrl();
      for (const id of ['#avatarImg', '#menuAvatar', '#acctPic']) { const im = $(id); if (!im) continue; if (url) { if (im.getAttribute('src') !== url) im.src = url; im.hidden = false; } else { im.removeAttribute('src'); im.hidden = true; } }
      $('#avFallback').hidden = !!url;
      const signed = signedIn();
      const name = (ytAccount && ytAccount.name) || (signed ? 'YouTube Music' : 'Guest');
      $('#menuName').textContent = name;
      $('#acctName').textContent = name;
      $('#acctSub').textContent = signed ? ((ytAccount && ytAccount.handle) || 'Signed in with Google') : 'Not signed in';
      $('#pfpSub').textContent = customPfp() ? 'Using a custom picture (only in Resonance)' : (ytAccount && ytAccount.photo) || (state && state.avatar) ? 'Using your YouTube Music picture' : 'No picture yet — choose one, or sign in';
      $('#pfpReset').hidden = !customPfp();
      if (url && url !== lastPfpForColor) {
        lastPfpForColor = url;
        colorOf(url).then((rgb) => { pfpTint = rgb; if (S.colorMode === 'pfp') applyColor(); });
      }
    }
    function loadAccount() {
      if (!signedIn() || !R() || !R().account) return;
      R().account().then((a) => { if (a) { ytAccount = a; try { localStorage.setItem('res-cache-acct', JSON.stringify(a)); } catch (e) {} updatePfp(); } }).catch(() => {});
    }
    setTimeout(loadAccount, 1500);
    $('#pfpUpload').onclick = () => $('#pfpFile').click();
    $('#pfpReset').onclick = () => { try { localStorage.removeItem('res-pfp'); } catch (e) {} updatePfp(); toast('Using your YouTube Music picture'); };
    $('#pfpFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 15e6) { toast('That image is too large (max 15 MB)'); return; }
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas'); c.width = c.height = 256;
          const k = Math.max(256 / img.width, 256 / img.height);
          const w = img.width * k, h = img.height * k;
          c.getContext('2d').drawImage(img, (256 - w) / 2, (256 - h) / 2, w, h);
          try { localStorage.setItem('res-pfp', c.toDataURL('image/jpeg', 0.9)); } catch (x) { toast("Couldn't save that picture"); return; }
          updatePfp(); toast('Profile picture updated (only in Resonance)');
        };
        img.onerror = () => toast("That file isn't an image Resonance can read");
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    });

    // ---------- colors ----------
    let songTint = null, pfpTint = null;
    const hexToRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    function colorOf(url) {
      if (/^https:/.test(url)) return invoke('res_dominant_color', { url }).catch(() => null);
      return new Promise((res) => {           // data: URLs (custom picture) are measured locally
        const img = new Image();
        img.onload = () => {
          try {
            const c = document.createElement('canvas'); c.width = c.height = 16;
            const x = c.getContext('2d'); x.drawImage(img, 0, 0, 16, 16);
            const d = x.getImageData(0, 0, 16, 16).data;
            let r = 0, g = 0, b = 0, ws = 0;
            for (let i = 0; i < d.length; i += 4) {
              const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
              const sat = mx ? (mx - mn) / mx : 0, lum = (mx + mn) / 510;
              const w = 0.05 + sat * sat * Math.max(0, 1 - Math.abs(lum - 0.5) * 1.4);
              r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; ws += w;
            }
            const rgb = [r / ws, g / ws, b / ws], k = 190 / Math.max(1, ...rgb);
            res(rgb.map((v) => Math.min(255, Math.round(v * k))));
          } catch (e) { res(null); }
        };
        img.onerror = () => res(null);
        img.src = url;
      });
    }
    function accentFrom(rgb) {
      if (!rgb) return '#ff486c';
      let [r, g, b] = rgb.map((v) => v / 255);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      let h = 0;
      if (mx !== mn) { const d = mx - mn; h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
      return `hsl(${Math.round(h)} 85% 64%)`;
    }
    function applyColor() {
      const rgb = S.colorMode === 'custom' ? hexToRgb(S.customColor) : S.colorMode === 'pfp' ? pfpTint : songTint;
      setTint(rgb);
      wrap.style.setProperty('--accent', S.accentMode === 'theme' ? accentFrom(rgb) : '#ff486c');
    }
    function applyPrefs() {
      wrap.style.setProperty('--rad', { sharp: '4px', normal: '12px', round: '20px' }[S.corners] || '12px');
      document.documentElement.style.setProperty('--res-rad', { sharp: '4px', normal: '12px', round: '20px' }[S.corners] || '12px');
      const g = Math.max(0, Math.min(100, Number(S.glow))) / 100;
      wrap.style.setProperty('--glow', g);
      document.documentElement.style.setProperty('--res-glow', g);
      wrap.classList.toggle('no-covers', !S.plCovers);
      for (const k of ['shuffle', 'repeat', 'like', 'av', 'full', 'queue', 'volume', 'sleep', 'pip', 'fs', 'remote']) wrap.classList.toggle('hide-pb-' + k, S['pb_' + k] === false);
      const light = S.theme === 'light' || (S.theme === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
      wrap.classList.toggle('light', light);
      document.documentElement.classList.toggle('res-light', light);
      applyColor();
      applyTheme();
      // interface size (the mini player always stays at 100% — its window is tiny)
      const z = Number(S.uiScale) || 1;
      if (!zoomHold && z !== appliedZoom) { appliedZoom = z; invoke('res_win', { action: 'zoom:' + z }).catch(() => {}); }
      const vz = !!S.viz && S.viz !== 'off';
      try { if (R() && R().fxState && R().fxState().viz !== vz) R().setFx({ viz: vz }); } catch (e) {}
      if (karaokeMode !== undefined && karaokeMode !== S.karaoke) { karaokeMode = S.karaoke; drawLyrics(); fsDrawLyrics(); removePageLyrics(); }
      karaokeMode = S.karaoke;
      wrap.classList.toggle('viz-bar', S.viz === 'bar' || S.viz === 'both');
    }
    var appliedZoom = 1, zoomHold = false, karaokeMode;
    $('#setWidget').onchange = (e) => { S.taskbarWidget = e.target.checked; saveS(); invoke('res_set_widget', { value: S.taskbarWidget }).catch(() => {}); if (S.taskbarWidget) toast('Minimize Resonance to see it on the taskbar'); };
    // ---------- taskbar layout editor ----------
    const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let edId = S.widgetLayoutId, preview = null, dragIdx = -1;
    if (RW()) { const st = document.createElement('style'); st.textContent = RW().CSS; root.appendChild(st); }
    const edLayout = () => allLayouts().find((l) => l.id === edId) || activeLayout();
    const isCustom = (l) => !!(l && !l.builtin);
    function previewState() {
      if (state && state.hasTrack) return { playing: state.playing, title: state.title, artist: state.artist, art: state.art, tint: curTint, time: state.time, duration: state.duration, like: state.like, shuffle: state.shuffle };
      return { playing: true, title: 'Song title', artist: 'Artist name', art: '', tint: curTint || [255, 72, 108], time: 70, duration: 200, like: 'LIKE', shuffle: true };
    }
    function drawPreview() {
      if (!RW()) return;
      const l = RW().normalize(edLayout());
      const tb = $('#leTaskbar'), slot = $('#leSlot');
      const k = Math.min(1, (tb.clientWidth - 16) / l.width);
      slot.style.width = l.width + 'px';
      slot.style.transform = `translateX(${l.offset * k}px) scale(${k})`;
      tb.style.justifyContent = l.align === 'left' ? 'flex-start' : l.align === 'right' ? 'flex-end' : 'center';
      slot.style.transformOrigin = l.align === 'left' ? 'left center' : l.align === 'right' ? 'right center' : 'center';
      if (preview) preview.destroy();
      preview = RW().mount(slot, l, { cmd: () => {}, show: () => {} }, { static: false });
      preview.update(previewState());
    }
    function drawList() {
      setHTML($('#leList'), allLayouts().map((l) => `<button class="le-item${l.id === edId ? ' sel' : ''}" data-id="${esc(l.id)}">
        <span class="le-dot${l.id === S.widgetLayoutId ? ' on' : ''}"></span><span class="le-name">${esc(l.name)}</span><span class="le-tag">${l.builtin ? 'Built-in' : 'Custom'}</span></button>`).join(''));
      $('#layoutSub').textContent = activeLayout().name || 'Classic';
    }
    function drawForm() {
      const l = RW() ? RW().normalize(edLayout()) : edLayout();
      const custom = isCustom(edLayout());
      $('#leBuiltin').hidden = custom;
      $('#leForm').classList.toggle('locked-form', !custom);
      $('#leName').value = l.name;
      $('#leWidth').value = l.width; $('#leWidthV').textContent = l.width + ' px';
      $('#leOffset').value = l.offset; $('#leOffsetV').textContent = (l.offset > 0 ? '+' : '') + l.offset + ' px';
      $('#leArtist').checked = !!l.showArtist;
      $$('#leForm .seg').forEach((sg) => sg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', l[sg.dataset.k] === b.dataset.v)));
      const names = RW() ? RW().ITEMS : {};
      setHTML($('#leChips'), l.items.map((it, i) => `<span class="chip" data-i="${i}">${esc(names[it] || it)}<button class="chip-x" data-rm="${i}" title="Remove">×</button></span>`).join(''));
      const missing = Object.keys(names).filter((k) => !l.items.includes(k));
      setHTML($('#leAdd'), missing.map((k) => `<button class="chip add" data-add="${k}">+ ${esc(names[k])}</button>`).join(''));
    }
    function drawEditor() { drawList(); drawForm(); requestAnimationFrame(drawPreview); }
    function patch(p) {
      const l = edLayout();
      if (!isCustom(l)) return;
      Object.assign(l, p);
      saveS();
      if (l.id === S.widgetLayoutId) sendLayout();
      drawEditor();
    }
    function activate(id) { S.widgetLayoutId = id; saveS(); sendLayout(); }
    $('#btnEditLayout').onclick = () => { $('#settingsModal').hidden = true; edId = S.widgetLayoutId; $('#layoutModal').hidden = false; drawEditor(); };
    $('#leList').addEventListener('click', (e) => { const b = e.composedPath()[0].closest('.le-item'); if (!b) return; edId = b.dataset.id; activate(edId); drawEditor(); });
    $('#leNew').onclick = () => { const base = RW() ? RW().normalize(activeLayout()) : {}; const used = new Set(allLayouts().map((x) => x.name));
      let n = 1, name = 'My layout';
      while (used.has(name)) name = 'My layout ' + ++n;
      const l = Object.assign({}, base, { id: uid(), name, builtin: false }); S.widgetLayouts = (S.widgetLayouts || []).concat(l); edId = l.id; activate(l.id); drawEditor(); $('#leName').focus(); $('#leName').select(); };
    $('#leDup').onclick = () => { const base = RW().normalize(edLayout()); const l = Object.assign({}, base, { id: uid(), name: base.name + ' (copy)', builtin: false }); S.widgetLayouts = (S.widgetLayouts || []).concat(l); edId = l.id; activate(l.id); drawEditor(); };
    $('#leDelete').onclick = () => { S.widgetLayouts = (S.widgetLayouts || []).filter((l) => l.id !== edId); if (S.widgetLayoutId === edId) S.widgetLayoutId = 'classic'; edId = S.widgetLayoutId; saveS(); sendLayout(); drawEditor(); };
    $('#leName').addEventListener('input', (e) => { const l = edLayout(); if (isCustom(l)) { l.name = e.target.value || 'Untitled'; saveS(); if (l.id === S.widgetLayoutId) sendLayout(); drawList(); } });
    $('#leWidth').addEventListener('input', (e) => patch({ width: Number(e.target.value) }));
    $('#leOffset').addEventListener('input', (e) => patch({ offset: Number(e.target.value) }));
    $('#leArtist').addEventListener('change', (e) => patch({ showArtist: e.target.checked }));
    $$('#leForm .seg').forEach((sg) => sg.addEventListener('click', (e) => { const b = e.composedPath()[0].closest('button'); if (b) patch({ [sg.dataset.k]: b.dataset.v }); }));
    $('#leAdd').addEventListener('click', (e) => { const b = e.composedPath()[0].closest('[data-add]'); if (b) patch({ items: RW().normalize(edLayout()).items.concat(b.dataset.add) }); });
    $('#leChips').addEventListener('click', (e) => { const b = e.composedPath()[0].closest('[data-rm]'); if (!b) return; const items = RW().normalize(edLayout()).items.slice(); items.splice(Number(b.dataset.rm), 1); if (items.length) patch({ items }); });
    // drag to reorder (pointer based — works regardless of the browser's drag & drop support)
    let drag = null;
    $('#leChips').addEventListener('pointerdown', (e) => {
      const t = e.composedPath()[0];
      const chip = t.closest && t.closest('.chip');
      if (!chip || t.closest('[data-rm]') || e.button !== 0) return;
      drag = { chip, from: Number(chip.dataset.i), x: e.clientX, y: e.clientY, active: false, over: null };
      chip.setPointerCapture(e.pointerId);
    });
    $('#leChips').addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.active && Math.hypot(dx, dy) < 4) return;
      drag.active = true;
      drag.chip.classList.add('dragging');
      drag.chip.style.transform = `translate(${dx}px, ${dy}px)`;
      drag.chip.style.pointerEvents = 'none';
      const under = root.elementFromPoint(e.clientX, e.clientY);
      const over = under && under.closest && under.closest('#leChips .chip');
      drag.over = over && over !== drag.chip ? over : null;
      $$('#leChips .chip').forEach((x) => x.classList.toggle('over', x === drag.over));
    });
    const endDrag = () => {
      if (!drag) return;
      const d = drag; drag = null;
      d.chip.style.transform = ''; d.chip.style.pointerEvents = '';
      $$('#leChips .chip').forEach((x) => x.classList.remove('dragging', 'over'));
      if (!d.active || !d.over) return;
      const to = Number(d.over.dataset.i);
      const items = RW().normalize(edLayout()).items.slice();
      const [m] = items.splice(d.from, 1);
      items.splice(to, 0, m);
      patch({ items });
    };
    $('#leChips').addEventListener('pointerup', endDrag);
    $('#leChips').addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', () => { if (!$('#layoutModal').hidden) drawPreview(); });
    drawList();

    $('#setTray').onchange = (e) => { S.closeToTray = e.target.checked; saveS(); invoke('res_set_close_to_tray', { value: S.closeToTray }).catch(() => {}); };

    // ---------- navigation ----------
    $$('.nav-item').forEach((b) => (b.onclick = () => R() && R().nav(b.dataset.nav)));
    root.addEventListener('click', (e) => {
      const t = e.composedPath()[0];
      if (!t.closest || Date.now() - (window.__resDragEnd || 0) < 250) return;
      const pl = t.closest('.pl-item');
      if (pl && R()) { R().nav({ browseId: pl.dataset.browse }); return; }
      const fh = t.closest('.pl-folder');
      if (fh) toggleFolder(fh.dataset.fid);
    });
    $('#btnBack').onclick = () => window.history.back();
    $('#btnFwd').onclick = () => window.history.forward();
    $('#btnReload').onclick = () => location.reload();
    function updateNav() {
      const u = new URL(location.href);
      const path = u.pathname, list = u.searchParams.get('list') || '';
      const which = path === '/' ? 'home' : path.startsWith('/explore') ? 'explore' : path.startsWith('/library') ? 'library' : '';
      $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.nav === which));
      const browse = list ? 'VL' + list : path.startsWith('/browse/') ? path.slice(8) : '';
      $$('.pl-item').forEach((b) => b.classList.toggle('active', !!browse && b.dataset.browse === browse));
      const nav = window.navigation;
      $('#btnBack').disabled = nav && 'canGoBack' in nav ? !nav.canGoBack : false;
      $('#btnFwd').disabled = nav && 'canGoForward' in nav ? !nav.canGoForward : false;
    }

    // ---------- search ----------
    const input = $('#searchInput');
    $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q && R()) { R().search(q); input.blur(); } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; input.blur(); } });

    // ---------- playlists ----------
    let plKey = '';
    let plData = new Map();
    async function refreshPlaylists() {
      if (!R() || (document.hidden && plData.size)) return;
      let list = [];
      try { list = await R().playlists(); } catch (e) { return; }
      const items = (list || []).filter((p) => p.id !== 'VLLM');
      const k = JSON.stringify(items);
      if (k === plKey) return;
      plKey = k;
      $('#plEmpty').hidden = items.length > 0;
      plData = new Map(items.map((p) => [p.id, p]));
      try { localStorage.setItem('res-cache-pl', JSON.stringify(items.slice(0, 300))); } catch (e) {}
      renderSidebar();
      updateNav();
    }
    // start-up: show the playlists from last time straight away, refresh them once YouTube Music is ready
    setTimeout(() => {
      if (plData.size) return;
      try {
        const c = JSON.parse(localStorage.getItem('res-cache-pl') || 'null');
        if (Array.isArray(c) && c.length) { plData = new Map(c.map((p) => [p.id, p])); $('#plEmpty').hidden = true; renderSidebar(); }
      } catch (e) {}
    }, 0);
    setTimeout(refreshPlaylists, 1000);
    setTimeout(refreshPlaylists, 2500);
    setInterval(refreshPlaylists, 8000);

    // ---------- sliders ----------
    function makeSlider(el, { onInput, onCommit }) {
      let dragging = false;
      const pct = (e) => { const r = el.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
      // only touch the page when the value really moves (0.1%), so the progress bar doesn't relayout every frame
      let cur = '';
      const set = (p) => { const v = (Math.min(1, Math.max(0, p)) * 100).toFixed(1) + '%'; if (v !== cur) { cur = v; el.style.setProperty('--p', v); } };
      el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; dragging = true; el.setPointerCapture(e.pointerId); el.classList.add('drag'); const p = pct(e); set(p); onInput && onInput(p); });
      el.addEventListener('pointermove', (e) => { if (!dragging) return; const p = pct(e); set(p); onInput && onInput(p); });
      el.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; el.classList.remove('drag'); const p = pct(e); set(p); onCommit && onCommit(p); });
      el.addEventListener('lostpointercapture', () => { dragging = false; el.classList.remove('drag'); });
      return { set, get dragging() { return dragging; } };
    }
    let state = null, base = { t: 0, at: 0 };
    const seek = makeSlider($('#seek'), {
      onInput: (p) => { if (state) $('#tCur').textContent = fmt(p * state.duration); },
      onCommit: (p) => { if (state && state.duration) { const t = p * state.duration; base = { t, at: performance.now() }; cmd('seek', t); } },
    });
    let lastVol = 0;
    const setVolIcon = (v, muted) => { setIcon($('#btnMute'), muted || v === 0 ? 'volOff' : v < 50 ? 'volLow' : 'vol'); };
    // volHold: for a moment after the user moves the volume, the slider shows what they chose,
    // not what the player reports (it can lag behind and made the knob jump back).
    let volHold = 0, volWant = 0;
    const setVol = (v) => { volWant = Math.max(0, Math.min(100, Math.round(v))); volHold = Date.now() + 1500; if (state) { state.volume = volWant; state.muted = false; } cmd('volume', volWant); };
    const vol = makeSlider($('#vol'), {
      onInput: (p) => { const now = Date.now(); volHold = now + 1500; if (now - lastVol > 60) { lastVol = now; setVol(p * 100); } setVolIcon(p * 100, false); },
      onCommit: (p) => { setVol(p * 100); setVolIcon(p * 100, false); },
    });
    $('#vol').addEventListener('wheel', (e) => {
      e.preventDefault();
      const nv = Math.max(0, Math.min(100, (state ? state.volume : 50) + (e.deltaY < 0 ? 5 : -5)));
      vol.set(nv / 100); setVol(nv); setVolIcon(nv, false);
    }, { passive: false });

    // ---------- controls ----------
    $('#btnPlay').onclick = () => {
      if (!(state && state.hasTrack) && !(R() && R().last && R().last())) { toast('Pick a song, album or playlist to start'); return; }
      if (!(state && state.hasTrack)) toast('Continuing where you left off…');
      cmd('toggle');
    };
    $('#btnNext').onclick = () => cmd('next');
    $('#btnPrev').onclick = () => cmd('prev');
    $('#btnShuffle').onclick = () => {
      const on = !(state && state.shuffle);
      cmd('shuffle', on);
      toast(on ? 'Shuffle on' : (state && state.inPlaylist ? 'Shuffle off — back to playlist order' : 'Shuffle off'));
    };
    $('#btnRepeat').onclick = () => cmd('repeat');
    $('#btnMute').onclick = () => cmd('mute');
    $('#btnLike').onclick = () => { cmd('like'); const b = $('#btnLike'); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); };
    $('#btnPlayerPage').onclick = () => cmd('playerPage');
    $('#miniX').onclick = () => { cmd('hideMini'); $('#miniX').hidden = true; toast('Mini player hidden — open the full player to bring it back'); };
    $$('#avSeg button').forEach((b) => (b.onclick = () => {
      const mode = b.dataset.av;
      S.avMode = mode; saveS(); avAppliedFor = trackKey;
      cmd('av', mode);
      if (mode === 'video' && state && !state.playerPageOpen) setTimeout(() => cmd('playerPage'), 250);
      $$('#avSeg button').forEach((x) => x.classList.toggle('on', x === b));
    }));
    $('#pbTitle').onclick = () => cmd('playerPage');
    $('#pbArtist').onclick = () => { if (state && state.artistId && R()) R().nav({ browseId: state.artistId }); };
    const setNp = (open) => { S.npOpen = open; saveS(); layout(); if (open) { refreshQueue(); if (npTab === 'lyrics') loadLyrics(); } };
    $('#btnQueue').onclick = () => setNp(!S.npOpen);
    $('#pbArtBtn').onclick = () => setNp(!S.npOpen);
    $('#btnCloseNp').onclick = () => setNp(false);

    // ---------- tint ----------
    let lastArtForColor = '';
    let curTint = null;
    function setTint(rgb) {
      curTint = rgb || null;
      const v = rgb ? rgb.join(', ') : '70, 50, 110';
      wrap.style.setProperty('--tint', v);
      if (R()) R().setTint(rgb);
    }

    // ---------- render loop ----------
    let lastAvatar = '';
    let trackKey = null, sentKey = '', avAppliedFor = '', lastSentAt = 0, lastSentTime = 0;
    function poll() {
      if (!R()) return;
      let s;
      try { s = R().state(); } catch (e) { return; }
      render(s);
    }
    function render(s) {
      const prevUrl = state && state.url;
      state = s;
      try { trimCheck(s); } catch (e) {}
      const has = s.hasTrack;
      setIcon($('#btnPlay'), s.playing ? 'pause' : 'play');
      $('#btnPlay').title = s.playing ? 'Pause' : 'Play';

      const key = has ? `${s.title}|${s.artist}` : '';
      if (key !== trackKey) {
        trackKey = key;
        const title = has ? s.title : 'Nothing playing';
        $('#pbTitle').textContent = title; $('#pbTitle').title = title;
        $('#pbArtist').textContent = has ? s.artist : '';
        $('#npTitle').textContent = title;
        $('#npArtist').textContent = has ? [s.artist, s.album].filter(Boolean).join(' • ') : 'Pick something to start';
        if (!has) {
          $('#pbArt').removeAttribute('src'); $('#npArt').removeAttribute('src');
          const last = R() && R().last ? R().last() : null;
          if (last && last.title && S.showResume !== false) {
            $('#pbTitle').textContent = last.title; $('#pbTitle').title = 'Press play to continue where you left off';
            $('#pbArtist').textContent = 'Continue · ' + (last.artist || '');
            if (last.art) $('#pbArt').src = last.art;
          }
        }
        else setTimeout(refreshQueue, 600);
      }
      if (has && s.art && $('#pbArt').getAttribute('src') !== s.art) { $('#pbArt').src = s.art; $('#npArt').src = s.art; }
      if (has && s.art && s.art !== lastArtForColor) {
        lastArtForColor = s.art;
        const art = s.art;
        invoke('res_dominant_color', { url: art }).then((rgb) => { if (rgb && state && state.art === art) { songTint = rgb; if (S.colorMode === 'song') applyColor(); } }).catch(() => {});
      }

      const liked = s.like === 'LIKE';
      const lb = $('#btnLike');
      lb.classList.toggle('on', liked);
      setIcon(lb, liked ? 'heartFill' : 'heart');
      lb.title = liked ? 'Remove from Liked Music' : 'Save to Liked Music';
      lb.style.visibility = has ? '' : 'hidden';

      $('#btnShuffle').classList.toggle('active', !!s.shuffle);
      $('#btnShuffle').title = s.shuffle ? 'Shuffle: on' : 'Shuffle: off';
      const rep = s.repeat || 'NONE';
      $('#btnRepeat').classList.toggle('active', rep !== 'NONE');
      setIcon($('#btnRepeat'), rep === 'ONE' ? 'repeatOne' : 'repeat');

      $('#seek').classList.toggle('disabled', !has || !s.duration);
      wrap.classList.toggle('resume-hint', !has);
      if (S.timeMode !== 'remaining' || !has) $('#tDur').textContent = fmt(s.duration);
      if (!seek.dragging) base = { t: s.time, at: performance.now() };
      if (!vol.dragging && Date.now() > volHold) { vol.set((s.muted ? 0 : s.volume) / 100); setVolIcon(s.volume, s.muted); }

      const av = s.av || {};
      $('#avSeg').hidden = !has;
      if (av.mode) $$('#avSeg button').forEach((x) => x.classList.toggle('on', x.dataset.av === av.mode));
      // remember the user's choice and re-apply it when a new track starts
      if (has && S.avMode && av.mode && av.mode !== S.avMode && key !== avAppliedFor) { avAppliedFor = key; cmd('av', S.avMode); }
      const mx = $('#miniX');
      if (s.mini && !s.playerPageOpen) {
        mx.hidden = false;
        mx.style.left = Math.round(s.mini.x + s.mini.w - 34) + 'px';
        mx.style.top = Math.round(s.mini.y + 6) + 'px';
      } else mx.hidden = true;
      $('#btnPlayerPage').classList.toggle('active', !!s.playerPageOpen);
      setIcon($('#btnPlayerPage'), s.playerPageOpen ? 'collapse' : 'expand');

      if (s.avatar && s.avatar !== lastAvatar) { lastAvatar = s.avatar; updatePfp(); }
      if (s.url !== prevUrl) { updateNav(); updateAuthUI(); }

      try { extraRender(s, has, key); } catch (e) {}
      const sk = `${s.playing}|${key}`;
      const sk2 = sk + '|' + (curTint ? curTint.join(',') : '') + '|' + (s.art || '') + '|' + s.like + '|' + Math.round(s.duration || 0) + '|' + !!s.shuffle + '|' + (s.muted ? 0 : s.volume);
      const due = (S.taskbarWidget || S.discord || S.remote) && Date.now() - lastSentAt > 3000;
      if (sk2 !== sentKey || due || Math.abs((s.time || 0) - lastSentTime - (Date.now() - lastSentAt) / 1000 * (s.playing ? 1 : 0)) > 3) {
        sentKey = sk2; lastSentAt = Date.now(); lastSentTime = s.time || 0;
        const last = !has && R() && R().last ? R().last() : null;
        invoke('res_player_state', {
          playing: !!s.playing,
          title: has ? s.title : last ? last.title : '',
          artist: has ? s.artist : last ? 'Continue · ' + (last.artist || '') : '',
          art: has ? s.art || null : last ? last.art || null : null,
          tint: curTint, time: has ? s.time || 0 : 0, duration: has ? s.duration || 0 : 0, like: s.like || null, shuffle: !!s.shuffle,
          volume: s.muted ? 0 : (s.volume == null ? null : s.volume),
        }).catch(() => {});
      }
    }
    setInterval(poll, 400);
    applyPrefs();
    updatePfp();
    $('#tDur').addEventListener('click', () => { S.timeMode = S.timeMode === 'remaining' ? 'elapsed' : 'remaining'; saveS(); if (state) $('#tDur').textContent = fmt(state.duration); });

    // ---------- start page ----------
    if (location.pathname === '/' && !sessionStorage.getItem('res-started')) {
      try { sessionStorage.setItem('res-started', '1'); } catch (e) {}
      const sp = S.startPage;
      if (sp && sp !== 'home') setTimeout(() => { if (!R()) return; if (sp === 'liked') R().nav({ browseId: 'VLLM' }); else R().nav(sp); }, 1200);
    }


    // =================================================================
    // Extras: lyrics, sleep timer, mini mode, stats, shortcuts, Discord,
    // updates, backup/restore, theme, splash
    // =================================================================
    let hkRecording = null;
    const fmtDur = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h} h ${m} min` : m ? `${m} min` : `${sec} s`; };

    // ---------- splash (until YouTube Music has drawn something) ----------
    const splash = $('#splash');
    const splashT0 = Date.now();
    const splashIv = setInterval(() => {
      const ready = [...document.querySelectorAll('ytmusic-browse-response, ytmusic-search-page, ytmusic-section-list-renderer')].some((e) => e.getBoundingClientRect().height > 120);
      if (ready || !$('#login').hidden || Date.now() - splashT0 > 9000) {
        clearInterval(splashIv);
        splash.classList.add('out');
        setTimeout(() => (splash.hidden = true), 450);
      }
    }, 250);

    // ---------- theme follows the system when set to "System" ----------
    if (window.matchMedia) matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (S.theme === 'system') applyPrefs(); });

    // ---------- lyrics ----------
    let npTab = 'queue', lyr = { key: null, lines: [], synced: false, status: '' }, lyrUserScroll = 0, lyrIdx = -1;
    $$('.np-tabs button').forEach((b) => (b.onclick = () => setNpTab(b.dataset.np)));
    function setNpTab(t) {
      npTab = t;
      $$('.np-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.np === t));
      $('#queue').hidden = t !== 'queue';
      $('#lyrics').hidden = t !== 'lyrics';
      if (t === 'lyrics') loadLyrics();
    }
    const cleanTitle = (t) => String(t || '')
      .replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|visuali[sz]er|remaster|hd|4k|mv|explicit|live)[^\)\]]*[\)\]]/gi, '')
      .replace(/\s*[-–]\s*(official|lyric|audio).*$/i, '').replace(/\s+(ft|feat)\.?\s.*$/i, '').trim();
    // LRC, including "enhanced" LRC with per-word times: [00:12.00]<00:12.00>Hello <00:12.40>world
    function parseLrc(txt) {
      const out = [];
      for (const line of String(txt).split(/\r?\n/)) {
        const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
        const body = line.replace(/\[[^\]]*\]/g, '');
        let words = null;
        if (/<\d+:\d+(?:\.\d+)?>/.test(body)) {
          words = [];
          const re = /<(\d+):(\d+(?:\.\d+)?)>([^<]*)/g;
          let m;
          while ((m = re.exec(body))) { const w = m[3].trim(); if (w) words.push({ t: Number(m[1]) * 60 + Number(m[2]), w }); }
          if (!words.length) words = null;
        }
        const text = (words ? words.map((w) => w.w).join(' ') : body.replace(/<[^>]*>/g, '')).trim();
        for (const m of tags) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text, words });
      }
      return out.sort((a, b) => a.t - b.t);
    }
    const kOn = () => lyr.synced && (S.karaoke === 'always' || (S.karaoke !== 'off' && lyr.wordTimed));
    function lineInner(l) {
      if (!l.text) return '♪';
      if (!kOn()) return esc(l.text);
      return (l.words ? l.words.map((w) => w.w) : l.text.split(/\s+/)).map((w) => `<span class="kw">${esc(w)}</span>`).join(' ');
    }
    // start/end time of each word of line i (real word times, or estimated across the line)
    function kTimes(i) {
      const l = lyr.lines[i];
      if (l._k) return l._k;
      const next = lyr.lines[i + 1];
      const end = next ? next.t : l.t + 5;
      if (l.words) {
        l._k = l.words.map((w, j) => [w.t, j + 1 < l.words.length ? l.words[j + 1].t : Math.min(end, w.t + 1.4)]);
      } else {
        const ws = l.text.split(/\s+/), total = ws.reduce((a, w) => a + w.length + 1, 0);
        const span = Math.min((end - l.t) * 0.9, total * 0.085 + 0.8);
        let at = l.t;
        l._k = ws.map((w) => { const d = span * ((w.length + 1) / total); const r = [at, at + d]; at += d; return r; });
      }
      return l._k;
    }
    function kFill(row, i, t) {
      if (!row || i < 0) return;
      const spans = row.getElementsByClassName(row.tagName === 'DIV' && row.classList.contains('res-ply') ? 'res-kw' : 'kw');
      if (!spans.length) return;
      const k = kTimes(i);
      for (let j = 0; j < spans.length && j < k.length; j++) {
        const p = Math.max(0, Math.min(1, (t - k[j][0]) / Math.max(0.05, k[j][1] - k[j][0])));
        const v = (p * 100).toFixed(0) + '%';
        if (spans[j].style.getPropertyValue('--k') !== v) spans[j].style.setProperty('--k', v);
      }
    }
    function drawLyrics() {
      const el = $('#lyrics');
      if (lyr.status === 'loading') { setHTML(el, '<div class="lib-empty">Looking for lyrics…</div>'); return; }
      if (!lyr.lines.length) { setHTML(el, `<div class="lib-empty">${esc(lyr.status || 'No lyrics found for this song.')}</div>`); return; }
      setHTML(el, lyr.lines.map((l, i) => `<div class="ly-line${lyr.synced ? '' : ' static'}" data-i="${i}">${lineInner(l)}${lyr.roman && lyr.roman[i] ? `<span class="ly-rm">${esc(lyr.roman[i])}</span>` : ''}${lyr.trans && lyr.trans[i] && l.text ? `<span class="ly-tr">${esc(lyr.trans[i])}</span>` : ''}</div>`).join('') +
        `<div class="ly-credit">${lyr.synced ? 'Synced lyrics' : 'Lyrics'} from ${esc(lyr.source)}${lyr.credit ? ' · ' + esc(lyr.credit) : ''}</div>`);
      lyrIdx = -1;
    }
    async function loadLyrics() {
      const wanted = (S.npOpen && npTab === 'lyrics') || (state && state.playerPageOpen) || fsOn;
      if (!wanted || !state || !state.hasTrack) { if (state && !state.hasTrack) { lyr = { key: null, lines: [], status: 'Play something to see its lyrics.' }; drawLyrics(); } return; }
      const key = state.title + '|' + state.artist;
      if (lyr.key === key) return;
      lyr = { key, lines: [], synced: false, status: 'loading' };
      drawLyrics();
      const s0 = state;
      let res = null;
      try { res = await invoke('res_lyrics', { artist: s0.artist || '', title: cleanTitle(s0.title), album: s0.album || '', duration: s0.duration || 0 }); } catch (e) { res = null; }
      if (lyr.key !== key) return;
      if (res && res.synced) { const lines = parseLrc(res.synced); lyr = { key, synced: true, lines, wordTimed: lines.some((l) => l.words), source: 'LRCLIB' }; }
      else if (res && res.instrumental) lyr = { key, lines: [], status: 'This song is instrumental.' };
      else if (res && res.plain) lyr = { key, synced: false, lines: res.plain.split(/\r?\n/).map((t) => ({ t: 0, text: t })), source: 'LRCLIB' };
      else {
        const y = s0.videoId && R() ? await R().lyricsYT(s0.videoId) : null;
        if (lyr.key !== key) return;
        if (y) lyr = { key, synced: false, lines: y.plain.split(/\r?\n/).map((t) => ({ t: 0, text: t })), source: 'YouTube Music', credit: y.credit };
        else lyr = { key, lines: [], status: 'No lyrics found for this song.' };
      }
      drawLyrics();
      fsDrawLyrics();
      translateLyrics();
    }
    $('#lyrics').addEventListener('click', (e) => { const l = e.composedPath()[0].closest('.ly-line'); if (l && lyr.synced) { const t = lyr.lines[Number(l.dataset.i)].t; cmd('seek', Math.max(0, t - 0.15)); lyrUserScroll = 0; } });
    $('#lyrics').closest('.np-scroll').addEventListener('wheel', () => { lyrUserScroll = Date.now(); }, { passive: true });
    function lyricsTick(t) {
      if (!lyr.synced || $('#lyrics').hidden || !S.npOpen) return;
      let i = -1;
      for (let k = 0; k < lyr.lines.length; k++) { if (lyr.lines[k].t <= t + 0.25) i = k; else break; }
      if (kOn()) kFill($(`#lyrics .ly-line[data-i="${i}"]`), i, t + 0.1);
      if (i === lyrIdx) return;
      lyrIdx = i;
      $$('#lyrics .ly-line').forEach((el, k) => { el.classList.toggle('on', k === i); el.classList.toggle('past', k < i); });
      const cur = $(`#lyrics .ly-line[data-i="${i}"]`);
      if (cur && Date.now() - lyrUserScroll > 4000) {
        const sc = $('#lyrics').closest('.np-scroll');
        sc.scrollTo({ top: cur.offsetTop - sc.clientHeight * 0.38, behavior: 'smooth' });
      }
    }

    // ---------- synced lyrics inside YouTube Music's full player (its Lyrics tab) ----------
    let pageLy = { el: null, key: null, idx: -1, lastCheck: 0, userScroll: 0 };
    function lyricsTabEl() {
      const page = document.querySelector('ytmusic-player-page');
      if (!page) return null;
      const shelf = page.querySelector('ytmusic-description-shelf-renderer, ytmusic-message-renderer');
      const tab = page.querySelector('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') || (shelf && shelf.closest('ytmusic-tab-renderer'));
      if (!tab || tab.hidden || tab.getBoundingClientRect().width < 50) return null;
      return tab;
    }
    function scrollParent(el) {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowY;
        if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 4) return p;
      }
      return null;
    }
    function removePageLyrics() {
      if (pageLy.el) { const tab = pageLy.el.parentElement; pageLy.el.remove(); if (tab) tab.classList.remove('res-synced'); }
      pageLy = { el: null, key: null, idx: -1, lastCheck: pageLy.lastCheck, userScroll: 0 };
    }
    function pageLyricsTick(t) {
      const now = performance.now();
      if (!state || !state.playerPageOpen || !lyr.synced || !lyr.lines.length) { if (pageLy.el) removePageLyrics(); return; }
      if (now - pageLy.lastCheck > 300 || !pageLy.el || !pageLy.el.isConnected) {
        pageLy.lastCheck = now;
        const tab = lyricsTabEl();
        if (!tab) { if (pageLy.el) removePageLyrics(); return; }
        if (!pageLy.el || pageLy.el.parentElement !== tab || pageLy.key !== lyr.key + (lyr.trans ? '#t' : '') + (lyr.roman ? '#r' : '') + (kOn() ? '#k' : '')) {
          if (pageLy.el) pageLy.el.remove();
          const box = document.createElement('div');
          box.id = 'res-page-lyrics';
          lyr.lines.forEach((l, i) => {
            const d = document.createElement('div');
            d.className = 'res-ply';
            d.dataset.i = String(i);
            if (kOn() && l.text) {
              (l.words ? l.words.map((w) => w.w) : l.text.split(/\s+/)).forEach((w, j) => { if (j) d.appendChild(document.createTextNode(' ')); const sp = document.createElement('span'); sp.className = 'res-kw'; sp.textContent = w; d.appendChild(sp); });
            } else d.textContent = l.text || '♪';
            if (lyr.roman && lyr.roman[i]) { const rm = document.createElement('span'); rm.className = 'res-ply-rm'; rm.textContent = lyr.roman[i]; d.appendChild(rm); }
            if (lyr.trans && lyr.trans[i] && l.text) { const tr = document.createElement('span'); tr.className = 'res-ply-tr'; tr.textContent = lyr.trans[i]; d.appendChild(tr); }
            box.appendChild(d);
          });
          const cr = document.createElement('div');
          cr.className = 'res-ply-credit';
          cr.textContent = 'Synced lyrics from ' + (lyr.source || 'LRCLIB');
          box.appendChild(cr);
          box.addEventListener('click', (e) => { const d = e.target.closest && e.target.closest('.res-ply'); if (d) { cmd('seek', Math.max(0, lyr.lines[Number(d.dataset.i)].t - 0.15)); pageLy.userScroll = 0; } });
          box.addEventListener('wheel', () => { pageLy.userScroll = Date.now(); }, { passive: true });
          tab.insertBefore(box, tab.firstChild);
          tab.classList.add('res-synced');
          pageLy.el = box; pageLy.key = lyr.key + (lyr.trans ? '#t' : '') + (lyr.roman ? '#r' : '') + (kOn() ? '#k' : ''); pageLy.idx = -1;
        }
      }
      let i = -1;
      for (let k = 0; k < lyr.lines.length; k++) { if (lyr.lines[k].t <= t + 0.25) i = k; else break; }
      if (kOn() && pageLy.el) kFill(pageLy.el.children[i], i, t + 0.1);
      if (i === pageLy.idx) return;
      pageLy.idx = i;
      const rows = pageLy.el.children;
      for (let k = 0; k < lyr.lines.length; k++) { rows[k].classList.toggle('on', k === i); rows[k].classList.toggle('past', k < i); }
      const cur = rows[i];
      if (cur && Date.now() - pageLy.userScroll > 4000) {
        const sc = scrollParent(pageLy.el);
        if (sc) {
          const top = cur.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
          sc.scrollTo({ top: top - sc.clientHeight * 0.38, behavior: 'smooth' });
        }
      }
    }

    // ---------- sleep timer ----------
    let sleep = null; // { mode: 'min'|'end', until, key, origVol }
    const pop = $('#sleepPop');
    function placePop(anchor) {
      pop.hidden = false;
      const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight - 90, width: 0 };
      const pr = pop.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(innerWidth - pr.width - 8, r.left + r.width / 2 - pr.width / 2)) + 'px';
      pop.style.top = Math.max(8, r.top - pr.height - 10) + 'px';
    }
    function sleepLabel() {
      if (!sleep) return 'Off';
      if (sleep.mode === 'end') return 'Stops at the end of this song';
      return 'Stops in ' + fmtDur(Math.max(0, (sleep.until - Date.now()) / 1000));
    }
    function updateSleepUI() {
      $('#sleepStatus').textContent = sleepLabel();
      $('#btnSleep').classList.toggle('active', !!sleep);
      const b = $('#sleepBadge');
      b.hidden = !sleep;
      if (sleep) b.textContent = sleep.mode === 'end' ? '♪' : String(Math.max(1, Math.ceil((sleep.until - Date.now()) / 60000)));
      $('#sleepOff').hidden = !sleep;
    }
    function setSleep(v) {
      if (sleep && sleep.origVol != null) cmd('volume', sleep.origVol);
      if (v === 'end') sleep = { mode: 'end', key: trackKey };
      else if (v) sleep = { mode: 'min', until: Date.now() + Number(v) * 60000 };
      else sleep = null;
      updateSleepUI();
      if (sleep) toast(sleep.mode === 'end' ? 'Sleep timer: stops after this song' : 'Sleep timer: ' + fmtDur(Number(v) * 60));
    }
    function sleepFire() {
      const orig = sleep && sleep.origVol;
      sleep = null;
      cmd('pause');
      if (orig != null) setTimeout(() => cmd('volume', orig), 600);
      updateSleepUI();
      toast('Sleep timer: playback paused');
    }
    $('#btnSleep').onclick = (e) => { e.stopPropagation(); if (pop.hidden) { updateSleepUI(); placePop($('#btnSleep')); } else pop.hidden = true; };
    pop.addEventListener('click', (e) => { const b = e.composedPath()[0].closest('[data-min]'); if (b) { setSleep(b.dataset.min); pop.hidden = true; } });
    $('#sleepOff').onclick = () => { setSleep(null); pop.hidden = true; toast('Sleep timer off'); };
    document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !e.composedPath().includes(pop) && !e.composedPath().includes($('#btnSleep'))) pop.hidden = true; }, true);
    setInterval(() => {
      if (!sleep || !state) return;
      let left = Infinity;
      if (sleep.mode === 'min') left = (sleep.until - Date.now()) / 1000;
      else if (state.hasTrack && trackKey === sleep.key && state.duration) left = state.duration - state.time - 0.8;
      else if (trackKey !== sleep.key) left = 0; // song already changed
      if (S.sleepFade !== false && left <= 30 && left > 0 && state.playing) {
        if (sleep.origVol == null) sleep.origVol = state.muted ? 0 : state.volume;
        cmd('volume', Math.round(sleep.origVol * Math.max(0.05, left / 30)));
      }
      if (left <= 0) sleepFire();
      else updateSleepUI();
    }, 1000);

    // ---------- mini mode (small always-on-top window) ----------
    let miniOn = false;
    function setMini(on) {
      miniOn = on;
      $('#miniDevP').hidden = true; $('#devPop').hidden = true; $('#remotePop').hidden = true;
      zoomHold = on;
      { const z = on ? 1 : Number(S.uiScale) || 1; if (z !== appliedZoom) { appliedZoom = z; invoke('res_win', { action: 'zoom:' + z }).catch(() => {}); } }
      $('#mini').hidden = !on;
      wrap.classList.toggle('mini-mode', on);
      invoke('res_win', { action: on ? 'mini_on' : 'mini_off' }).catch(() => {});
      if (on) { closeMenu(); closeCtx(); pop.hidden = true; $$('.backdrop').forEach((m) => (m.hidden = true)); }
    }
    $('#btnMini').onclick = () => setMini(true);
    $('#miniExit').onclick = () => setMini(false);
    $('#miniClose').onclick = () => win('close');
    $('#miniPlay').onclick = () => $('#btnPlay').click();
    $('#miniPrev').onclick = () => cmd('prev');
    $('#miniNext').onclick = () => cmd('next');
    $('#miniLike').onclick = () => $('#btnLike').click();
    $('#miniShuffle').onclick = () => $('#btnShuffle').click();
    $('#mini').addEventListener('mousedown', (e) => { if (e.button === 0 && !e.composedPath()[0].closest('button, .mini-prog')) { if (e.detail === 2) setMini(false); else win('drag'); } });
    $('#mini').addEventListener('wheel', (e) => { if (!$('#miniDevP').hidden) return; e.preventDefault(); cmd(e.deltaY < 0 ? 'volUp' : 'volDown'); }, { passive: false });
    $('#miniProg').addEventListener('click', (e) => { const r = $('#miniProg').getBoundingClientRect(); if (state && state.duration) cmd('seek', ((e.clientX - r.left) / r.width) * state.duration); });

    // ---------- listening stats (stored only on this PC) ----------
    const STATS_KEY = 'res-stats';
    let stats = { v: 1, days: {}, meta: {} };
    try { Object.assign(stats, JSON.parse(localStorage.getItem(STATS_KEY) || '{}')); } catch (e) {}
    let statLast = 0, statDirty = false, statTrack = { key: '', secs: 0, counted: false };
    const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    function statAdd(s, key, dt) {
      const day = (stats.days[today()] = stats.days[today()] || { t: 0, s: {}, a: {}, p: {} });
      day.t += dt;
      day.s[key] = (day.s[key] || 0) + dt;
      const artist = s.artist || 'Unknown artist';
      day.a[artist] = (day.a[artist] || 0) + dt;
      stats.meta[key] = [s.title, artist, s.art || ''];
      if (statTrack.key !== key) statTrack = { key, secs: 0, counted: false };
      statTrack.secs += dt;
      if (!statTrack.counted && statTrack.secs >= 30) { statTrack.counted = true; day.p[key] = (day.p[key] || 0) + 1; historyAdd(s); }
      statDirty = true;
    }
    function statsSave() {
      if (!statDirty) return;
      statDirty = false;
      const keys = Object.keys(stats.days).sort();
      while (keys.length > 400) delete stats.days[keys.shift()];
      try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
    }
    setInterval(statsSave, 15000);
    window.addEventListener('beforeunload', statsSave);
    function statsRange(n) {
      const from = new Date(); from.setDate(from.getDate() - (n - 1));
      const fromKey = from.toISOString().slice(0, 10);
      const agg = { t: 0, s: {}, a: {}, p: {}, days: [] };
      for (const [d, v] of Object.entries(stats.days)) {
        if (d < fromKey) continue;
        agg.t += v.t; agg.days.push([d, v.t]);
        for (const [k, x] of Object.entries(v.s)) agg.s[k] = (agg.s[k] || 0) + x;
        for (const [k, x] of Object.entries(v.a)) agg.a[k] = (agg.a[k] || 0) + x;
        for (const [k, x] of Object.entries(v.p || {})) agg.p[k] = (agg.p[k] || 0) + x;
      }
      return agg;
    }
    let statsN = 7;
    function drawStats() {
      const a = statsRange(statsN);
      const songs = Object.entries(a.s).sort((x, y) => y[1] - x[1]).slice(0, 10);
      const artists = Object.entries(a.a).sort((x, y) => y[1] - x[1]).slice(0, 8);
      const plays = Object.values(a.p).reduce((x, y) => x + y, 0);
      // per-day (7/30) or per-month (year) bars
      const buckets = [];
      if (statsN <= 30) {
        for (let i = statsN - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = d.toISOString().slice(0, 10); buckets.push([statsN === 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : String(d.getDate()), (stats.days[k] || {}).t || 0]); }
      } else {
        for (let i = 11; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i, 1); const pre = d.toISOString().slice(0, 7); buckets.push([d.toLocaleDateString(undefined, { month: 'short' }), a.days.filter(([k]) => k.startsWith(pre)).reduce((x, [, v]) => x + v, 0)]); }
      }
      const max = Math.max(1, ...buckets.map((b) => b[1]));
      const maxSong = songs.length ? songs[0][1] : 1, maxArt = artists.length ? artists[0][1] : 1;
      setHTML($('#statsBody'), !a.t ? '<div class="lib-empty">No listening recorded in this period yet — play some music!</div>' : `
        <div class="st-cards">
          <div class="st-card"><div class="st-big">${esc(fmtDur(a.t))}</div><div class="st-lbl">listened</div></div>
          <div class="st-card"><div class="st-big">${plays}</div><div class="st-lbl">plays</div></div>
          <div class="st-card"><div class="st-big">${Object.keys(a.s).length}</div><div class="st-lbl">different songs</div></div>
          <div class="st-card"><div class="st-big">${Object.keys(a.a).length}</div><div class="st-lbl">artists</div></div>
        </div>
        <div class="st-chart">${buckets.map(([l, v]) => `<div class="st-col" title="${esc(l)}: ${esc(fmtDur(v))}"><div class="st-bar" style="height:${Math.max(2, (v / max) * 100)}%"></div><span>${esc(l)}</span></div>`).join('')}</div>
        <div class="st-cols">
          <div><h3>Top songs</h3>${songs.map(([k, v], i) => { const m = stats.meta[k] || [k, '', '']; return `<div class="st-row"><span class="st-n">${i + 1}</span>${m[2] ? `<img src="${esc(m[2])}" alt="">` : '<i class="st-ph"></i>'}<div class="st-meta"><div class="st-t">${esc(m[0])}</div><div class="st-s">${esc(m[1])} · ${esc(fmtDur(v))}</div><div class="st-track"><b style="width:${(v / maxSong) * 100}%"></b></div></div></div>`; }).join('')}</div>
          <div><h3>Top artists</h3>${artists.map(([k, v], i) => `<div class="st-row"><span class="st-n">${i + 1}</span><div class="st-meta"><div class="st-t">${esc(k)}</div><div class="st-s">${esc(fmtDur(v))}</div><div class="st-track"><b style="width:${(v / maxArt) * 100}%"></b></div></div></div>`).join('')}</div>
        </div>`);
    }
    function openStats() { closeMenu(); closeCtx(); $('#settingsModal').hidden = true; statsSave(); drawStats(); $('#statsModal').hidden = false; }
    $('#miStats').onclick = openStats;
    $('#stOpenStats').onclick = openStats;
    $('#statsRange').addEventListener('click', (e) => { const b = e.composedPath()[0].closest('[data-r]'); if (!b) return; statsN = Number(b.dataset.r); $$('#statsRange button').forEach((x) => x.classList.toggle('on', x === b)); drawStats(); });
    $('#stClearStats').onclick = () => { if (!$('#stClearStats').dataset.sure) { $('#stClearStats').dataset.sure = '1'; $('#stClearStats').textContent = 'Click again to clear'; setTimeout(() => { delete $('#stClearStats').dataset.sure; $('#stClearStats').textContent = 'Clear'; }, 3000); return; } stats = { v: 1, days: {}, meta: {} }; statDirty = true; statsSave(); delete $('#stClearStats').dataset.sure; $('#stClearStats').textContent = 'Clear'; toast('Listening stats cleared'); syncExtras(); };

    // ---------- global shortcuts ----------
    const HK = [['palette', 'Command box (from any app)'], ['toggle', 'Play / pause'], ['next', 'Next song'], ['prev', 'Previous song'], ['volUp', 'Volume up'], ['volDown', 'Volume down'], ['like', 'Like / unlike'], ['shuffle', 'Shuffle on/off'], ['mute', 'Mute'], ['show', 'Show / hide Resonance']];
    let hkFailed = {};
    const KEYNAME = { ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Control: 'Ctrl', Super: 'Win', Escape: 'Esc' };
    const prettyKey = (acc) => !acc ? 'Not set' : acc.split('+').map((p) => KEYNAME[p] || p.replace(/^Key/, '').replace(/^Digit/, '')).join(' + ');
    function drawHotkeys() {
      setHTML($('#hkList'), HK.map(([a, label]) => `<div class="setting"><div><div class="s-title">${esc(label)}</div>${hkFailed[a] ? `<div class="s-sub warn">${esc(hkFailed[a])}</div>` : ''}</div>
        <button class="hk${hkRecording === a ? ' rec' : ''}${S.hotkeys[a] ? '' : ' empty'}" data-hk="${a}">${hkRecording === a ? 'Press keys…' : esc(prettyKey(S.hotkeys[a]))}</button></div>`).join(''));
    }
    function applyHotkeys() {
      const map = {};
      for (const [a] of HK) if (S.hotkeys[a]) map[a] = S.hotkeys[a];
      invoke('res_set_hotkeys', { map }).then((f) => { hkFailed = f || {}; if (!$('[data-pane=shortcuts]').hidden) drawHotkeys(); }).catch(() => {});
    }
    $('#hkList').addEventListener('click', (e) => { const b = e.composedPath()[0].closest('[data-hk]'); if (!b) return; hkRecording = hkRecording === b.dataset.hk ? null : b.dataset.hk; drawHotkeys(); });
    document.addEventListener('keydown', (e) => {
      if (!hkRecording) return;
      e.preventDefault(); e.stopImmediatePropagation(); // the key is only being recorded — nothing else may act on it
      if (e.key === 'Escape') { hkRecording = null; drawHotkeys(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { S.hotkeys[hkRecording] = ''; hkRecording = null; saveS(); applyHotkeys(); drawHotkeys(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
      if (!mods.length && !/^F\d+$/.test(e.code) && !/^Media/.test(e.code)) { hkFailed[hkRecording] = 'Use at least one of Ctrl, Alt, Shift or Win (or an F-key)'; drawHotkeys(); return; }
      const acc = mods.concat(e.code).join('+');
      for (const [a] of HK) if (a !== hkRecording && S.hotkeys[a] === acc) S.hotkeys[a] = '';
      S.hotkeys[hkRecording] = acc;
      delete hkFailed[hkRecording];
      hkRecording = null;
      saveS(); applyHotkeys(); drawHotkeys();
    }, true);

    // ---------- Discord ----------
    const applyDiscord = () => invoke('res_discord', { enabled: !!S.discord, clientId: S.discordId || '' }).catch(() => {});
    $('#setDiscord').onchange = (e) => { S.discord = e.target.checked; saveS(); applyDiscord(); syncExtras(); if (S.discord && !S.discordId) toast('Paste your Discord application ID below'); };
    $('#dcId').addEventListener('change', (e) => { S.discordId = e.target.value.replace(/\D/g, ''); e.target.value = S.discordId; saveS(); applyDiscord(); syncExtras(); });
    $('#dcPortal').onclick = () => invoke('res_open_url', { url: 'https://discord.com/developers/applications' }).catch(() => {});

    // ---------- updates (GitHub releases) ----------
    let upInfo = null;
    async function checkUpdate(manual) {
      const repo = UPDATE_REPO;
      $('#upStatus').textContent = 'Asking GitHub for the latest release…';
      try {
        upInfo = await invoke('res_check_update', { repo });
        S.lastUpdateCheck = Date.now(); saveS();
        if (upInfo.newer) {
          $('#upStatus').textContent = `Version ${upInfo.latest} is available (you have ${upInfo.current}).` + (upInfo.assetUrl ? '' : ' The release has no installer attached.');
          $('#upInstall').hidden = !upInfo.assetUrl;
          $('#btnAccount').classList.add('has-update');
          if (!manual) toast(`Resonance ${upInfo.latest} is available — Settings › Updates`, 7000);
        } else {
          $('#upStatus').textContent = `You're up to date (${upInfo.current}; latest on GitHub: ${upInfo.latest}).`;
          $('#upInstall').hidden = true;
        }
      } catch (e) {
        $('#upStatus').textContent = "Couldn't check: " + (e && e.message ? e.message : String(e)).replace(/^HTTP 404$/, 'repository or release not found (HTTP 404)');
      }
    }
    $('#upRepoOpen').onclick = () => invoke('res_open_url', { url: 'https://github.com/' + UPDATE_REPO + '/releases' }).catch(() => {});
    $('#upCheck').onclick = () => checkUpdate(true);
    $('#upInstall').onclick = async () => {
      if (!upInfo || !upInfo.assetUrl) return;
      $('#upInstall').disabled = true;
      $('#upStatus').textContent = `Downloading ${upInfo.assetName} from GitHub… Resonance will close and the installer will open.`;
      try { await invoke('res_install_update', { url: upInfo.assetUrl }); }
      catch (e) { $('#upStatus').textContent = 'Update failed: ' + (e && e.message ? e.message : String(e)); $('#upInstall').disabled = false; }
    };
    if (S.autoUpdate && Date.now() - (S.lastUpdateCheck || 0) > 20 * 3600 * 1000) setTimeout(() => checkUpdate(false), 8000);

    // ---------- backup / restore ----------
    $('#bkExport').onclick = () => {
      statsSave();
      const data = { app: 'Resonance', kind: 'settings-backup', version: 1, exported: new Date().toISOString(), settings: S };
      for (const k of ['res-pfp', 'res-fx', 'res-shuffle', 'res-stats', 'res-guest']) { try { const v = localStorage.getItem(k); if (v != null) data[k] = v; } catch (e) {} }
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'resonance-backup-' + today() + '.json';
      root.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('Backup saved to your Downloads folder');
    };
    $('#bkImport').onclick = () => $('#bkFile').click();
    $('#bkFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        let d;
        try { d = JSON.parse(rd.result); } catch (x) { toast("That file isn't a Resonance backup"); return; }
        if (!d || d.app !== 'Resonance' || typeof d.settings !== 'object') { toast("That file isn't a Resonance backup"); return; }
        try {
          localStorage.setItem('res-settings', JSON.stringify(d.settings));
          for (const k of ['res-pfp', 'res-fx', 'res-shuffle', 'res-stats', 'res-guest']) { if (typeof d[k] === 'string') localStorage.setItem(k, d[k]); }
        } catch (x) { toast("Couldn't restore that backup"); return; }
        toast('Settings restored — reloading…');
        setTimeout(() => location.reload(), 900);
      };
      rd.readAsText(f);
    });

    // ---------- settings: extra controls ----------
    $('#setFade').addEventListener('input', (e) => { const v = Number(e.target.value); if (R()) R().setFx({ fade: v }); $('#fadeV').textContent = v ? v + ' s' : 'Off'; });
    $('#setLevel').addEventListener('change', (e) => { if (R()) R().setFx({ level: e.target.checked }); });
    $('#setSmtc').addEventListener('change', (e) => { invoke('res_set_pref', { key: 'smtc', value: e.target.checked }).then(() => toast('Restart Resonance to apply')).catch(() => {}); });
    $('#btnShowKeys2').onclick = () => { $('#settingsModal').hidden = true; $('#kbModal').hidden = false; };
    function syncExtras() {
      const fx = R() && R().fxState ? R().fxState() : { fade: 0, level: false };
      $('#setFade').value = fx.fade; $('#fadeV').textContent = fx.fade ? fx.fade + ' s' : 'Off';
      $('#setLevel').checked = !!fx.level;
      $('#setDiscord').checked = !!S.discord;
      $('#dcId').value = S.discordId || '';
      $('#dcSub').textContent = S.discord && !S.discordId ? 'Paste your Discord application ID below to finish setting it up' : '"Listening to …" on your Discord profile while music plays';
      const days = Object.keys(stats.days).length;
      $('#statsSub').textContent = days ? `Recorded on ${days} day${days === 1 ? '' : 's'} · kept only on this PC` : 'Nothing recorded yet · kept only on this PC';
      drawHotkeys();
      invoke('res_get_prefs').then((p) => { $('#setSmtc').checked = p.smtc !== false; $('#setStartMin').checked = p.startMinimized !== false; if (p.version) $('#curVer').textContent = p.version; }).catch(() => {});
      invoke('res_autostart', { value: null }).then((v) => { $('#setAutostart').checked = !!v; $('#rowStartMin').classList.toggle('dim', !v); }).catch(() => {});
      $('#setLyrLang').value = S.lyrLang || 'en';
      drawEq();
    }

    // per-render / per-frame hooks
    let lastStatT = performance.now();
    function extraRender(s, has, key) {
      const now = performance.now();
      const dt = Math.min(2, (now - lastStatT) / 1000);
      lastStatT = now;
      if (has && s.playing && !s.ad) statAdd(s, key, dt);
      if (has && key !== lyr.key && ((S.npOpen && npTab === 'lyrics') || s.playerPageOpen || fsOn)) loadLyrics();
      if (fsOn) fsRender(s, has);
      if (has && key !== lastNotifyKey) {
        if (lastNotifyKey !== null && S.notify) invoke('res_notify', { title: s.title, body: s.artist || '' }).catch(() => {});
        lastNotifyKey = key;
      }
      if (miniOn) {
        $('#miniTitle').textContent = has ? s.title : 'Nothing playing';
        $('#miniArtist').textContent = has ? s.artist : '';
        const bg = has && s.art ? `url("${String(s.art).replace(/"/g, '%22')}")` : 'none';
        if ($('#miniArt').style.backgroundImage !== bg) { $('#miniArt').style.backgroundImage = bg; $('#miniBg').style.backgroundImage = bg; }
        setIcon($('#miniPlay'), s.playing ? 'pause' : 'play');
        setIcon($('#miniLike'), s.like === 'LIKE' ? 'heartFill' : 'heart');
        $('#miniLike').classList.toggle('on', s.like === 'LIKE');
        $('#miniShuffle').classList.toggle('active', !!s.shuffle);
      }
    }
    function extraTick() {
      if (!state || !state.hasTrack) return;
      const t = base.t + (state.playing ? (performance.now() - base.at) / 1000 : 0);
      lyricsTick(t);
      pageLyricsTick(t);
      if (fsOn) fsTick(t);
      if (miniOn) setWidth($('#miniProg').firstChild, state.duration ? Math.min(100, (t / state.duration) * 100) : 0);
    }


    // =================================================================
    // ---------- custom themes ----------
    var THEME_PRESETS = [
      { id: 'p-midnight', name: 'Midnight', bg: '#05060b', panel: '#10131d', accent: '#4f8cff', builtin: true },
      { id: 'p-forest', name: 'Forest', bg: '#040906', panel: '#0e1912', accent: '#34d399', builtin: true },
      { id: 'p-wine', name: 'Wine', bg: '#0b0507', panel: '#1b0e13', accent: '#f43f5e', builtin: true },
      { id: 'p-ember', name: 'Ember', bg: '#0b0704', panel: '#1a120b', accent: '#f59e0b', builtin: true },
      { id: 'p-mono', name: 'Mono', bg: '#050505', panel: '#151515', accent: '#e8e8e8', builtin: true },
    ];
    var HEX = /^#[0-9a-f]{6}$/i;
    function allThemes() { return THEME_PRESETS.concat((S.themes || []).filter((t) => t && HEX.test(t.bg) && HEX.test(t.panel) && HEX.test(t.accent))); }
    function mix(hex, w) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); const n = m ? parseInt(m[1], 16) : 0x121216; return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x + (255 - x) * w)).join(',') + ')'; }
    function applyTheme() {
      if (!HEX) return; // not set up yet (first paint) — applyPrefs runs again later
      const on = S.theme === 'custom';
      const th = S.themeCustom || {};
      wrap.classList.toggle('custom-theme', on);
      const de = document.documentElement.style;
      for (const [k, v] of [['--bg', th.bg], ['--panel', th.panel]]) { if (on && HEX.test(v || '')) wrap.style.setProperty(k, v); else wrap.style.removeProperty(k); }
      if (on && HEX.test(th.panel || '')) {
        wrap.style.setProperty('--surface', mix(th.panel, 0.06));
        wrap.style.setProperty('--surface-2', mix(th.panel, 0.03));
        de.setProperty('--res-page', th.panel); de.setProperty('--res-bgc', th.bg || '#07070a');
      } else { wrap.style.removeProperty('--surface'); wrap.style.removeProperty('--surface-2'); de.removeProperty('--res-page'); de.removeProperty('--res-bgc'); }
      if (on && HEX.test(th.accent || '')) wrap.style.setProperty('--accent', th.accent);
    }
    function pickTheme(t) {
      S.theme = 'custom'; S.themeId = t.id; S.themeCustom = { bg: t.bg, panel: t.panel, accent: t.accent };
      saveS(); applyPrefs(); drawThemeEd();
    }
    function drawThemeEd() {
      const ed = $('#themeEd');
      if (!ed) return;
      ed.hidden = S.theme !== 'custom';
      const th = S.themeCustom;
      $('#teBg').value = th.bg; $('#tePanel').value = th.panel; $('#teAccent').value = th.accent;
      const pv = $('#tePrev'); pv.style.setProperty('--a', th.bg); pv.style.setProperty('--b', th.panel); pv.style.setProperty('--c', th.accent);
      setHTML($('#teList'), allThemes().map((t) => `<button class="te-chip${t.id === S.themeId ? ' on' : ''}" data-t="${esc(t.id)}" title="${esc(t.name)}"><span class="te-sw" style="background:linear-gradient(135deg, ${t.bg} 0 45%, ${t.panel} 45% 75%, ${t.accent} 75%)"></span><span class="te-n">${esc(t.name)}</span>${t.builtin ? '' : `<span class="te-x" data-del="${esc(t.id)}" title="Delete">×</span>`}</button>`).join(''));
    }
    for (const [id, k] of [['#teBg', 'bg'], ['#tePanel', 'panel'], ['#teAccent', 'accent']]) {
      $(id).addEventListener('input', (e) => { S.themeCustom = Object.assign({}, S.themeCustom, { [k]: e.target.value }); S.themeId = ''; saveS(); applyTheme(); const pv = $('#tePrev'); pv.style.setProperty({ bg: '--a', panel: '--b', accent: '--c' }[k], e.target.value); });
      $(id).addEventListener('change', () => drawThemeEd());
    }
    $('#teList').addEventListener('click', (e) => {
      const p = e.composedPath()[0];
      const del = p.closest && p.closest('[data-del]');
      if (del) { S.themes = (S.themes || []).filter((t) => t.id !== del.dataset.del); if (S.themeId === del.dataset.del) S.themeId = ''; saveS(); drawThemeEd(); return; }
      const b = p.closest && p.closest('[data-t]');
      const t = b && allThemes().find((x) => x.id === b.dataset.t);
      if (t) pickTheme(t);
    });
    $('#teSave').onclick = () => askName('Theme name', '', (name) => {
      const t = Object.assign({ id: 't' + Date.now().toString(36), name: name.slice(0, 40) }, S.themeCustom);
      S.themes = (S.themes || []).concat([t]); S.themeId = t.id; saveS(); drawThemeEd(); toast('Saved theme "' + t.name + '"');
    });
    function downloadJson(obj, file) {
      const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file;
      root.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    $('#teExport').onclick = () => {
      const cur = allThemes().find((t) => t.id === S.themeId);
      const name = (cur && cur.name) || 'My theme';
      downloadJson({ app: 'Resonance', kind: 'theme', version: 1, name, bg: S.themeCustom.bg, panel: S.themeCustom.panel, accent: S.themeCustom.accent }, 'resonance-theme-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json');
      toast('Theme saved to your Downloads folder — send that file to share it');
    };
    $('#teImport').onclick = () => $('#teFile').click();
    $('#teFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        let d; try { d = JSON.parse(rd.result); } catch (x) { d = null; }
        const list = d && d.app === 'Resonance' ? (d.kind === 'themes' && Array.isArray(d.themes) ? d.themes : d.kind === 'theme' ? [d] : []) : [];
        const ok = list.filter((t) => t && HEX.test(t.bg) && HEX.test(t.panel) && HEX.test(t.accent)).map((t, i) => ({ id: 't' + Date.now().toString(36) + i, name: String(t.name || 'Imported theme').slice(0, 40), bg: t.bg, panel: t.panel, accent: t.accent }));
        if (!ok.length) { toast("That file isn't a Resonance theme"); return; }
        S.themes = (S.themes || []).concat(ok); saveS();
        pickTheme(ok[0]);
        toast('Imported "' + ok[0].name + '"');
      };
      rd.readAsText(f);
    });

    // ---------- devices: auto-pause, low battery, equalizer per output ----------
    var batWarned = {}, pausedForOut = '', lastOutName = '';
    try { batWarned = JSON.parse(localStorage.getItem('res-batwarn') || '{}') || {}; } catch (e) {}
    function eqRemember() {
      if (!S.eqPerOutput || !lastOutName || !R()) return;
      const f = R().fxState();
      S.eqByOut = Object.assign({}, S.eqByOut, { [lastOutName]: { eqOn: !!f.eqOn, eq: f.eq.slice() } });
      saveS();
    }
    $('#settingsModal').addEventListener('change', (e) => { const t = e.composedPath()[0]; if (t && t.dataset && t.dataset.set === 'eqPerOutput' && t.checked) { eqRemember(); toast(lastOutName ? 'Remembering this equalizer for ' + lastOutName : 'Turn on "Bluetooth & audio output" in General so Resonance knows the output'); } });
    function devHooks(prev, cur) {
      if (!cur) return;
      const outs = cur.outputs || [];
      const def = outs.find((o) => o.default);
      // 1. headphones (a Bluetooth output that was in use) disappeared → pause
      if (prev) {
        const pdef = (prev.outputs || []).find((o) => o.default);
        const gone = pdef && pdef.bt && !outs.some((o) => o.id === pdef.id);
        if (gone && S.autoPause !== false && state && state.playing) {
          cmd('pause'); pausedForOut = pdef.id;
          toast('Paused — ' + pdef.name.replace(/^[^(]*\((.+)\)$/, '$1') + ' disconnected', 3500);
        }
        if (pausedForOut && def && def.id === pausedForOut) {
          if (S.autoResume && state && !state.playing) { cmd('play'); toast('Welcome back — playing again'); }
          pausedForOut = '';
        }
      }
      // 2. low battery, once per charge
      let changed = false;
      for (const d of cur.devices || []) {
        if (d.battery == null) continue;
        if (d.battery <= 15 && !batWarned[d.name]) {
          batWarned[d.name] = 1; changed = true;
          if (S.lowBattery !== false) {
            invoke('res_notify', { title: 'Low battery', body: d.name + ' is at ' + d.battery + '%', always: true }).catch(() => {});
            toast(d.name + ' battery is low (' + d.battery + '%)', 4000);
          }
        } else if (d.battery >= 25 && batWarned[d.name]) { delete batWarned[d.name]; changed = true; }
      }
      if (changed) { try { localStorage.setItem('res-batwarn', JSON.stringify(batWarned)); } catch (e) {} }
      // 3. equalizer per output
      const name = def ? def.name : '';
      if (name && name !== lastOutName) {
        const first = !lastOutName;
        lastOutName = name;
        const sub = $('#eqOutSub');
        if (sub) sub.textContent = 'Each speaker or pair of headphones keeps its own equalizer · now: ' + name;
        const saved = S.eqPerOutput && S.eqByOut && S.eqByOut[name];
        if (saved && R()) {
          R().setFx({ eqOn: !!saved.eqOn, eq: saved.eq.slice() });
          if (!$('#settingsModal').hidden) drawEq();
          if (!first) toast('Equalizer for ' + name.replace(/^[^(]*\((.+)\)$/, '$1'));
        }
      }
    }
    // Windows tells the page right away when an audio device comes or goes — refresh then,
    // instead of waiting for the next check.
    try { navigator.mediaDevices.addEventListener('devicechange', () => { if (S.devices !== false) invoke('res_devices', {}).catch(() => {}); }); } catch (e) {}

    // ---------- skip intros / outros (per song) ----------
    var trims = {}, trimVid = '', trimStartDone = false, trimEndDone = false, trimLastT = 0;
    try { trims = JSON.parse(localStorage.getItem('res-trim') || '{}') || {}; } catch (e) {}
    const saveTrims = () => { try { localStorage.setItem('res-trim', JSON.stringify(trims)); } catch (e) {} };
    function trimMarks(s) {
      const tr = s && s.videoId && trims[s.videoId];
      const sk = $('#seek');
      if (!tr || !s.duration) { sk.classList.remove('has-trim'); return; }
      sk.classList.add('has-trim');
      sk.style.setProperty('--ts', ((tr.s || 0) / s.duration * 100).toFixed(2) + '%');
      sk.style.setProperty('--te', ((tr.e || s.duration) / s.duration * 100).toFixed(2) + '%');
    }
    function trimCheck(s) {
      if (!s || !s.hasTrack || !s.videoId) { trimMarks(null); return; }
      if (s.videoId !== trimVid || (s.time < 1.5 && trimLastT > 5)) { trimVid = s.videoId; trimStartDone = false; trimEndDone = false; }
      trimLastT = s.time;
      trimMarks(s);
      const tr = trims[s.videoId];
      if (!tr) return;
      if (tr.s && !trimStartDone && s.duration) { trimStartDone = true; if (s.time < tr.s - 1) { cmd('seek', tr.s); toast('Skipped the intro'); } }
      if (tr.e && !trimEndDone && s.playing && s.time >= tr.e) { trimEndDone = true; cmd('next'); toast('Skipped the outro'); }
    }
    const nowT = () => (state ? base.t + (state.playing ? (performance.now() - base.at) / 1000 : 0) : 0);
    function trimItems() {
      if (!state || !state.videoId || !state.duration) return [];
      const t = nowT(), tr = trims[state.videoId] || {};
      const out = [
        ['trimS', (tr.s ? 'Start point ' + fmt(tr.s) + ' → move to ' : 'Always start this song at ') + fmt(t), '', t > 1 && t < state.duration - 2, 'skipStart'],
        ['trimE', (tr.e ? 'End point ' + fmt(tr.e) + ' → move to ' : 'Always end this song at ') + fmt(t), '', t > (tr.s || 0) + 2, 'skipEnd'],
      ];
      if (tr.s || tr.e) out.push(['trimC', 'Clear start / end points', '', true, 'close']);
      return out;
    }
    function trimPick(c) {
      const id = state && state.videoId;
      if (!id) return;
      const t = Math.round(nowT() * 10) / 10, tr = Object.assign({}, trims[id]);
      if (c === 'trimS') { tr.s = t; if (tr.e && tr.e <= t + 2) delete tr.e; toast('This song will start at ' + fmt(t)); }
      else if (c === 'trimE') { tr.e = t; if (tr.s && tr.s >= t - 2) delete tr.s; toast('This song will end at ' + fmt(t)); trimEndDone = true; }
      else if (c === 'trimC') { delete tr.s; delete tr.e; toast('Start and end points cleared'); }
      if (tr.s || tr.e) trims[id] = tr; else delete trims[id];
      saveTrims(); trimMarks(state);
    }

    // ---------- save the queue as a playlist ----------
    function saveQueue() {
      const ids = R() ? R().queueVideoIds() : [];
      if (!ids.length) { toast('The queue is empty'); return; }
      const d = new Date();
      askName('Save queue as playlist', 'Queue ' + d.toLocaleDateString(), async (name) => {
        const id = await R().createPlaylist(name, { videoIds: ids }).catch(() => null);
        if (!id) { toast("Couldn't create the playlist"); return; }
        toast('Saved ' + ids.length + ' song' + (ids.length === 1 ? '' : 's') + ' to "' + name + '"');
        plKey = ''; setTimeout(refreshPlaylists, 800);
      });
    }
    $('#btnSaveQueue').onclick = (e) => { e.stopPropagation(); saveQueue(); };

    // ---------- visualizer ----------
    var vizLast = 0, vizDrawn = { pb: false, fs: false, glow: false }, vizSmooth = [], vizGlow = 0;
    $('#setVizStr').addEventListener('input', (e) => { S.vizStrength = Number(e.target.value); saveS(); $('#vizStrV').textContent = S.vizStrength + '%'; });
    function vizClear(cv) {
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
    }
    function vizPaint(cv, lv, opt) {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const g = cv.getContext('2d');
      g.clearRect(0, 0, w, h);
      const n = lv.length;
      const c = (curTint || [255, 72, 108]).join(',');
      const grad = g.createLinearGradient(0, h, 0, h * (1 - opt.max));
      grad.addColorStop(0, `rgba(${c},${opt.alpha})`);
      grad.addColorStop(1, `rgba(${c},${opt.alpha * 0.2})`);
      g.fillStyle = grad;
      if (opt.style === 'wave') {
        // one soft, mirrored curve through the levels
        const pts = [];
        for (let i = 0; i < n; i++) pts.push([(i / (n - 1)) * w, h - Math.max(opt.min * dpr, Math.pow(lv[i], 1.5) * h * opt.max)]);
        g.beginPath(); g.moveTo(0, h); g.lineTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < n; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; const mx = (x0 + x1) / 2; g.quadraticCurveTo(x0, y0, mx, (y0 + y1) / 2); }
        g.lineTo(w, pts[n - 1][1]); g.lineTo(w, h); g.closePath(); g.fill();
        g.strokeStyle = `rgba(${c},${Math.min(1, opt.alpha * 1.6)})`; g.lineWidth = 1.5 * dpr;
        g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < n; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; g.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); }
        g.stroke();
        return;
      }
      const gap = Math.max(1, Math.round((w / n) * opt.gap)), bw = w / n - gap;
      const r = Math.min(bw / 2, 3 * dpr);
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const bh = Math.max(opt.min * dpr, Math.pow(lv[i], 1.6) * h * opt.max);
        const x = i * (bw + gap) + gap / 2;
        if (g.roundRect) g.roundRect(x, h - bh, bw, bh, [r, r, 0, 0]); else g.rect(x, h - bh, bw, bh);
      }
      g.fill();
    }
    // "Glow" style: the album art pulses with the bass
    function vizGlowPaint(level) {
      const k = (S.vizStrength || 35) / 100, c = (curTint || [255, 72, 108]).join(',');
      const pb = $('#pbArtBtn'), fs = $('#fsvArt');
      if (level == null) { pb.style.boxShadow = ''; fs.style.boxShadow = ''; return; }
      const a = Math.min(0.95, level * 1.25 * k + 0.08 * k);
      if (!fsOn) pb.style.boxShadow = `0 0 ${Math.round(6 + level * 26)}px ${Math.round(level * 6)}px rgba(${c},${a.toFixed(3)}), 0 6px 18px rgba(0,0,0,.4)`;
      else fs.style.boxShadow = `0 0 ${Math.round(30 + level * 120)}px ${Math.round(level * 26)}px rgba(${c},${(a * 0.9).toFixed(3)}), 0 40px 100px rgba(0,0,0,.6)`;
    }
    function vizTick() {
      const mode = S.viz || 'off';
      const glow = S.vizStyle === 'glow';
      const wantPb = (mode === 'bar' || mode === 'both') && !miniOn && !fsOn;
      const wantFs = (mode === 'fs' || mode === 'both') && fsOn;
      const playing = !!(state && state.playing);
      if ((!wantPb || !playing || glow) && vizDrawn.pb) { vizClear($('#pbViz')); vizDrawn.pb = false; }
      if ((!wantFs || !playing || glow) && vizDrawn.fs) { vizClear($('#fsvViz')); vizDrawn.fs = false; }
      if ((!(wantPb || wantFs) || !playing || !glow) && vizDrawn.glow) { vizGlowPaint(null); vizDrawn.glow = false; vizGlow = 0; }
      if ((!wantPb && !wantFs) || !playing || !R() || !R().viz) return;
      const now = performance.now();
      if (now - vizLast < 33) return;
      vizLast = now;
      const n = glow ? 16 : wantFs ? 72 : 56;
      const lv = R().viz(n);
      if (!lv) return;
      if (vizSmooth.length !== n) vizSmooth = new Array(n).fill(0);
      for (let i = 0; i < n; i++) vizSmooth[i] = lv[i] > vizSmooth[i] ? lv[i] : vizSmooth[i] * 0.86 + lv[i] * 0.14;
      if (glow) {
        const bass = (lv[0] + lv[1] + lv[2] + lv[3]) / 4;
        vizGlow = bass > vizGlow ? vizGlow * 0.4 + bass * 0.6 : vizGlow * 0.88 + bass * 0.12;
        vizGlowPaint(Math.pow(vizGlow, 1.4)); vizDrawn.glow = true;
        return;
      }
      const k = (S.vizStrength || 35) / 100, style = S.vizStyle === 'wave' ? 'wave' : 'bars';
      if (wantPb) { vizPaint($('#pbViz'), vizSmooth, { style, alpha: 0.42 * k, max: 0.62 + 0.3 * k, min: 1, gap: 0.35 }); vizDrawn.pb = true; }
      if (wantFs) { vizPaint($('#fsvViz'), vizSmooth, { style, alpha: 0.9 * k, max: 0.6 + 0.35 * k, min: 2, gap: 0.3 }); vizDrawn.fs = true; }
    }

    // ---------- recent problems (health check) ----------
    let logText = '';
    async function drawLogs() {
      const rows = LOG.slice().reverse().map((l) => ({ at: l.at, src: l.src, msg: l.msg + (l.n > 1 ? ' (×' + l.n + ')' : '') }));
      (window.__resErrors || []).forEach((m) => rows.push({ at: 0, src: 'Resonance (start-up)', msg: String(m).replace(/\s+/g, ' ').slice(0, 400) }));
      let native = [];
      try { native = await invoke('res_read_log'); } catch (e) {}
      (native || []).slice(-15).reverse().forEach((m) => rows.push({ at: 0, src: 'App log', msg: m }));
      const tm = (t) => (t ? new Date(t).toLocaleTimeString() : '');
      setHTML($('#logList'), rows.length ? rows.slice(0, 80).map((r) => `<div class="log-row"><span class="log-t">${esc(tm(r.at))}</span><span class="log-s">${esc(r.src)}</span><span class="log-m">${esc(r.msg)}</span></div>`).join('') : '<div class="lib-empty">No problems recorded — nice.</div>');
      logText = rows.map((r) => `[${tm(r.at) || '—'}] ${r.src}: ${r.msg}`).join('\n');
      return logText;
    }
    $('#logCopy').onclick = async () => { await drawLogs(); copyText(logText || 'No problems recorded'); toast('Errors copied'); };
    $('#logClear').onclick = () => { LOG.length = 0; if (window.__resErrors) window.__resErrors.length = 0; drawLogs(); };


    // ---------- song-change pop-up ----------
    function sendOverlay() { invoke('res_set_overlay', { enabled: !!S.overlay, corner: S.overlayCorner || 'bottom-right', always: !!S.overlayAlways }).catch(() => {}); }

    // ---------- phone remote ----------
    function drawQr(q, cv) {
      cv = cv || $('#remoteQr');
      const g = cv.getContext('2d');
      const n = q && q.size, px = 180;
      g.fillStyle = '#fff'; g.fillRect(0, 0, px, px);
      if (!n) return;
      const quiet = 3, cell = px / (n + quiet * 2);
      g.fillStyle = '#111';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.bits[y * n + x] === '1') g.fillRect(Math.floor((x + quiet) * cell), Math.floor((y + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    }
    let remoteUrl = '';
    async function applyRemote(renew) {
      let r = null;
      try { r = await invoke('res_remote', { enabled: !!S.remote, renew: !!renew }); } catch (e) { r = { error: String(e) }; }
      $('#remoteBox').hidden = !(r && r.on);
      if (r && r.on) { remoteUrl = r.url; $('#remoteUrl').textContent = r.url; drawQr(r.qr); drawQr(r.qr, $('#rmpQr')); $('#rmpUrl').textContent = r.url; }
      else if (S.remote && r && r.error) { toast("Phone remote couldn't start: " + r.error, 5000); S.remote = false; saveS(); $('#setRemote').checked = false; }
      paintRemote();
      return r;
    }
    // player-bar button + its pop-up
    function paintRemote() {
      $('#btnRemote').classList.toggle('active', !!S.remote);
      $('#rmpOn').checked = !!S.remote;
      $('#rmpBody').hidden = !S.remote || !remoteUrl;
      $('#rmpSub').textContent = S.remote ? (remoteUrl ? "Scan with your phone's camera" : 'Starting…') : 'Off — turn on to get a QR code';
    }
    function placeRemotePop() {
      const p = $('#remotePop'), r = $('#btnRemote').getBoundingClientRect(), pr = p.getBoundingClientRect();
      p.style.left = Math.max(8, Math.min(innerWidth - pr.width - 8, r.left + r.width / 2 - pr.width / 2)) + 'px';
      p.style.top = Math.max(8, r.top - pr.height - 10) + 'px';
    }
    $('#btnRemote').onclick = async (e) => {
      e.stopPropagation();
      const p = $('#remotePop');
      if (!p.hidden) { p.hidden = true; return; }
      closeCtx(); $('#devPop').hidden = true;
      if (!S.remote) { S.remote = true; saveS(); }
      paintRemote(); p.hidden = false; placeRemotePop();
      await applyRemote(false);
      placeRemotePop();
    };
    $('#rmpOn').addEventListener('change', async (e) => {
      S.remote = e.target.checked; saveS();
      if (!S.remote) remoteUrl = '';
      $('#setRemote').checked = S.remote;
      paintRemote(); placeRemotePop();
      await applyRemote(false);
      placeRemotePop();
      toast(S.remote ? 'Phone remote on' : 'Phone remote off — the link no longer works');
    });
    $('#rmpCopy').onclick = () => { if (remoteUrl) { copyText(remoteUrl); toast('Link copied'); } };
    $('#rmpNew').onclick = () => applyRemote(true).then(() => toast('New link made — the old one no longer works'));
    document.addEventListener('pointerdown', (e) => { const p = $('#remotePop'); if (!p.hidden && !e.composedPath().includes(p) && !e.composedPath().includes($('#btnRemote'))) p.hidden = true; }, true);
    $('#setRemote').addEventListener('change', (e) => { S.remote = e.target.checked; saveS(); if (!S.remote) remoteUrl = ''; applyRemote(false); });
    $('#remoteNew').onclick = () => applyRemote(true).then(() => toast('New link made — the old one no longer works'));
    $('#remoteCopy').onclick = () => { if (remoteUrl) { copyText(remoteUrl); toast('Link copied'); } };
    if (S.remote) applyRemote(false);

    // ---------- what's new (after an update) ----------
    let appVersion = '';
    function mdToHtml(md) {
      const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      let html = '', list = false;
      for (const raw of String(md).replace(/\r/g, '').split('\n')) {
        const line = raw.trimEnd();
        const li = /^\s*[-*+]\s+(.*)/.exec(line);
        if (li) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + inline(li[1]) + '</li>'; continue; }
        if (list) { html += '</ul>'; list = false; }
        const h = /^(#{1,4})\s+(.*)/.exec(line);
        if (h) html += '<h3>' + inline(h[2]) + '</h3>';
        else if (line.trim()) html += '<p>' + inline(line) + '</p>';
      }
      if (list) html += '</ul>';
      return html || '<p>No details for this version.</p>';
    }
    async function openWhatsNew(version) {
      const v = version || appVersion;
      $('#wnTitle').textContent = v ? "What's new in " + v : "What's new";
      setHTML($('#wnBody'), '<div class="lib-empty">Loading the release notes…</div>');
      $('#wnGh').hidden = true;
      $('#settingsModal').hidden = true;
      $('#wnModal').hidden = false;
      let r = null;
      try { r = await invoke('res_release_notes', { repo: UPDATE_REPO, version: v || null }); } catch (e) { r = null; }
      if (r && r.body) {
        setHTML($('#wnBody'), mdToHtml(r.body));
        if (r.page) { $('#wnGh').hidden = false; $('#wnGh').onclick = () => invoke('res_open_url', { url: r.page }).catch(() => {}); }
      } else {
        setHTML($('#wnBody'), '<p>This version has no release notes on GitHub (or GitHub couldn’t be reached).</p>');
      }
    }
    $('#wnOpen').onclick = () => openWhatsNew();
    function whatsNewCheck(v) {
      if (!v) return;
      appVersion = v;
      const prev = S.lastVersion;
      if (prev === v) return;
      S.lastVersion = v; saveS();
      if (prev) setTimeout(() => { if (!miniOn) openWhatsNew(v); }, 2500); // not on the very first start
    }

    // ---------- long sessions: YouTube Music's page slowly grows over hours. When Resonance has
    // been open a long time, is hidden and nothing has played for a while, reload the page quietly
    // (the window stays hidden; Play continues the last song where it stopped).
    var lastPlayAt = Date.now();
    setInterval(() => {
      if (state && state.playing) { lastPlayAt = Date.now(); return; }
      const hidden = document.hidden || window.__resHidden === true;
      if (performance.now() > 6 * 3600e3 && hidden && Date.now() - lastPlayAt > 15 * 60e3 && !miniOn && !fsOn && $('#settingsModal').hidden) {
        try { saveS(); statsSave(); } catch (e) {}
        window.__resLog && window.__resLog('quiet reload after a long session (memory)');
        location.reload();
      }
    }, 60000);

    // ---------- start-up: open the way it was closed, then show the window ----------
    let readySent = false;
    const sendReady = () => { if (readySent) return; readySent = true; invoke('res_win', { action: 'ready' }).catch(() => {}); };
    invoke('res_get_prefs').then((p) => {
      if (p && p.lastMode === 'mini') setMini(true);
      whatsNewCheck(p && p.version);
    }).catch(() => {}).finally(() => setTimeout(sendReady, 80));
    setTimeout(sendReady, 1500);
    applyTheme(); // custom theme (its helpers are defined just above)
    applyHotkeys();
    applyDiscord();


    // =================================================================
    // Round 3: full-screen view, equalizer, history, start-up, notifications,
    // command palette, sidebar folders/pins, queue reorder, pop-out video,
    // health check, recap, lyrics translation
    // =================================================================
    let lastNotifyKey = null, fsOn = false;

    // ---------- small name prompt (no browser dialogs) ----------
    let promptCb = null;
    function askName(title, value, cb) {
      $('#promptTitle').textContent = title;
      $('#promptInput').value = value || '';
      promptCb = cb;
      $('#promptModal').hidden = false;
      setTimeout(() => { $('#promptInput').focus(); $('#promptInput').select(); }, 30);
    }
    const promptDone = () => { const v = $('#promptInput').value.trim(); $('#promptModal').hidden = true; if (v && promptCb) promptCb(v); promptCb = null; };
    $('#promptOk').onclick = promptDone;
    $('#promptInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') promptDone(); });

    // ---------- custom context menus (sidebar, queue) ----------
    let ctxPick = null;
    function openCustomCtx(x, y, items, onPick) {
      closeMenu();
      ctxPick = onPick;
      const ctx = $('#ctx');
      const withIcons = items.some((it) => it !== 'sep' && it[4]);
      setHTML(ctx, items.map((it) => it === 'sep' ? '<div class="ctx-sep"></div>' : it[0] === 'head' ? `<div class="ctx-head" title="${esc(it[1])}">${esc(it[1])}</div>` :
        `<button class="ctx-item${withIcons ? ' has-ic' : ''}" data-c="${esc(it[0])}"${it[3] === false ? ' disabled' : ''}><span class="ctx-l">${withIcons ? `<span class="ctx-ic">${it[4] && P[it[4]] ? ic(it[4]) : ''}</span>` : ''}<span>${esc(it[1])}</span></span><kbd class="ctx-k">${esc(it[2] || '')}</kbd></button>`).join(''));
      ctx.hidden = false;
      const r = ctx.getBoundingClientRect();
      ctx.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
      ctx.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
    }
    $('#ctx').addEventListener('click', (e) => {
      const b = e.composedPath()[0].closest('[data-c]');
      if (!b || b.disabled || !ctxPick) return;
      e.stopImmediatePropagation();
      closeCtx();
      const f = ctxPick; ctxPick = null;
      f(b.dataset.c);
    }, true);

    // ---------- sidebar: pins, folders, drag to reorder ----------
    const sb = () => { if (!S.sb || !Array.isArray(S.sb.items)) S.sb = { items: [] }; return S.sb; };
    const newId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    function sbLocate(id) {
      const items = sb().items;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.t === 'p' && it.id === id) return { list: items, index: i, folder: null };
        if (it.t === 'f') { const j = it.items.indexOf(id); if (j >= 0) return { list: it.items, index: j, folder: it }; }
      }
      return null;
    }
    function sbTake(id) { const l = sbLocate(id); if (!l) return null; const [x] = l.list.splice(l.index, 1); return l.folder ? { t: 'p', id: x } : x; }
    function sbMerge() {
      const ids = [...plData.keys()];
      if (!ids.length) return;
      const have = new Set(ids), seen = new Set();
      const s0 = sb();
      s0.items = s0.items.filter((it) => {
        if (it.t === 'f') { it.items = it.items.filter((x) => have.has(x) && !seen.has(x) && seen.add(x)); return true; }
        return it.t === 'p' && have.has(it.id) && !seen.has(it.id) && seen.add(it.id);
      });
      for (const id of ids) if (!seen.has(id)) s0.items.push({ t: 'p', id });
    }
    const plRow = (id, inFolder, pinned) => {
      const p = plData.get(id);
      if (!p) return '';
      return `<button class="pl-item${inFolder ? ' in-folder' : ''}" data-browse="${esc(p.id)}" data-drag="p:${esc(p.id)}" title="${esc(p.title)}">
        <div class="pl-cover" style="--h:${hashHue(p.title || p.id)}"><span>${esc(((p.title || '').trim()[0] || '♪').toUpperCase())}</span>${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : ''}</div>
        <div class="pl-meta"><div class="pl-title">${pinned ? `<span class="pl-pin">${ic('pin')}</span>` : ''}${esc(p.title)}</div><div class="pl-sub">${esc(p.subtitle || 'Playlist')}</div></div>
      </button>`;
    };
    function renderSidebar() {
      sbMerge();
      const items = sb().items;
      const ordered = items.filter((it) => it.t === 'p' && it.pin).concat(items.filter((it) => !(it.t === 'p' && it.pin)));
      setHTML($('#plDyn'), ordered.map((it) => {
        if (it.t === 'p') return plRow(it.id, false, it.pin);
        return `<div class="pl-group${it.open ? ' open' : ''}"><button class="pl-folder" data-fid="${esc(it.id)}" data-drag="f:${esc(it.id)}" title="${esc(it.name)}">
            <div class="pl-cover folder-cover">${ic('folder')}</div>
            <div class="pl-meta"><div class="pl-title">${esc(it.name)}</div><div class="pl-sub">${it.items.length} playlist${it.items.length === 1 ? '' : 's'}</div></div>
            <span class="pl-chev">${ic('chevron')}</span></button>
          ${it.open ? it.items.map((id) => plRow(id, true, false)).join('') : ''}</div>`;
      }).join(''));
      if (state) updateNav();
    }
    function sbSave() { saveS(); renderSidebar(); }
    function toggleFolder(fid) { const f = sb().items.find((x) => x.t === 'f' && x.id === fid); if (f) { f.open = !f.open; sbSave(); } }
    function playlistMenu(id, x, y) {
      const loc = sbLocate(id);
      const top = loc && !loc.folder ? loc.list[loc.index] : null;
      const folders = sb().items.filter((f) => f.t === 'f' && (!loc || loc.folder !== f));
      const items = [['open', 'Open']];
      if (top) items.push(['pin', top.pin ? 'Unpin' : 'Pin to top']);
      items.push('sep');
      folders.forEach((f) => items.push(['to:' + f.id, 'Move to “' + f.name + '”']));
      items.push(['newf', 'New folder with this playlist…']);
      if (loc && loc.folder) items.push(['out', 'Remove from folder']);
      openCustomCtx(x, y, items, (a) => {
        if (a === 'open') R() && R().nav({ browseId: id });
        else if (a === 'pin') { top.pin = !top.pin; sbSave(); }
        else if (a.startsWith('to:')) { const f = sb().items.find((z) => z.id === a.slice(3)); sbTake(id); f.items.push(id); f.open = true; sbSave(); }
        else if (a === 'out') { const l = sbLocate(id); const folderIdx = sb().items.indexOf(l.folder); sbTake(id); sb().items.splice(folderIdx + 1, 0, { t: 'p', id }); sbSave(); }
        else if (a === 'newf') askName('New folder', 'New folder', (name) => { const l = sbLocate(id); const at = l && !l.folder ? l.index : sb().items.length; sbTake(id); sb().items.splice(Math.min(at, sb().items.length), 0, { t: 'f', id: newId(), name, open: true, items: [id] }); sbSave(); });
      });
    }
    function folderMenu(fid, x, y) {
      const f = sb().items.find((z) => z.t === 'f' && z.id === fid);
      if (!f) return;
      openCustomCtx(x, y, [['ren', 'Rename…'], ['tog', f.open ? 'Collapse' : 'Expand'], 'sep', ['del', 'Delete folder (keeps the playlists)']], (a) => {
        if (a === 'ren') askName('Rename folder', f.name, (name) => { f.name = name; sbSave(); });
        else if (a === 'tog') toggleFolder(fid);
        else if (a === 'del') { const i = sb().items.indexOf(f); sb().items.splice(i, 1, ...f.items.map((id) => ({ t: 'p', id }))); sbSave(); }
      });
    }
    // generic pointer drag (sidebar + queue)
    function makeDragList(container, selector, onDrop) {
      let d = null;
      container.addEventListener('pointerdown', (e) => {
        const el = e.composedPath()[0].closest && e.composedPath()[0].closest(selector);
        if (!el || e.button !== 0) return;
        d = { el, x: e.clientX, y: e.clientY, on: false, target: null, where: '' };
      });
      container.addEventListener('pointermove', (e) => {
        if (!d) return;
        const dy = e.clientY - d.y;
        if (!d.on && Math.hypot(e.clientX - d.x, dy) < 6) return;
        if (!d.on) { d.on = true; d.el.setPointerCapture(e.pointerId); d.el.classList.add('dragging'); }
        d.el.style.transform = `translateY(${dy}px)`;
        d.el.style.pointerEvents = 'none';
        const under = root.elementFromPoint(e.clientX, e.clientY);
        const tgt = under && under.closest && under.closest(selector);
        container.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
        d.target = tgt && tgt !== d.el ? tgt : null;
        if (d.target) {
          const r = d.target.getBoundingClientRect();
          const rel = (e.clientY - r.top) / r.height;
          d.where = d.target.classList.contains('pl-folder') && d.el.classList.contains('pl-item') && rel > 0.25 && rel < 0.75 ? 'into' : rel < 0.5 ? 'before' : 'after';
          d.target.classList.add('drop-' + d.where);
        }
      });
      const end = () => {
        if (!d) return;
        const x = d; d = null;
        x.el.style.transform = ''; x.el.style.pointerEvents = '';
        x.el.classList.remove('dragging');
        container.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((z) => z.classList.remove('drop-before', 'drop-after', 'drop-into'));
        if (!x.on) return;
        window.__resDragEnd = Date.now();
        if (x.target) onDrop(x.el, x.target, x.where);
      };
      container.addEventListener('pointerup', end);
      container.addEventListener('pointercancel', end);
    }
    makeDragList($('#plDyn'), '.pl-item, .pl-folder', (el, tgt, where) => {
      const [kind, id] = el.dataset.drag.split(/:(.*)/s);
      const [tkind, tid] = tgt.dataset.drag.split(/:(.*)/s);
      if (where === 'into' && kind === 'p') { const f = sb().items.find((z) => z.id === tid); sbTake(id); f.items.push(id); f.open = true; return sbSave(); }
      // moving a folder, or a playlist next to something
      let entry;
      if (kind === 'f') { const i = sb().items.findIndex((z) => z.id === id); entry = sb().items.splice(i, 1)[0]; }
      else entry = sbTake(id);
      if (!entry) return renderSidebar();
      const tl = tkind === 'p' ? sbLocate(tid) : { list: sb().items, index: sb().items.findIndex((z) => z.id === tid), folder: null };
      if (!tl) { sb().items.push(entry); return sbSave(); }
      if (tl.folder && kind === 'p') tl.list.splice(tl.index + (where === 'after' ? 1 : 0), 0, entry.id);
      else { if (entry.pin && tkind === 'p') { const te = tl.list[tl.index]; entry.pin = !!(te && te.pin); } tl.list.splice(tl.index + (where === 'after' ? 1 : 0), 0, entry); }
      sbSave();
    });

    // ---------- queue: drag to reorder + right-click actions ----------
    makeDragList($('#queue'), '.q-item', async (el, tgt, where) => {
      const from = Number(el.dataset.q);
      let to = Number(tgt.dataset.q) + (where === 'after' ? 1 : 0);
      if (to > from) to -= 1;
      if (to === from || !R()) return;
      toast('Moving…');
      const ok = await R().moveQueue(from, to);
      if (!ok) {
        const cur = (R().queue() || []).findIndex((x) => x.current);
        if (to === cur + 1 && (await R().queueAction(from, 'next'))) toast('Moved — plays next');
        else toast("YouTube Music didn't accept that move — right-click a song for “Play next”", 4000);
      } else toast('Queue updated');
      qKey = ''; setTimeout(refreshQueue, 300);
    });
    function queueMenu(i, x, y) {
      openCustomCtx(x, y, [['play', 'Play now'], ['next', 'Play next'], 'sep', ['remove', 'Remove from queue']], async (a) => {
        if (!R()) return;
        if (a === 'play') R().playQueue(i);
        else if (!(await R().queueAction(i, a))) toast("Couldn't find that option in YouTube Music's queue menu");
        qKey = ''; setTimeout(refreshQueue, 500);
      });
    }

    // ---------- full-screen view ----------
    function setFs(on) {
      fsOn = on;
      $('#fsv').hidden = !on;
      wrap.classList.toggle('fs-mode', on);
      if (on) {
        invoke('res_win', { action: 'fullscreen' }).then((now) => { if (!now) invoke('res_win', { action: 'fullscreen' }); }).catch(() => {});
        closeMenu(); closeCtx(); pop.hidden = true;
        if (state) fsRender(state, state.hasTrack);
        loadLyrics(); fsDrawLyrics();
      } else invoke('res_win', { action: 'fullscreen_off' }).catch(() => {});
    }
    $('#btnFs').onclick = () => setFs(true);
    $('#fsvExit').onclick = () => setFs(false);
    $('#fsvLyrToggle').onclick = () => { S.fsNoLyrics = !S.fsNoLyrics; saveS(); $('#fsv').classList.toggle('no-lyrics', !!S.fsNoLyrics); };
    $('#fsv').classList.toggle('no-lyrics', !!S.fsNoLyrics);
    $('#fsvPlay').onclick = () => $('#btnPlay').click();
    $('#fsvPrev').onclick = () => cmd('prev');
    $('#fsvNext').onclick = () => cmd('next');
    $('#fsvLike').onclick = () => $('#btnLike').click();
    $('#fsvShuffle').onclick = () => $('#btnShuffle').click();
    $('#fsvBar').addEventListener('click', (e) => { const r = $('#fsvBar').getBoundingClientRect(); if (state && state.duration) cmd('seek', ((e.clientX - r.left) / r.width) * state.duration); });
    let fsIdx = -1, fsUserScroll = 0;
    $('#fsvLyrics').addEventListener('wheel', () => { fsUserScroll = Date.now(); }, { passive: true });
    $('#fsvLyrics').addEventListener('click', (e) => { const l = e.composedPath()[0].closest('.fl'); if (l && lyr.synced) { cmd('seek', Math.max(0, lyr.lines[Number(l.dataset.i)].t - 0.15)); fsUserScroll = 0; } });
    function fsDrawLyrics() {
      if (!fsOn) return;
      const el = $('#fsvLyrics');
      fsIdx = -1;
      if (lyr.status === 'loading') return setHTML(el, '<div class="fl-empty">Looking for lyrics…</div>');
      if (!lyr.lines.length) return setHTML(el, `<div class="fl-empty">${esc(lyr.status || 'No lyrics for this song')}</div>`);
      setHTML(el, '<div class="fl-pad"></div>' + lyr.lines.map((l, i) => `<div class="fl${lyr.synced ? '' : ' static'}" data-i="${i}">${lineInner(l)}${lyr.roman && lyr.roman[i] ? `<span class="fl-rm">${esc(lyr.roman[i])}</span>` : ''}${lyr.trans && lyr.trans[i] && l.text ? `<span class="fl-tr">${esc(lyr.trans[i])}</span>` : ''}</div>`).join('') + `<div class="fl-credit">${lyr.synced ? 'Synced lyrics' : 'Lyrics'} from ${esc(lyr.source || '')}</div><div class="fl-pad"></div>`);
    }
    function fsRender(s, has) {
      $('#fsvTitle').textContent = has ? s.title : 'Nothing playing';
      $('#fsvArtist').textContent = has ? [s.artist, s.album].filter(Boolean).join(' • ') : '';
      const bg = has && s.art ? `url("${String(s.art).replace(/"/g, '%22')}")` : 'none';
      if ($('#fsvArt').style.backgroundImage !== bg) { $('#fsvArt').style.backgroundImage = bg; $('#fsvBg').style.backgroundImage = bg; }
      setIcon($('#fsvPlay'), s.playing ? 'pause' : 'play');
      setIcon($('#fsvLike'), s.like === 'LIKE' ? 'heartFill' : 'heart');
      $('#fsvLike').classList.toggle('on', s.like === 'LIKE');
      $('#fsvShuffle').classList.toggle('active', !!s.shuffle);
      $('#fsvDur').textContent = fmt(s.duration);
    }
    function fsTick(t) {
      if (!state) return;
      setText($('#fsvCur'), fmt(t));
      setWidth($('#fsvBar').firstChild, state.duration ? Math.min(100, (t / state.duration) * 100) : 0);
      if (!lyr.synced || S.fsNoLyrics) return;
      let i = -1;
      for (let k = 0; k < lyr.lines.length; k++) { if (lyr.lines[k].t <= t + 0.25) i = k; else break; }
      if (kOn()) kFill($(`#fsvLyrics .fl[data-i="${i}"]`), i, t + 0.1);
      if (i === fsIdx) return;
      fsIdx = i;
      $$('#fsvLyrics .fl').forEach((el, k) => { el.classList.toggle('on', k === i); el.classList.toggle('past', k < i); });
      const cur = $(`#fsvLyrics .fl[data-i="${i}"]`);
      if (cur && Date.now() - fsUserScroll > 4000) { const sc = $('#fsvLyrics'); sc.scrollTo({ top: cur.offsetTop - sc.clientHeight * 0.4, behavior: 'smooth' }); }
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F11') { e.preventDefault(); setFs(!fsOn); }
      else if (e.key === 'Escape' && fsOn) { setFs(false); }
    }, true);

    // ---------- lyrics translation ----------
    const transCache = new Map();
    // non-Latin letters (kana, hangul, han, cyrillic, greek, arabic, devanagari, thai, hebrew…)
    const NON_LATIN = /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;
    async function translateLyrics() {
      if ((!S.lyrTranslate && !S.lyrRoman) || !lyr.lines.length) { if (lyr.roman) { lyr.roman = null; drawLyrics(); fsDrawLyrics(); } return; }
      // romanizing only: don't contact Google at all for songs that are already in Latin letters
      if (!S.lyrTranslate && !lyr.lines.some((l) => NON_LATIN.test(l.text || ''))) return;
      const key = lyr.key, target = S.lyrLang || 'en', ck = key + '|' + target;
      let res = transCache.get(ck);
      if (!res) {
        try { res = await invoke('res_translate', { lines: lyr.lines.map((l) => l.text || ''), target }); } catch (e) { return; }
        transCache.set(ck, res);
        if (transCache.size > 40) transCache.delete(transCache.keys().next().value); // keep only recent songs
      }
      if (lyr.key !== key || !res || !res.lines) return;
      const same = String(res.lang || '').split('-')[0] === target.split('-')[0];
      lyr.trans = !S.lyrTranslate || same ? null : res.lines.map((t, i) => (t && t.toLowerCase() !== String(lyr.lines[i].text || '').toLowerCase() ? t : ''));
      const rom = S.lyrRoman && Array.isArray(res.roman) ? res.roman.map((r, i) => (r && NON_LATIN.test(lyr.lines[i].text || '') && r !== lyr.lines[i].text ? r : '')) : null;
      lyr.roman = rom && rom.some(Boolean) ? rom : null;
      drawLyrics(); fsDrawLyrics();
    }
    $('#setLyrLang').addEventListener('change', (e) => { S.lyrLang = e.target.value; saveS(); lyr.trans = null; drawLyrics(); fsDrawLyrics(); translateLyrics(); });

    // ---------- pop-out video ----------
    $('#btnPip').onclick = async () => {
      if (!R()) return;
      const r = await R().pip();
      if (r === 'unsupported') toast('Pop-out video isn’t supported by this version of WebView2');
      else if (r === 'none') toast('Play something first');
      else if (String(r).startsWith('error')) toast("Couldn't pop out the video: " + r.slice(7));
      setTimeout(() => $('#btnPip').classList.toggle('active', !!(R() && R().pipActive())), 300);
    };

    // ---------- listening history ----------
    let listenHist = [];
    try { listenHist = JSON.parse(localStorage.getItem('res-history') || '[]'); } catch (e) {}
    function historyAdd(s) {
      if (!s.videoId) return;
      if (listenHist[0] && listenHist[0].id === s.videoId && Date.now() - listenHist[0].at < 15 * 60000) return;
      listenHist.unshift({ id: s.videoId, t: s.title, a: s.artist, art: s.art || '', at: Date.now() });
      if (listenHist.length > 1000) listenHist.length = 1000;
      try { localStorage.setItem('res-history', JSON.stringify(listenHist)); } catch (e) {}
    }
    function dayLabel(ts) {
      const d = new Date(ts), t = new Date(); t.setHours(0, 0, 0, 0);
      const diff = Math.floor((t - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
      return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== t.getFullYear() ? 'numeric' : undefined });
    }
    function drawHistory() {
      const q = $('#histSearch').value.trim().toLowerCase();
      const list = listenHist.filter((h) => !q || (h.t + ' ' + h.a).toLowerCase().includes(q));
      if (!list.length) return setHTML($('#histList'), `<div class="lib-empty">${listenHist.length ? 'No matches.' : 'Songs you listen to for 30 seconds or more show up here.'}</div>`);
      let last = '', html = '';
      list.slice(0, 400).forEach((h) => {
        const lab = dayLabel(h.at);
        if (lab !== last) { html += `<div class="h-day">${esc(lab)}</div>`; last = lab; }
        html += `<button class="h-row" data-id="${esc(h.id)}">${h.art ? `<img src="${esc(h.art)}" alt="" loading="lazy">` : '<i class="st-ph"></i>'}<div class="st-meta"><div class="st-t">${esc(h.t)}</div><div class="st-s">${esc(h.a)}</div></div><span class="h-time">${new Date(h.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></button>`;
      });
      setHTML($('#histList'), html);
    }
    function openHistory() { closeMenu(); closeCtx(); $('#settingsModal').hidden = true; $('#histSearch').value = ''; drawHistory(); $('#historyModal').hidden = false; setTimeout(() => $('#histSearch').focus(), 50); }
    $('#miHistory').onclick = openHistory;
    $('#histSearch').addEventListener('input', drawHistory);
    $('#histList').addEventListener('click', (e) => { const r = e.composedPath()[0].closest('.h-row'); if (r && R()) { R().cmd('resume', { videoId: r.dataset.id, time: 0 }); $('#historyModal').hidden = true; toast('Playing…'); } });

    // ---------- year in music recap ----------
    function openRecap() {
      closeMenu(); closeCtx(); $('#settingsModal').hidden = true; statsSave();
      const yr = String(new Date().getFullYear());
      const agg = { t: 0, s: {}, a: {}, p: {}, months: {}, best: ['', 0] };
      for (const [d, v] of Object.entries(stats.days)) {
        if (!d.startsWith(yr)) continue;
        agg.t += v.t; agg.months[d.slice(5, 7)] = (agg.months[d.slice(5, 7)] || 0) + v.t;
        if (v.t > agg.best[1]) agg.best = [d, v.t];
        for (const [k, x] of Object.entries(v.s)) agg.s[k] = (agg.s[k] || 0) + x;
        for (const [k, x] of Object.entries(v.a)) agg.a[k] = (agg.a[k] || 0) + x;
        for (const [k, x] of Object.entries(v.p || {})) agg.p[k] = (agg.p[k] || 0) + x;
      }
      const songs = Object.entries(agg.s).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const artists = Object.entries(agg.a).sort((a, b) => b[1] - a[1]);
      const topMonth = Object.entries(agg.months).sort((a, b) => b[1] - a[1])[0];
      const share = artists.length ? artists[0][1] / Math.max(1, agg.t) : 0;
      const persona = !artists.length ? '' : share > 0.3 ? ['Superfan', `Almost a third of your listening was ${artists[0][0]}.`] : artists.length > 60 ? ['Explorer', `You listened to ${artists.length} different artists.`] : Object.keys(agg.s).length < 40 ? ['Repeat lover', 'You know what you like and play it on repeat.'] : ['All-rounder', 'A healthy mix of favourites and new finds.'];
      const mins = Math.round(agg.t / 60);
      const monthName = topMonth ? new Date(Number(yr), Number(topMonth[0]) - 1, 1).toLocaleDateString(undefined, { month: 'long' }) : '';
      setHTML($('#recap'), !agg.t ? `<div class="rc-sec"><div class="rc-k">${yr}</div><div class="rc-big">Nothing yet</div><div class="rc-s">Listen to some music and come back — your recap builds up as you play.</div><button class="btn-small" data-close>Close</button></div>` : `
        <button class="icon-btn rc-x" data-close>${ic('close')}</button>
        <div class="rc-sec rc-a"><div class="rc-k">Your ${yr} in music</div><div class="rc-big"><span class="rc-count" data-to="${mins}">0</span> minutes</div><div class="rc-s">That's ${esc(fmtDur(agg.t))} of music this year.</div></div>
        ${artists.length ? `<div class="rc-sec rc-b"><div class="rc-k">Your top artist</div><div class="rc-big">${esc(artists[0][0])}</div><div class="rc-s">${esc(fmtDur(artists[0][1]))} together · ${Math.round(share * 100)}% of your listening</div>
          <div class="rc-list">${artists.slice(1, 5).map(([a, v], i) => `<div><b>${i + 2}</b>${esc(a)}<span>${esc(fmtDur(v))}</span></div>`).join('')}</div></div>` : ''}
        ${songs.length ? `<div class="rc-sec rc-c"><div class="rc-k">Your top songs</div><div class="rc-songs">${songs.map(([k, v], i) => { const m = stats.meta[k] || [k, '', '']; return `<div class="rc-song"><b>${i + 1}</b>${m[2] ? `<img src="${esc(m[2])}" alt="">` : '<i class="st-ph"></i>'}<div><div class="st-t">${esc(m[0])}</div><div class="st-s">${esc(m[1])} · ${agg.p[k] || 0} plays</div></div></div>`; }).join('')}</div></div>` : ''}
        <div class="rc-sec rc-d"><div class="rc-k">Your listening style</div><div class="rc-big">${esc(persona[0] || '')}</div><div class="rc-s">${esc(persona[1] || '')}</div>
          <div class="rc-facts">${monthName ? `<div><span>Busiest month</span><b>${esc(monthName)}</b></div>` : ''}${agg.best[0] ? `<div><span>Biggest day</span><b>${esc(new Date(agg.best[0]).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))} · ${esc(fmtDur(agg.best[1]))}</b></div>` : ''}<div><span>Different songs</span><b>${Object.keys(agg.s).length}</b></div><div><span>Artists</span><b>${artists.length}</b></div></div></div>`);
      $('#recapModal').hidden = false;
      const c = $('#recap .rc-count');
      if (c) { const to = Number(c.dataset.to), t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / 1400); c.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString(); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
    }
    $('#miRecap').onclick = openRecap;

    // ---------- equalizer ----------
    const EQ_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
    const EQ_PRESETS = { Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], Treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6], Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1], Rock: [4, 3, 1, -1, -1, 1, 3, 4, 4, 4], Electronic: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5], 'Lo-fi': [3, 2, 1, 0, -1, -2, -3, -4, -5, -6] };
    function eqState() { return R() && R().fxState ? R().fxState() : { eqOn: false, eq: EQ_PRESETS.Flat.slice() }; }
    function drawEq() {
      const st = eqState();
      $('#setEq').checked = !!st.eqOn;
      const match = Object.entries(EQ_PRESETS).find(([, v]) => v.every((x, i) => x === Math.round(st.eq[i])));
      setHTML($('#eqPresets'), Object.keys(EQ_PRESETS).map((k) => `<button data-p="${esc(k)}" class="${match && match[0] === k ? 'on' : ''}">${esc(k)}</button>`).join('') + `<button class="${match ? '' : 'on'}" disabled>Custom</button>`);
      setHTML($('#eqBands'), st.eq.map((v, i) => `<div class="eq-band"><span class="eq-v">${v > 0 ? '+' : ''}${Math.round(v)}</span><input type="range" min="-12" max="12" step="1" value="${Math.round(v)}" data-b="${i}"><span class="eq-f">${EQ_LABELS[i]}</span></div>`).join(''));
      $('#eqBands').classList.toggle('off', !st.eqOn);
    }
    $('#setEq').addEventListener('change', (e) => { R() && R().setFx({ eqOn: e.target.checked }); drawEq(); eqRemember(); });
    $('#eqPresets').addEventListener('click', (e) => { const b = e.composedPath()[0].closest('[data-p]'); if (!b || !R()) return; R().setFx({ eq: EQ_PRESETS[b.dataset.p].slice(), eqOn: true }); drawEq(); eqRemember(); });
    $('#eqBands').addEventListener('input', (e) => {
      const r = e.composedPath()[0];
      if (!r.dataset || r.dataset.b == null || !R()) return;
      const eq = eqState().eq; eq[Number(r.dataset.b)] = Number(r.value);
      R().setFx({ eq, eqOn: true });
      r.parentElement.querySelector('.eq-v').textContent = (r.value > 0 ? '+' : '') + r.value;
      $('#setEq').checked = true; $('#eqBands').classList.remove('off');
    });
    $('#eqBands').addEventListener('change', () => { drawEq(); eqRemember(); });

    // ---------- start with Windows ----------
    $('#setAutostart').addEventListener('change', () => {
      const box = $('#setAutostart'), want = box.checked;
      invoke('res_autostart', { value: want }).then((v) => { box.checked = !!v; $('#rowStartMin').classList.toggle('dim', !v); toast(v ? 'Resonance will start with Windows' : 'Resonance won\u2019t start with Windows'); })
        .catch((x) => { toast("Couldn't change that: " + x); box.checked = !want; });
    });
    $('#setStartMin').addEventListener('change', (e) => invoke('res_set_pref', { key: 'startMinimized', value: e.target.checked }).catch(() => {}));

    // ---------- health check ----------
    let hcText = '';
    async function runHealth() {
      setHTML($('#hcList'), '<div class="lib-empty">Testing…</div>');
      const rows = [];
      const t0 = Date.now();
      try { await invoke('res_get_prefs'); rows.push({ group: 'App', name: 'Native features (Tauri)', ok: true, detail: '' }); } catch (e) { rows.push({ group: 'App', name: 'Native features (Tauri)', ok: false, detail: String(e) }); }
      try { const d = R() ? await R().diagnostics() : []; rows.push(...d); } catch (e) { rows.push({ group: 'Player', name: 'Player bridge', ok: false, detail: String(e) }); }
      try { const l = await invoke('res_lyrics', { artist: 'The White Stripes', title: 'Seven Nation Army', album: '', duration: 232 }); rows.push({ group: 'Extras', name: 'Lyrics service (LRCLIB)', ok: !!(l && (l.synced || l.plain)), detail: l && l.synced ? 'synced lyrics available' : l ? 'reachable' : 'no answer' }); } catch (e) { rows.push({ group: 'Extras', name: 'Lyrics service (LRCLIB)', ok: false, detail: String(e) }); }
      if (S.lyrTranslate) { try { const t = await invoke('res_translate', { lines: ['Hola'], target: 'en' }); rows.push({ group: 'Extras', name: 'Lyrics translation', ok: !!(t && t.lines && t.lines[0]), detail: t && t.lines ? '“Hola” → “' + t.lines[0] + '”' : '' }); } catch (e) { rows.push({ group: 'Extras', name: 'Lyrics translation', ok: false, detail: String(e) }); } }
      rows.push({ group: 'Extras', name: 'Discord status', ok: S.discord ? !!S.discordId : null, detail: !S.discord ? 'turned off' : S.discordId ? 'configured (needs Discord running)' : 'missing application ID' });
      rows.push({ group: 'Extras', name: 'Update checks', ok: S.autoUpdate ? true : null, detail: (S.autoUpdate ? 'automatic, ' : 'manual, ') + 'from github.com/' + UPDATE_REPO });
      const groups = [...new Set(rows.map((r) => r.group))];
      const icon = (ok) => ok === true ? '<span class="hc-i ok">✓</span>' : ok === false ? '<span class="hc-i bad">✕</span>' : '<span class="hc-i na">–</span>';
      const bad = rows.filter((r) => r.ok === false).length;
      setHTML($('#hcList'), `<div class="hc-sum ${bad ? 'bad' : 'ok'}">${bad ? bad + ' problem' + (bad === 1 ? '' : 's') + ' found' : 'Everything that was tested works'} · ${((Date.now() - t0) / 1000).toFixed(1)} s</div>` +
        groups.map((g) => `<div class="hc-g">${esc(g)}</div>` + rows.filter((r) => r.group === g).map((r) => `<div class="hc-row">${icon(r.ok)}<span class="hc-n">${esc(r.name)}</span><span class="hc-d">${esc(r.detail)}</span></div>`).join('')).join(''));
      hcText = 'Resonance health check — ' + new Date().toLocaleString() + '\n' + rows.map((r) => `${r.ok === true ? 'OK ' : r.ok === false ? 'FAIL' : ' -- '}  ${r.group} / ${r.name}${r.detail ? ' — ' + r.detail : ''}`).join('\n');
      const lt = await drawLogs();
      if (lt) hcText += '\n\nRecent problems:\n' + lt;
    }
    $('#hcRun').onclick = runHealth;
    $('#hcCopy').onclick = () => { const done = () => toast('Report copied'); (navigator.clipboard ? navigator.clipboard.writeText(hcText) : Promise.reject()).then(done).catch(() => { const ta = document.createElement('textarea'); ta.value = hcText; root.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }); };

    // ---------- command palette ( type ">" in the search box ) ----------
    const CMDS = [
      ['play', 'Play / pause', () => $('#btnPlay').click()], ['next', 'Next song', () => cmd('next')], ['previous', 'Previous song', () => cmd('prev')],
      ['like', 'Like / unlike', () => $('#btnLike').click()], ['shuffle', 'Shuffle on / off', () => $('#btnShuffle').click()], ['repeat', 'Repeat mode', () => cmd('repeat')], ['mute', 'Mute / unmute', () => cmd('mute')],
      ['volume', 'Volume …  (e.g. >volume 40)', (a) => { const v = parseInt(a, 10); if (!isNaN(v)) { setVol(v); toast('Volume ' + Math.max(0, Math.min(100, v)) + '%'); } else toast('Usage: >volume 0-100'); }],
      ['sleep', 'Sleep timer …  (>sleep 30, >sleep end, >sleep off)', (a) => { a = String(a || '').trim(); if (a === 'off') setSleep(null); else if (a === 'end') setSleep('end'); else if (parseInt(a, 10) > 0) setSleep(parseInt(a, 10)); else { updateSleepUI(); placePop($('#btnSleep')); } }],
      ['mini', 'Mini player', () => setMini(true)], ['fullscreen', 'Full-screen view', () => setFs(true)], ['lyrics', 'Show lyrics', () => { setNp(true); setNpTab('lyrics'); }],
      ['queue', 'Show queue', () => { setNp(true); setNpTab('queue'); }], ['pip', 'Pop-out video', () => $('#btnPip').click()],
      ['home', 'Go to Home', () => R() && R().nav('home')], ['explore', 'Go to Explore', () => R() && R().nav('explore')], ['library', 'Go to Library', () => R() && R().nav('library')], ['liked', 'Go to Liked Music', () => R() && R().nav({ browseId: 'VLLM' })],
      ['history', 'Listening history', () => openHistory()], ['stats', 'Listening stats', () => openStats()], ['recap', 'Your year in music', () => openRecap()],
      ['settings', 'Settings', () => openSettings('general')], ['appearance', 'Appearance settings', () => openSettings('appearance')], ['equalizer', 'Equalizer', () => openSettings('eq')],
      ['shortcuts', 'Keyboard shortcuts settings', () => openSettings('shortcuts')], ['health', 'Health check', () => { openSettings('health'); runHealth(); }],
      ['theme', 'Theme …  (>theme dark / light / system / a saved theme)', (a) => {
        a = String(a || '').trim().toLowerCase();
        const t = allThemes().find((x) => x.name.toLowerCase() === a);
        if (t) { pickTheme(t); toast('Theme: ' + t.name); }
        else if (['dark', 'light', 'system', 'custom'].includes(a)) { S.theme = a; saveS(); applyPrefs(); toast('Theme: ' + a); }
        else openSettings('appearance');
      }],
      ['savequeue', 'Save the queue as a playlist', () => saveQueue()],
      ['sidebar', 'Collapse / expand sidebar', () => $('#btnSidebar').click()], ['reload', 'Reload YouTube Music', () => location.reload()],
    ];
    const palette = $('#palette');
    let palSel = 0, palList = [];
    function palUpdate() {
      const v = input.value;
      if (!v.startsWith('>')) { palette.hidden = true; return; }
      const [word] = v.slice(1).trim().split(/\s+/);
      const q = (word || '').toLowerCase();
      palList = CMDS.filter(([k, l]) => !q || k.startsWith(q) || l.toLowerCase().includes(q)).slice(0, 9);
      palSel = Math.min(palSel, Math.max(0, palList.length - 1));
      setHTML(palette, palList.length ? palList.map(([k, l], i) => `<button class="pal-item${i === palSel ? ' sel' : ''}" data-i="${i}"><span class="pal-k">&gt;${esc(k)}</span><span>${esc(l)}</span></button>`).join('') : '<div class="pal-empty">No matching command</div>');
      palette.hidden = false;
    }
    // Opened with the global hotkey: Resonance pops up, and goes back where it was afterwards
    // (unless the command opened something to look at).
    let palReturn = '';
    const PAL_STAYS = new Set(['mini', 'fullscreen', 'lyrics', 'queue', 'home', 'explore', 'library', 'liked', 'history', 'stats', 'recap', 'settings', 'appearance', 'equalizer', 'shortcuts', 'health', 'savequeue', 'sleep', 'theme']);
    function palGoBack(cmdKey, arg) {
      const r = palReturn; palReturn = '';
      if (!r || (cmdKey && PAL_STAYS.has(cmdKey) && !(cmdKey === 'sleep' && arg) && !(cmdKey === 'theme' && arg))) return;
      setTimeout(() => { if (r === 'hidden') invoke('res_win', { action: 'hide' }).catch(() => {}); else if (r === 'minimized') invoke('res_win', { action: 'minimize' }).catch(() => {}); }, cmdKey ? 700 : 150);
    }
    window.__resPalette = (prev) => {
      if (miniOn) setMini(false);
      if (fsOn) setFs(false);
      palReturn = prev === 'hidden' || prev === 'minimized' ? prev : '';
      closeCtx(); $$('.backdrop').forEach((m) => (m.hidden = true));
      setTimeout(() => { input.focus(); input.value = '>'; palSel = 0; palUpdate(); }, 60);
    };
    function palRun(i) {
      const c = palList[i == null ? palSel : i];
      if (!c) return;
      const arg = input.value.slice(1).trim().split(/\s+/).slice(1).join(' ');
      input.value = ''; palette.hidden = true; input.blur();
      c[2](arg);
      palGoBack(c[0], arg);
    }
    input.addEventListener('input', () => { palSel = 0; palUpdate(); });
    input.addEventListener('keydown', (e) => {
      if (palette.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); palSel = (palSel + 1) % Math.max(1, palList.length); palUpdate(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = (palSel - 1 + palList.length) % Math.max(1, palList.length); palUpdate(); }
      else if (e.key === 'Tab') { e.preventDefault(); if (palList[palSel]) { input.value = '>' + palList[palSel][0] + ' '; palUpdate(); } }
    });
    palette.addEventListener('mousedown', (e) => { const b = e.composedPath()[0].closest('.pal-item'); if (b) { e.preventDefault(); palRun(Number(b.dataset.i)); } });
    input.addEventListener('blur', () => setTimeout(() => { palette.hidden = true; if (palReturn) palGoBack('', ''); }, 120));
    $('#searchForm').addEventListener('submit', (e) => { if (input.value.startsWith('>')) { e.preventDefault(); e.stopImmediatePropagation(); palRun(); } }, true);

    // ---------- right-click menu (replaces the browser's) ----------
    const ctx = $('#ctx');
    function closeCtx() { ctx.hidden = true; }
    function openCtx(x, y, target) {
      closeMenu();
      const s = state || {};
      const has = !!s.hasTrack;
      const sel = String(window.getSelection ? window.getSelection() : '').trim();
      const nav = window.navigation;
      const items = [];
      if (sel) items.push(['copy', 'Copy', 'Ctrl+C'], 'sep');
      items.push(
        ['toggle', s.playing ? 'Pause' : 'Play', 'Space', has || (R() && R().last && R().last())],
        ['prev', 'Previous', 'Ctrl+←', has], ['next', 'Next', 'Ctrl+→', has],
        ['shuffle', 'Shuffle', s.shuffle ? '✓' : '', true],
        'sep',
        ['back', 'Back', 'Alt+←', nav && 'canGoBack' in nav ? nav.canGoBack : true],
        ['forward', 'Forward', 'Alt+→', nav && 'canGoForward' in nav ? nav.canGoForward : true],
        ['reload', 'Reload', 'Ctrl+R', true],
        'sep',
        ['sidebar', S.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar', '', true],
        ['np', S.npOpen ? 'Hide now playing' : 'Show now playing', '', true],
        ['player', s.playerPageOpen ? 'Close full player' : 'Open full player', '', has],
        ['lyrics', 'Lyrics', '', true],
        ['mini', 'Mini player', '', true],
        ['sleep', sleep ? 'Sleep timer · ' + (sleep.mode === 'end' ? 'end of song' : Math.ceil((sleep.until - Date.now()) / 60000) + ' min') : 'Sleep timer…', '', true],
        ['stats', 'Your listening stats', '', true],
        ['history', 'Listening history', '', true],
        ['fs', 'Full-screen view', 'F11', true],
        ['pip', 'Pop-out video', '', has],
        'sep',
        ['settings', 'Settings…', '', true], ['appearance', 'Appearance…', '', true], ['layouts', 'Taskbar player layouts…', '', true],
      );
      setHTML(ctx, items.map((it) => it === 'sep' ? '<div class="ctx-sep"></div>' :
        `<button class="ctx-item" data-a="${it[0]}"${it[3] === false ? ' disabled' : ''}><span>${esc(it[1])}</span><kbd class="ctx-k">${esc(it[2] || '')}</kbd></button>`).join(''));
      ctx.hidden = false;
      const r = ctx.getBoundingClientRect();
      ctx.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
      ctx.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
    }
    ctx.addEventListener('click', (e) => {
      const b = e.composedPath()[0].closest('.ctx-item');
      if (!b || b.disabled || !b.dataset.a) return;
      closeCtx();
      const a = b.dataset.a;
      if (a === 'copy') document.execCommand('copy');
      else if (['toggle', 'prev', 'next'].includes(a)) ({ toggle: () => $('#btnPlay').click(), prev: () => cmd('prev'), next: () => cmd('next') })[a]();
      else if (a === 'shuffle') $('#btnShuffle').click();
      else if (a === 'back') window.history.back();
      else if (a === 'forward') window.history.forward();
      else if (a === 'reload') location.reload();
      else if (a === 'sidebar') $('#btnSidebar').click();
      else if (a === 'np') setNp(!S.npOpen);
      else if (a === 'player') cmd('playerPage');
      else if (a === 'lyrics') { setNp(true); setNpTab('lyrics'); }
      else if (a === 'mini') setMini(true);
      else if (a === 'sleep') { updateSleepUI(); placePop($('#btnSleep').offsetParent ? $('#btnSleep') : null); }
      else if (a === 'stats') openStats();
      else if (a === 'history') openHistory();
      else if (a === 'fs') setFs(true);
      else if (a === 'pip') $('#btnPip').click();
      else if (a === 'settings') openSettings('general');
      else if (a === 'appearance') openSettings('appearance');
      else if (a === 'layouts') { openSettings('taskbar'); $('#btnEditLayout').click(); }
    });
    // One right-click menu: Resonance's. YouTube Music's own menu never opens (its items are
    // shown here instead), and the browser's menu only appears in text fields.
    const NOW_ZONES = '.pb-left, .np-art, #npTitle, #npArtist, .fsv-left, .mini-row, .mini-ctrl';
    onCtx = (e) => {
      const path = e.composedPath();
      const t = path[0];
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) { e.stopImmediatePropagation(); return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (R()) { try { R().closeMenus(); } catch (x) {} }
      const inShell = path.includes(root);
      const at = (sel) => (inShell && t && t.closest ? t.closest(sel) : null);
      const pl = at('#plDyn .pl-item'), fo = at('#plDyn .pl-folder'), qi = at('#queue .q-item');
      if (pl) return playlistMenu(pl.dataset.browse, e.clientX, e.clientY);
      if (fo) return folderMenu(fo.dataset.fid, e.clientX, e.clientY);
      if (qi) return songCtx({ queue: Number(qi.dataset.q) }, e.clientX, e.clientY, [['play', 'Play now', '', true, 'play2']]);
      if (at(NOW_ZONES) && state && state.hasTrack) return songCtx('current', e.clientX, e.clientY, trimItems(), trimPick);
      if (!inShell && t && t.closest && t.closest(SONG_ROWS)) return songCtx(t, e.clientX, e.clientY);
      ctxPick = null;
      openCtx(e.clientX, e.clientY, t);
    };

    // ---------- song / album / playlist menus (YouTube Music's items, Resonance's look) ----------
    const SONG_ROWS = 'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-player-queue-item, ytmusic-multi-row-list-item-renderer, ytmusic-responsive-header-renderer, ytmusic-detail-header-renderer, ytmusic-immersive-header-renderer, ytmusic-card-shelf-renderer';
    const MENU_IC = {
      MIX: 'radio', RADIO: 'radio', QUEUE_PLAY_NEXT: 'playNext', ADD_TO_REMOTE_QUEUE: 'queue', ADD_TO_QUEUE_TAIL: 'queue', QUEUE_MUSIC: 'queue',
      ADD_TO_PLAYLIST: 'playlistAdd', PLAYLIST_ADD: 'playlistAdd', ALBUM: 'album', ARTIST: 'user', PERSON: 'user', SHARE: 'share',
      REMOVE: 'trash', DELETE: 'trash', REMOVE_FROM_PLAYLIST: 'trash', DISMISS_QUEUE: 'close', CLEAR: 'close', KEEP: 'pin', KEEP_OFF: 'pin', PUSH_PIN: 'pin',
      NOT_INTERESTED: 'block', FLAG: 'flag', OFFLINE_DOWNLOAD: 'download', DOWNLOAD: 'download', SHUFFLE: 'shuffle', PLAY_ARROW: 'play2', EDIT: 'edit',
      SUBSCRIBE: 'plus', SUBSCRIBED: 'check', LINK: 'link', INFO: 'note', MUSIC_NOTE: 'note',
    };
    const guessIc = (label) => {
      const l = label.toLowerCase();
      if (/radio/.test(l)) return 'radio';
      if (/next|następn|nächstes|continuación|ensuite/.test(l)) return 'playNext';
      if (/queue|kolejk|warteschlange|cola\b|file d/.test(l)) return 'queue';
      if (/playlist|playlis/.test(l)) return 'playlistAdd';
      if (/album/.test(l)) return 'album';
      if (/artist|wykonawc|künstler|artista|artiste/.test(l)) return 'user';
      if (/share|udostępnij|teilen|compartir|partager/.test(l)) return 'share';
      if (/remove|usuń|entfernen|quitar|retirer|delete/.test(l)) return 'trash';
      if (/download|pobierz/.test(l)) return 'download';
      return 'dots';
    };
    function copyText(t) {
      const fallback = () => { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-9999px;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (x) {} ta.remove(); };
      try { navigator.clipboard.writeText(t).catch(fallback); } catch (x) { fallback(); }
    }
    const linkFor = (ids) => (ids.videoId ? 'https://music.youtube.com/watch?v=' + ids.videoId : ids.playlistId ? 'https://music.youtube.com/playlist?list=' + ids.playlistId : '');

    async function songCtx(where, x, y, extra, onExtra) {
      let m = null;
      try { m = R() ? await R().songMenu(where) : null; } catch (er) { m = null; }
      if (!m || !m.items.length) {
        if (extra && where && typeof where === 'object' && 'queue' in where) return queueMenu(where.queue, x, y);
        ctxPick = null; return openCtx(x, y, null);
      }
      const items = [];
      if (m.title) items.push(['head', m.title]);
      (extra || []).forEach((it) => items.push(it));
      if (extra && extra.length) items.push('sep');
      m.items.forEach((it, i) => items.push(['m' + i, it.label, '', true, MENU_IC[it.icon] || guessIc(it.label)]));
      const link = linkFor(m.ids);
      if (link && !m.items.some((it) => it.kind === 'share')) items.push('sep', ['link', 'Copy link', '', true, 'link']);
      openCustomCtx(x, y, items, async (c) => {
        if (c === 'play' && where && typeof where === 'object') { R().playQueue(where.queue); qKey = ''; setTimeout(refreshQueue, 500); return; }
        if (onExtra && extra && extra.some((it) => it !== 'sep' && it[0] === c)) return onExtra(c);
        if (c === 'link') { copyText(link); toast('Link copied'); return; }
        const it = m.items[Number(c.slice(1))];
        if (!it) return;
        if (it.kind === 'playlist') return openSavePl(it.target || (m.ids.videoId ? { videoId: m.ids.videoId } : m.ids.playlistId ? { playlistId: m.ids.playlistId } : null), m.title);
        if (it.kind === 'share' && link) { copyText(link); toast('Link copied'); return; }
        const ok = await R().runMenu(it.label);
        if (!ok) toast("YouTube Music didn't respond to that — try again");
        qKey = ''; setTimeout(refreshQueue, 600); setTimeout(refreshPlaylists, 1500);
      });
    }

    // ---------- save to playlist (own picker; YouTube Music's dialog doesn't fit the app) ----------
    let splTarget = null, splList = [], splBusy = false;
    const PRIV = { PRIVATE: 'Private', PUBLIC: 'Public', UNLISTED: 'Unlisted' };
    async function openSavePl(target, title) {
      if (!target) { toast("Couldn't tell which song that is"); return; }
      closeCtx();
      if (miniOn) setMini(false); // the picker needs the full window
      if (fsOn) setFs(false);
      splTarget = target;
      $('#splSub').textContent = title || '';
      setHTML($('#splList'), '<div class="lib-empty">Loading your playlists…</div>');
      $('#savePlModal').hidden = false;
      let list = null;
      try { list = await R().addToPlaylistOptions(target); } catch (er) {}
      if (splTarget !== target) return;
      if (!list) list = [...plData.values()].filter((p) => /^VL/.test(p.id) && !/^VL(LM|SE)$/.test(p.id)).map((p) => ({ id: p.id.slice(2), title: p.title, has: false, privacy: '' }));
      splList = list;
      drawSavePl();
    }
    function drawSavePl() {
      if (!splList.length) { setHTML($('#splList'), '<div class="lib-empty">No playlists yet — create one above.</div>'); return; }
      setHTML($('#splList'), splList.map((p, i) => {
        const meta = plData.get('VL' + p.id);
        const th = S.plCovers !== false && meta && meta.thumb;
        return `<button class="spl-item${p.has ? ' on' : ''}" data-i="${i}" title="${esc(p.title)}">${th ? `<img src="${esc(th)}" alt="" loading="lazy">` : `<div class="spl-ph">${esc(((p.title || '?').trim()[0] || '?').toUpperCase())}</div>`}<div class="spl-meta"><div class="spl-t">${esc(p.title)}</div><div class="spl-s">${esc(PRIV[p.privacy] || (meta && meta.subtitle) || '')}</div></div><span class="spl-check">${ic('check')}</span></button>`;
      }).join(''));
    }
    $('#splList').addEventListener('click', async (e) => {
      const b = e.composedPath()[0].closest('.spl-item');
      if (!b || splBusy) return;
      const p = splList[Number(b.dataset.i)];
      if (!p) return;
      const add = !p.has || !!splTarget.playlistId;
      splBusy = true; b.classList.add('busy');
      const ok = await R().editPlaylist(p.id, splTarget, add).catch(() => false);
      splBusy = false; b.classList.remove('busy');
      if (!ok) { toast("YouTube Music didn't accept that — try again"); return; }
      p.has = add;
      drawSavePl();
      toast(add ? 'Saved to ' + p.title : 'Removed from ' + p.title);
      plKey = ''; setTimeout(refreshPlaylists, 800);
    });
    $('#splNew').onclick = () => {
      const target = splTarget;
      askName('New playlist', '', async (name) => {
        const id = await R().createPlaylist(name, target).catch(() => null);
        if (!id) { toast("Couldn't create the playlist"); return; }
        toast('Created "' + name + '" and saved');
        $('#savePlModal').hidden = true;
        plKey = ''; setTimeout(refreshPlaylists, 800);
      });
    };

    // ---------- Bluetooth & audio output ----------
    let dev = null, devBusy = '', devBusyT = 0, devWant = '';
    const DEV_IC = { audio: 'headphones', input: 'mouse', phone: 'phone', other: 'devices' };
    const isHeadset = (n) => /\b(head(phones?|set)|ear(phones?|buds?)|buds|air ?pods|słuchawki|kopfhörer|casque|auriculares|cuffie|hands-free)\b/i.test(n || '');
    const outIc = (o) => (/hdmi|displayport|display audio|monitor|\btv\b|nvidia|amd high definition|intel\(r\) display/i.test(o.name) && !o.bt ? 'monitor' : o.bt || isHeadset(o.name) ? 'headphones' : 'speaker');
    function devSummary() {
      if (!dev || S.devices === false) return null;
      const outs = dev.outputs || [];
      const def = outs.find((o) => o.default);
      if (dev.bt === 'none') return { icon: def ? outIc(def) : 'speaker', pct: null, cls: '', title: 'Audio output: ' + (def ? def.name : 'system default') };
      if (dev.bt === 'off') return { icon: 'btOff', pct: null, cls: 'off', title: 'Bluetooth is off — click to change' };
      const p = (dev.devices || [])[0];
      if (!p) return { icon: 'bt', pct: null, cls: '', title: 'Bluetooth on · nothing connected' };
      return { icon: 'btConn', pct: p.battery, cls: 'conn' + (p.battery != null && p.battery <= 20 ? ' low' : ''), title: p.name + (p.battery != null ? ' · ' + p.battery + '% battery' : ' · connected') };
    }
    const battHTML = (b) => (b == null ? '' : `<span class="batt${b <= 20 ? ' low' : ''}"><i style="width:${Math.max(8, Math.min(100, b))}%"></i></span><span class="batt-t">${b}%</span>`);
    function devPanelHTML() {
      if (!dev) return '<div class="dv-empty">Looking for devices…</div>';
      let h = '';
      if (dev.bt !== 'none') {
        const on = dev.bt === 'on', n = (dev.devices || []).length;
        const sub = devBusy || (on ? (n ? n + (n > 1 ? ' devices' : ' device') + ' connected' : 'On · nothing connected') : 'Off');
        h += `<div class="dv-head"><div class="dv-ic${on ? ' on' : ''}">${ic(on ? (n ? 'btConn' : 'bt') : 'btOff')}</div><div class="dv-hm"><div class="dv-t">Bluetooth</div><div class="dv-s">${esc(sub)}</div></div><input type="checkbox" class="toggle" data-dv="bt" title="Turn Bluetooth ${on ? 'off' : 'on'}"${on ? ' checked' : ''}${devBusy ? ' disabled' : ''}></div>`;
        if (on && n) h += '<div class="dv-list">' + dev.devices.map((d) => `<div class="dv-row"><span class="dv-ri">${ic(DEV_IC[d.kind] || 'devices')}</span><span class="dv-n" title="${esc(d.name)}">${esc(d.name)}</span>${d.battery == null ? '<span class="dv-nob">Connected</span>' : battHTML(d.battery)}</div>`).join('') + '</div>';
      }
      const outs = dev.outputs || [];
      h += '<div class="dv-sec">Audio output</div><div class="dv-list">' + (outs.length ? outs.map((o) =>
        `<button class="dv-row dv-out${o.default ? ' on' : ''}" data-out="${esc(o.id)}" title="${esc(o.name)}"><span class="dv-ri">${ic(outIc(o))}</span><span class="dv-n">${esc(o.name)}</span><span class="dv-ck">${o.default ? ic('check') : ''}</span></button>`).join('') : '<div class="dv-empty">No audio outputs found</div>') + '</div>';
      return h;
    }
    function paintDevBtn(btn, sm) {
      btn.hidden = !sm;
      if (!sm) return;
      btn.className = btn.className.replace(/\s*\b(off|conn|low)\b/g, '') + (sm.cls ? ' ' + sm.cls : '');
      btn.title = sm.title;
      setIcon(btn.querySelector('.dev-i'), sm.icon);
      btn.querySelector('.dev-p').textContent = sm.pct != null ? sm.pct + '%' : '';
      btn.classList.toggle('has-p', sm.pct != null);
    }
    function renderDev() {
      const sm = devSummary();
      paintDevBtn($('#btnDev'), sm);
      paintDevBtn($('#miniDev'), sm);
      if (!sm) { $('#devPop').hidden = true; $('#miniDevP').hidden = true; }
      if (!$('#devPop').hidden) setHTML($('#devPopBody'), devPanelHTML());
      if (!$('#miniDevP').hidden) setHTML($('#miniDevBody'), devPanelHTML());
    }
    window.__resDev = (st) => {
      if (st && st.error) toast(st.error, 5000);
      if (st && devBusy && (st.bt === devWant || st.error || Date.now() - devBusyT > 5000)) devBusy = '';
      const prev = dev;
      dev = st || null;
      renderDev();
      try { devHooks(prev, dev); } catch (e) { window.__resLog('device hooks: ' + e.message); }
    };
    function devAction(e) {
      const p = e.composedPath()[0];
      const out = p.closest && p.closest('[data-out]');
      if (out && e.type === 'click') {
        if (out.classList.contains('on')) return;
        const o = (dev.outputs || []).find((x) => x.id === out.dataset.out);
        dev.outputs.forEach((x) => (x.default = x.id === out.dataset.out));
        renderDev();
        invoke('res_set_output', { id: out.dataset.out }).catch((er) => toast("Couldn't switch: " + er));
        if (o) toast('Playing on ' + o.name);
        return;
      }
      if (e.type === 'change' && p.dataset && p.dataset.dv === 'bt') {
        const on = p.checked;
        devBusy = on ? 'Turning on…' : 'Turning off…'; devBusyT = Date.now(); devWant = on ? 'on' : 'off';
        renderDev();
        invoke('res_bt_power', { on }).catch((er) => { devBusy = ''; toast("Couldn't change Bluetooth: " + er); renderDev(); });
        setTimeout(() => { if (devBusy) { devBusy = ''; renderDev(); } }, 8000);
      }
    }
    for (const id of ['#devPopBody', '#miniDevBody']) { $(id).addEventListener('click', devAction); $(id).addEventListener('change', devAction); }
    function openDevPop() {
      const p = $('#devPop');
      if (!p.hidden) { p.hidden = true; return; }
      closeCtx(); pop.hidden = true;
      setHTML($('#devPopBody'), devPanelHTML());
      p.hidden = false;
      const r = $('#btnDev').getBoundingClientRect(), pr = p.getBoundingClientRect();
      p.style.left = Math.max(8, Math.min(innerWidth - pr.width - 8, r.left + r.width / 2 - pr.width / 2)) + 'px';
      p.style.top = Math.max(8, r.top - pr.height - 10) + 'px';
      invoke('res_devices', {}).catch(() => {});
    }
    $('#btnDev').onclick = (e) => { e.stopPropagation(); openDevPop(); };
    document.addEventListener('pointerdown', (e) => { const p = $('#devPop'); if (!p.hidden && !e.composedPath().includes(p) && !e.composedPath().includes($('#btnDev'))) p.hidden = true; }, true);
    $('#miniDev').onclick = (e) => { e.stopPropagation(); setHTML($('#miniDevBody'), devPanelHTML()); $('#miniDevP').hidden = false; invoke('res_devices', {}).catch(() => {}); };
    $('#miniDevClose').onclick = () => ($('#miniDevP').hidden = true);
    $('#setDevices').addEventListener('change', () => {
      S.devices = $('#setDevices').checked; saveS();
      if (!S.devices) { dev = null; renderDev(); }
      invoke('res_devices', { enabled: S.devices }).then((st) => { if (st && S.devices) window.__resDev(st); }).catch(() => {});
    });
    invoke('res_devices', { enabled: S.devices !== false }).then((st) => { if (st && S.devices !== false) window.__resDev(st); }).catch(() => {});

    document.addEventListener('pointerdown', (e) => { if (!ctx.hidden && !e.composedPath().includes(ctx)) closeCtx(); }, true);
    window.addEventListener('blur', closeCtx);
    window.addEventListener('scroll', closeCtx, true);

    const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
    const setWidth = (el, pct) => { const v = pct.toFixed(1) + '%'; if (el.style.width !== v) el.style.width = v; };
    function tick() {
      if (state && state.hasTrack && !seek.dragging) {
        let t = base.t + (state.playing ? (performance.now() - base.at) / 1000 : 0);
        if (state.duration) t = Math.min(t, state.duration);
        setText($('#tCur'), fmt(t));
        if (S.timeMode === 'remaining' && state.duration) setText($('#tDur'), '-' + fmt(state.duration - t));
        seek.set(state.duration ? t / state.duration : 0);
      }
      const nowT = performance.now();
      if (sbDirty || nowT - sbLast > 250) { sbDirty = false; sbLast = nowT; updateScrollbar(); }
      try { extraTick(); } catch (e) {}
      try { vizTick(); } catch (e) {}
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // ---------- queue ----------
    let qKey = '';
    function refreshQueue() {
      if (!S.npOpen || !R() || document.hidden) return;
      let q = [];
      try { q = R().queue(); } catch (e) { return; }
      const k = JSON.stringify(q);
      if (k === qKey) return;
      qKey = k;
      const el = $('#queue');
      if (!q.length) { setHTML(el, '<div class="lib-empty">Start a song, album or mix and your queue will show up here.</div>'); return; }
      setHTML(el, q.map((it) => `
        <button class="q-item${it.current ? ' current' : ''}" data-q="${it.i}" title="${esc(it.title)} — ${esc(it.artist)}">
          ${it.art ? `<img src="${esc(it.art)}" alt="" loading="lazy">` : '<div class="q-ph"></div>'}
          <div class="q-meta"><div class="q-title">${esc(it.title)}</div><div class="q-sub">${esc(it.artist)}</div></div>
          <span class="q-dur">${esc(it.duration)}</span></button>`).join(''));
      const cur = el.querySelector('.q-item.current');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }
    $('#queue').addEventListener('click', (e) => { if (Date.now() - (window.__resDragEnd || 0) < 250) return; const it = e.composedPath()[0].closest('.q-item'); if (it && R()) { R().playQueue(Number(it.dataset.q)); setTimeout(refreshQueue, 500); } });
    setInterval(refreshQueue, 2500);

    // ---------- custom page scrollbar ----------
    const vs = $('#vscroll'), vt = $('#vthumb');
    let vDrag = null;
    function metrics() {
      const se = document.scrollingElement || document.documentElement;
      const trackH = vs.clientHeight;
      const sh = se.scrollHeight, ch = innerHeight;
      const max = sh - ch;
      const thumbH = Math.max(36, trackH * (ch / Math.max(sh, 1)));
      return { se, trackH, max, thumbH };
    }
    var sbDirty = true, sbLast = 0, sbKey = '';
    window.addEventListener('scroll', () => { sbDirty = true; }, { passive: true, capture: true });
    function updateScrollbar() {
      const { se, trackH, max, thumbH } = metrics();
      const show = max > 4 && !(state && state.playerPageOpen) && $('#login').hidden;
      const top = show ? Math.round((trackH - thumbH) * (se.scrollTop / max)) : 0;
      const key = show + '|' + Math.round(thumbH) + '|' + top;
      if (key === sbKey) return;
      sbKey = key;
      vs.style.opacity = show ? '1' : '0';
      vs.style.pointerEvents = show ? 'auto' : 'none';
      if (!show) return;
      vt.style.height = thumbH + 'px';
      vt.style.top = top + 'px';
    }
    vt.addEventListener('pointerdown', (e) => { e.preventDefault(); vt.setPointerCapture(e.pointerId); vt.classList.add('drag'); vDrag = { y: e.clientY, top: (document.scrollingElement || document.documentElement).scrollTop }; });
    vt.addEventListener('pointermove', (e) => {
      if (!vDrag) return;
      const { se, trackH, max, thumbH } = metrics();
      se.scrollTop = vDrag.top + (e.clientY - vDrag.y) * (max / Math.max(1, trackH - thumbH));
      sbDirty = true;
    });
    vt.addEventListener('pointerup', () => { vDrag = null; vt.classList.remove('drag'); });
    vs.addEventListener('pointerdown', (e) => {
      if (e.composedPath()[0] !== vs) return;
      const { se, trackH, max } = metrics();
      se.scrollTop = (e.offsetY / trackH) * max;
    });

    // wheel over our chrome shouldn't scroll the page behind it
    root.addEventListener('wheel', (e) => {
      const path = e.composedPath();
      if (path.some((n) => n.classList && (n.classList.contains('lib-list') || n.classList.contains('np-scroll') || n.classList.contains('modal') || n.classList.contains('ctx') || n.classList.contains('dev-pop') || n.classList.contains('mdp-body') || n.id === 'vol'))) return;
      if (path.some((n) => n.classList && n.classList.contains('vscroll'))) return;
      e.preventDefault();
    }, { passive: false });

    // ---------- keyboard ----------
    document.addEventListener('keydown', (e) => {
      if (hkRecording) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = (e.key || '').toLowerCase();
      if (e.key === 'Escape') { closeMenu(); closeCtx(); pop.hidden = true; $('#devPop').hidden = true; $('#remotePop').hidden = true; $('#miniDevP').hidden = true; $$('.backdrop').forEach((m) => (m.hidden = true)); }
      if (mod && (k === 'k' || k === 'l')) { e.preventDefault(); input.focus(); input.select(); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); window.history.back(); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); window.history.forward(); }
      else if (mod && e.key === 'ArrowRight') { e.preventDefault(); cmd('next'); }
      else if (mod && e.key === 'ArrowLeft') { e.preventDefault(); cmd('prev'); }
      else if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const nv = Math.max(0, Math.min(100, (state ? state.volume : 50) + (e.key === 'ArrowUp' ? 5 : -5)));
        setVol(nv); vol.set(nv / 100); setVolIcon(nv, false); toast(`Volume ${nv}%`);
      }
    }, true);

    window.addEventListener('yt-navigate-finish', () => { updateNav(); });
  }

  // Mount as soon as <body> exists — not after YouTube Music's whole (large) page has been parsed.
  if (document.body) mount();
  else {
    let done = false;
    const go = () => { if (done || !document.body) return; done = true; mo.disconnect(); mount(); };
    const mo = new MutationObserver(go);
    mo.observe(document.documentElement || document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', go, { once: true });
  }
})();
