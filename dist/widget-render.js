// Resonance taskbar player renderer — shared by the taskbar window (widget.html) and the
// layout editor preview inside the app. Builds DOM with createElement only (works under
// YouTube's Trusted Types).
(function (g) {
  const NS = 'http://www.w3.org/2000/svg';
  const ICON = {
    prev: 'M18.5 6.6v10.8a1 1 0 0 1-1.55.83l-7.6-5.4a1 1 0 0 1 0-1.66l7.6-5.4a1 1 0 0 1 1.55.83zM5.5 6h2v12h-2z',
    next: 'M5.5 6.6v10.8a1 1 0 0 0 1.55.83l7.6-5.4a1 1 0 0 0 0-1.66l-7.6-5.4a1 1 0 0 0-1.55.83zM16.5 6h2v12h-2z',
    play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.5-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
    pause: 'M7.2 5h2.6A1.2 1.2 0 0 1 11 6.2v11.6a1.2 1.2 0 0 1-1.2 1.2H7.2A1.2 1.2 0 0 1 6 17.8V6.2A1.2 1.2 0 0 1 7.2 5zm7 0h2.6A1.2 1.2 0 0 1 18 6.2v11.6a1.2 1.2 0 0 1-1.2 1.2h-2.6a1.2 1.2 0 0 1-1.2-1.2V6.2A1.2 1.2 0 0 1 14.2 5z',
    shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
    heart: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
    heartFill: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  };

  const ITEMS = {
    art: 'Cover art', prev: 'Previous', play: 'Play / pause', next: 'Next', title: 'Title & artist', like: 'Like', shuffle: 'Shuffle', spacer: 'Spacer',
  };

  const PRESETS = [
    { id: 'classic', name: 'Classic', builtin: true, items: ['art', 'prev', 'play', 'next', 'title'], width: 520, shape: 'pill', bg: 'tint', progress: 'none', showArtist: true, align: 'center', offset: 0 },
    { id: 'compact', name: 'Compact', builtin: true, items: ['prev', 'play', 'next'], width: 150, shape: 'pill', bg: 'tint', progress: 'none', showArtist: false, align: 'center', offset: 0 },
    { id: 'nowplaying', name: 'Now playing', builtin: true, items: ['art', 'title', 'like', 'prev', 'play', 'next'], width: 480, shape: 'rounded', bg: 'glass', progress: 'bottom', showArtist: true, align: 'center', offset: 0 },
    { id: 'minimal', name: 'Minimal', builtin: true, items: ['art', 'title', 'play'], width: 340, shape: 'pill', bg: 'dark', progress: 'fill', showArtist: true, align: 'center', offset: 0 },
    { id: 'spotlight', name: 'Spotlight', builtin: true, items: ['prev', 'play', 'next', 'title', 'art'], width: 560, shape: 'square', bg: 'solid', progress: 'bottom', showArtist: true, align: 'center', offset: 0 },
  ];

  function normalize(l) {
    const d = PRESETS[0];
    l = Object.assign({}, d, l || {});
    l.items = (Array.isArray(l.items) ? l.items : d.items).filter((x) => ITEMS[x]);
    if (!l.items.length) l.items = d.items.slice();
    l.width = Math.max(100, Math.min(1000, Number(l.width) || d.width));
    if (!['pill', 'rounded', 'square'].includes(l.shape)) l.shape = 'pill';
    if (!['tint', 'solid', 'glass', 'dark'].includes(l.bg)) l.bg = 'tint';
    if (!['none', 'bottom', 'fill'].includes(l.progress)) l.progress = 'none';
    if (!['left', 'center', 'right'].includes(l.align)) l.align = 'center';
    l.offset = Math.max(-1500, Math.min(1500, Number(l.offset) || 0));
    return l;
  }

  const CSS = `
  .rw { position: relative; width: 100%; height: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
    padding: 0 14px 0 5px; overflow: hidden; color: var(--rw-fg); user-select: none;
    font: 600 13px/1 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
    transition: background .6s, color .4s; --rw-fg: #1a0b12; --rw-dim: rgba(26,11,18,.62); }
  .rw.pill { border-radius: 999px; } .rw.rounded { border-radius: 10px; } .rw.square { border-radius: 3px; }
  .rw.tint { background: radial-gradient(120% 220% at 0% 50%, rgba(255,255,255,.35), transparent 55%), linear-gradient(90deg, rgb(var(--rw-tint)), rgba(var(--rw-tint), .82));
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.28), inset 0 -1px 0 rgba(0,0,0,.12); }
  .rw.solid { background: rgb(var(--rw-tint)); box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); }
  .rw.glass { background: linear-gradient(90deg, rgba(var(--rw-tint), .55), rgba(20,20,26,.78) 70%); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
  .rw.dark { background: #16161c; box-shadow: inset 0 0 0 1px rgba(255,255,255,.1); }
  .rw.glass, .rw.dark { --rw-fg: #ffffff; --rw-dim: rgba(255,255,255,.66); }
  .rw > * { position: relative; z-index: 1; }
  .rw-fill { position: absolute !important; z-index: 0 !important; left: 0; top: 0; bottom: 0; width: 0; background: rgba(var(--rw-tint), .55); transition: width .4s linear; }
  .rw.tint .rw-fill, .rw.solid .rw-fill { background: rgba(255,255,255,.22); }
  .rw-bar { position: absolute !important; left: 10px; right: 10px; bottom: 3px; height: 2px; border-radius: 2px; background: rgba(127,127,127,.3); overflow: hidden; }
  .rw-bar { cursor: pointer; transition: height .12s, bottom .12s; }
  .rw-bar::before { content: ""; position: absolute; left: 0; right: 0; top: -6px; bottom: -3px; }
  .rw-bar:hover { height: 4px; bottom: 2px !important; }
  .rw-bar i { display: block; height: 100%; width: 0; background: var(--rw-fg); opacity: .85; transition: width .4s linear; }
  .rw.square .rw-bar, .rw.rounded .rw-bar { left: 0; right: 0; bottom: 0; border-radius: 0; }
  .rw-art { height: calc(100% - 8px); aspect-ratio: 1; flex: none; background: rgba(0,0,0,.18) center/cover no-repeat; box-shadow: 0 2px 8px rgba(0,0,0,.25); cursor: pointer; transition: transform .15s; }
  .rw.pill .rw-art { border-radius: 999px; } .rw.rounded .rw-art { border-radius: 7px; } .rw.square .rw-art { border-radius: 2px; }
  .rw-art:hover { transform: scale(1.06); }
  .rw-btn { border: 0; background: none; color: inherit; padding: 0; margin: 0; cursor: pointer; display: grid; place-items: center; flex: none;
    width: 30px; height: 30px; max-height: calc(100% - 4px); border-radius: 50%; transition: background .15s, transform .12s; }
  .rw-btn:hover { background: rgba(127,127,127,.25); }
  .rw-btn:active { transform: scale(.9); }
  .rw-btn svg { width: 18px; height: 18px; fill: currentColor; }
  .rw-play { background: var(--rw-fg); color: rgb(var(--rw-tint)); width: 24px; height: 24px; max-height: calc(100% - 12px); margin: 0 3px; }
  .rw.dark .rw-play, .rw.glass .rw-play { color: #111; }
  .rw-play:hover { background: var(--rw-fg); transform: scale(1.08); }
  .rw-play svg { width: 13px; height: 13px; }
  .rw-like.on { color: #ff486c; }
  .rw-shuffle { opacity: .55; } .rw-shuffle.on { opacity: 1; }
  .rw-shuffle.on::after { content: ""; position: absolute; bottom: 0px; left: 50%; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: currentColor; }
  .rw-btn { position: relative; }
  .rw.tint .rw-like.on, .rw.solid .rw-like.on { color: var(--rw-fg); }
  .rw-sp { flex: 1; }
  .rw-meta { flex: 1; min-width: 0; cursor: pointer; overflow: hidden; white-space: nowrap; -webkit-mask-image: linear-gradient(90deg, #000 88%, transparent); }
  .rw-mq { display: inline-flex; gap: 48px; }
  .rw-mq.run { animation: rwscroll var(--rw-dur, 12s) linear infinite; }
  @keyframes rwscroll { 0%, 12% { transform: translateX(0); } 100% { transform: translateX(var(--rw-shift)); } }
  .rw-t { font-weight: 700; }
  .rw-a { color: var(--rw-dim); margin-left: 8px; }
  .rw.centered { justify-content: center; padding: 0 6px; }
  /* with a progress line: lift everything above it and shrink to fit */
  .rw.has-bar { padding-top: 1px; padding-bottom: 8px; gap: 6px; }
  .rw.has-bar .rw-art { height: calc(100% - 4px); }
  .rw.has-bar .rw-btn { width: 24px; height: 24px; max-height: 100%; }
  .rw.has-bar .rw-btn svg { width: 15px; height: 15px; }
  .rw.has-bar .rw-play { width: 21px; height: 21px; max-height: 100%; margin: 0 2px; }
  .rw.has-bar .rw-play svg { width: 11px; height: 11px; }
  .rw.has-bar .rw-meta { font-size: 12.5px; }
  .rw.has-bar .rw-shuffle.on::after { width: 3px; height: 3px; margin-left: -1.5px; bottom: -1px; }
  .rw.has-bar .rw-bar { bottom: 3px; }
  `;

  function svg(path) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', path);
    s.appendChild(p);
    return s;
  }
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

  /** Build the player into `root`. handlers: { cmd(name), show() }. Returns { update(state), layout }. */
  function mount(root, layoutIn, handlers, opts) {
    const layout = normalize(layoutIn);
    const h = handlers || {};
    opts = opts || {};
    while (root.firstChild) root.removeChild(root.firstChild);
    const box = el('div', `rw ${layout.shape} ${layout.bg}`);
    const hasFlex = layout.items.includes('title') || layout.items.includes('spacer');
    if (!hasFlex) box.classList.add('centered');
    const refs = {};
    if (layout.progress === 'fill') { refs.fill = el('div', 'rw-fill'); box.appendChild(refs.fill); }
    for (const it of layout.items) {
      if (it === 'art') {
        refs.art = el('div', 'rw-art'); refs.art.title = 'Open Resonance';
        refs.art.onclick = () => h.show && h.show();
        box.appendChild(refs.art);
      } else if (it === 'title') {
        const meta = el('div', 'rw-meta'); meta.title = 'Open Resonance';
        meta.onclick = () => h.show && h.show();
        const mq = el('div', 'rw-mq');
        const one = el('span');
        refs.t = el('span', 'rw-t'); refs.a = el('span', 'rw-a');
        one.appendChild(refs.t); if (layout.showArtist) one.appendChild(refs.a);
        mq.appendChild(one); meta.appendChild(mq);
        refs.meta = meta; refs.mq = mq; refs.one = one;
        box.appendChild(meta);
      } else if (it === 'spacer') {
        box.appendChild(el('div', 'rw-sp'));
      } else {
        const b = el('button', 'rw-btn rw-' + it);
        b.title = ITEMS[it];
        b.appendChild(svg(it === 'play' ? ICON.play : it === 'like' ? ICON.heart : ICON[it]));
        b.onclick = (e) => { e.stopPropagation(); h.cmd && h.cmd(it === 'play' ? 'toggle' : it); };
        refs[it] = b;
        box.appendChild(b);
      }
    }
    if (layout.progress === 'bottom') { box.classList.add('has-bar'); refs.bar = el('div', 'rw-bar'); refs.barI = el('i'); refs.bar.appendChild(refs.barI); box.appendChild(refs.bar); }
    root.appendChild(box);
    // scroll anywhere on the player = volume; click the progress line (or the fill) = seek
    box.addEventListener('wheel', (e) => { e.preventDefault(); h.cmd && h.cmd(e.deltaY < 0 ? 'volUp' : 'volDown'); }, { passive: false });
    const seekFrom = (target, e) => { const r = target.getBoundingClientRect(); const f = (e.clientX - r.left) / r.width; if (h.seek && st.duration) { h.seek(Math.max(0, Math.min(1, f))); base = { t: f * st.duration, at: performance.now() }; setProgress(); } };
    if (refs.bar) refs.bar.addEventListener('click', (e) => { e.stopPropagation(); seekFrom(refs.bar, e); });
    if (refs.fill) box.addEventListener('click', (e) => { if (e.target === box || e.target === refs.fill) seekFrom(box, e); });

    let lastKey = null, st = {}, base = { t: 0, at: 0 };
    function marquee() {
      if (!refs.mq || opts.static) return;
      refs.mq.classList.remove('run');
      while (refs.mq.children.length > 1) refs.mq.removeChild(refs.mq.lastChild);
      requestAnimationFrame(() => {
        const over = refs.one.scrollWidth - refs.meta.clientWidth;
        if (over > 4) {
          refs.mq.appendChild(refs.one.cloneNode(true));
          const shift = refs.one.scrollWidth + 48;
          refs.mq.style.setProperty('--rw-shift', -shift + 'px');
          refs.mq.style.setProperty('--rw-dur', Math.max(8, shift / 30) + 's');
          refs.mq.classList.add('run');
        }
      });
    }
    function setProgress() {
      if (!refs.fill && !refs.barI) return;
      let t = base.t + (st.playing ? (performance.now() - base.at) / 1000 : 0);
      const d = st.duration || 0;
      const pct = d ? Math.min(100, (t / d) * 100) : 0;
      if (refs.fill) refs.fill.style.width = pct + '%';
      if (refs.barI) refs.barI.style.width = pct + '%';
    }
    const timer = setInterval(setProgress, 500);

    function update(s) {
      st = s || {};
      const rgb = Array.isArray(st.tint) ? st.tint : [255, 72, 108];
      box.style.setProperty('--rw-tint', rgb.join(','));
      if (layout.bg === 'tint' || layout.bg === 'solid') {
        const light = lum(rgb) > 0.55;
        box.style.setProperty('--rw-fg', light ? '#1a0b12' : '#ffffff');
        box.style.setProperty('--rw-dim', light ? 'rgba(26,11,18,.62)' : 'rgba(255,255,255,.72)');
      }
      if (refs.play) { refs.play.removeChild(refs.play.firstChild); refs.play.appendChild(svg(st.playing ? ICON.pause : ICON.play)); }
      if (refs.shuffle) { refs.shuffle.classList.toggle('on', !!st.shuffle); refs.shuffle.title = st.shuffle ? 'Shuffle: on' : 'Shuffle: off'; }
      if (refs.like) { const on = st.like === 'LIKE'; refs.like.classList.toggle('on', on); refs.like.removeChild(refs.like.firstChild); refs.like.appendChild(svg(on ? ICON.heartFill : ICON.heart)); }
      if (refs.art) refs.art.style.backgroundImage = st.art ? `url("${String(st.art).replace(/"/g, '%22')}")` : 'none';
      const key = (st.title || '') + '|' + (st.artist || '');
      if (refs.t && key !== lastKey) {
        lastKey = key;
        refs.t.textContent = st.title || 'Nothing playing';
        refs.a.textContent = st.artist || '';
        marquee();
      }
      base = { t: st.time || 0, at: performance.now() };
      setProgress();
    }
    return { update, layout, destroy: () => clearInterval(timer), marquee };
  }

  g.ResWidget = { PRESETS, ITEMS, CSS, normalize, mount };
})(window);
