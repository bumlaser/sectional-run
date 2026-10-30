/* NavPanel: a generic touchscreen avionics navigator, mounted as a floating overlay.
 *
 * Self-contained: injects its own scoped CSS (all classes prefixed `np-`) and builds its own DOM.
 * It holds no flight logic. The host feeds it data with update() and reacts to its callbacks.
 *
 *   const nav = new NavPanel({ mount: document.body, onDirectTo: id => {...}, onAction: (name, arg) => {...} });
 *   nav.update({ gs, trk, dis, dtk, wpt, direct, fpl, nearest, map, com, navaid, utils });   // call ~4×/second
 *   nav.toggle(); nav.show(); nav.hide();
 *
 * Data shapes (all optional except the four strip readouts):
 *   gs  knots · trk/dtk magnetic degrees · dis nm · wpt active waypoint id · direct true when a Direct-To is active
 *   fpl     [{ id, name, dtk, dis, active }]          legs in order (the first entry is the departure, with no dtk/dis)
 *   nearest [{ id, name, dis, brg, tw }]              closest airports first (tw = towered)
 *   map     { range, items: [{ id, dx, dy, tw }], leg: [[dx0, dy0], [dx1, dy1]], hdg }   nm offsets from ownship, +x east, +y south
 *   com     { active: { freq, name }, standby: { freq, name } }   freq as '132.400'; shown in the header box
 *   navaid  { id, name, dis, brg } · utils [{ id, label, value }]
 */
(function () {
  'use strict';
  const CSS = `
  .np-root { position:fixed; z-index:4; width:300px; touch-action:none; user-select:none; -webkit-user-select:none; transform-origin:top right;
    font-family:"Trebuchet MS","Segoe UI",system-ui,sans-serif; color:#e9eef2; }
  .np-root[hidden] { display:none !important; }
  .np-bezel { background:linear-gradient(160deg,#2a2f34 0%,#181b1e 45%,#121416 100%); border:2px solid #000; border-radius:14px; padding:10px 10px 12px;
    box-shadow:0 0 0 1px #3a4046 inset, 0 1px 0 #4a5158 inset, 4px 6px 0 rgba(0,0,0,.55), 0 14px 40px rgba(0,0,0,.5); }
  .np-top { display:flex; align-items:center; justify-content:space-between; height:22px; padding:0 4px 6px; cursor:grab; }
  .np-top:active { cursor:grabbing; }
  .np-grip { width:44px; height:6px; border-radius:3px; background:repeating-linear-gradient(90deg,#4a5158 0 3px,transparent 3px 6px); }
  .np-brand { font:bold 9px "Courier New",monospace; letter-spacing:2px; color:#7d8892; }
  .np-close { width:22px; height:18px; border:1px solid #000; border-radius:4px; background:#23272b; color:#9aa6b0; font:bold 12px/1 "Courier New",monospace; cursor:pointer; padding:0; box-shadow:none; }
  .np-screen { display:grid; grid-template-columns:80px minmax(0,1fr); grid-template-rows:100%; height:330px; background:#04080b; border:3px solid #000; border-radius:4px; overflow:hidden;
    box-shadow:0 0 0 1px #2f363c, inset 0 0 18px rgba(0,0,0,.9); }
  .np-strip { display:grid; grid-template-rows:repeat(4,minmax(0,1fr)); gap:5px; min-height:0; padding:5px; border-right:1px solid #1d2a33; background:#060d12; }
  .np-cell { display:flex; flex-direction:column; justify-content:center; padding:0 6px; min-height:0; border:1px solid #24343f; border-radius:5px;
    background:linear-gradient(180deg,#03080b,#08131a); box-shadow:inset 0 2px 4px rgba(0,0,0,.85), inset 0 -1px 0 rgba(255,255,255,.04), 0 1px 0 rgba(255,255,255,.03); }
  .np-cell b { font-size:16px !important; }
  .np-cell small { font:bold 10px "Courier New",monospace; color:#4fd1e8; letter-spacing:1px; }
  .np-cell b { font:bold 17px "Courier New",monospace; color:#f2f6f8; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .np-cell i { font:normal 9px "Courier New",monospace; color:#7c8a94; font-style:normal; }
  .np-cell.np-mag b { color:#ff4fd8; }
  .np-main { display:flex; flex-direction:column; min-width:0; min-height:0; }
  .np-title { display:flex; align-items:center; justify-content:space-between; gap:6px; height:38px; padding:0 4px 0 8px; background:#0c1820; border-bottom:1px solid #1d2a33;
    font:bold 11px "Courier New",monospace; letter-spacing:1px; color:#bcd0dc; }
  .np-title [data-title] { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  .np-freq { display:grid; grid-template-rows:1fr 1fr; flex:none; padding:2px 6px; border:1px solid #2a3c48; border-radius:4px; background:#03070a;
    box-shadow:inset 0 1px 3px rgba(0,0,0,.8); font-family:"Courier New",monospace; line-height:1.05; }
  .np-f { display:flex; align-items:baseline; justify-content:flex-end; gap:5px; }
  .np-f i { font-style:normal; font-size:8px; letter-spacing:.5px; color:#5d7280; }
  .np-f b { font-size:13px; font-variant-numeric:tabular-nums; letter-spacing:.5px; }
  .np-f.np-act b { color:#39ff6a; text-shadow:0 0 6px rgba(57,255,106,.35); } .np-f.np-sby b { color:#d8e2e8; font-size:12px; }
  .np-page { flex:1; min-height:0; overflow:auto; padding:8px; scrollbar-width:thin; }
  .np-grid { display:grid; grid-template-columns:1fr 1fr; grid-template-rows:repeat(3,1fr); gap:8px; height:100%; }
  .np-key { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; border-radius:8px; cursor:pointer;
    background:linear-gradient(180deg,#1a2a35,#0f1a21); border:1px solid #2c4252; box-shadow:0 2px 0 #000, inset 0 1px 0 rgba(255,255,255,.06);
    color:#dfe8ee; font:bold 12px "Trebuchet MS",sans-serif; padding:0; min-height:0; }
  .np-key:active, .np-key:focus-visible { background:linear-gradient(180deg,#24506a,#163445); outline:none; border-color:#4fd1e8; }
  .np-key svg { width:30px; height:30px; stroke:#4fd1e8; fill:none; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .np-list { display:flex; flex-direction:column; gap:4px; }
  .np-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; width:100%; box-sizing:border-box; gap:8px; align-items:center; padding:6px 7px; border-radius:5px; background:#0b151c; border:1px solid #16242e;
    font:12px "Courier New",monospace; color:#dfe8ee; cursor:default; text-align:left; }
  .np-row.np-tap { cursor:pointer; } .np-row.np-tap:active { background:#163445; }
  .np-row > span:first-child { min-width:0; overflow:hidden; }
  .np-row b { font-size:13px; } .np-row .np-sub { color:#7c8a94; font-size:10px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .np-row .np-num { font-variant-numeric:tabular-nums; color:#f2f6f8; }
  .np-row.np-active { border-color:#ff4fd8; } .np-row.np-active b { color:#ff4fd8; }
  .np-tw { color:#5aa0ff; } .np-ntw { color:#ff4fd8; }
  .np-note { font:12px/1.45 "Trebuchet MS",sans-serif; color:#9fb0bc; padding:6px 2px; }
  .np-kv { display:grid; grid-template-columns:auto 1fr; gap:4px 10px; font:12px "Courier New",monospace; padding:4px 2px; }
  .np-kv span { color:#4fd1e8; } .np-kv b { color:#f2f6f8; }
  .np-canvas { width:100%; height:100%; display:block; }
  .np-page.np-mappage { padding:0; overflow:hidden; }
  .np-mapwrap { position:relative; width:100%; height:100%; }
  .np-mwpt { position:absolute; top:6px; right:6px; padding:3px 7px; border:1px solid rgba(255,79,216,.55); border-radius:4px; background:rgba(4,8,11,.55);
    font:bold 12px "Courier New",monospace; color:#ff4fd8; line-height:1.15; text-align:right; pointer-events:none; }
  .np-mwpt i { display:block; font-style:normal; font-size:9px; color:#c5d2da; }
  .np-mrng { position:absolute; left:6px; bottom:6px; font:bold 10px "Courier New",monospace; color:#4fd1e8; background:rgba(4,8,11,.55); padding:2px 5px; border-radius:3px; pointer-events:none; }
  .np-zoom { position:absolute; right:6px; bottom:6px; display:flex; flex-direction:column; border:1px solid #2c4252; border-radius:14px; overflow:hidden;
    background:rgba(12,24,32,.85); box-shadow:0 2px 0 #000; }
  .np-zoom button { width:30px; height:28px; border:0; margin:0; padding:0; background:transparent; color:#dfe8ee; font:bold 17px/1 "Courier New",monospace; cursor:pointer; box-shadow:none; }
  .np-zoom button + button { border-top:1px solid #2c4252; }
  .np-zoom button:active { background:#24506a; }
  .np-keys { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px; }
  .np-hw { height:34px; border-radius:7px; border:2px solid #000; cursor:pointer; color:#cfd8de; font:bold 13px "Courier New",monospace;
    background:linear-gradient(180deg,#3a4147,#24292d); box-shadow:0 3px 0 #000, inset 0 1px 0 rgba(255,255,255,.12); display:flex; align-items:center; justify-content:center; gap:6px; padding:0; }
  .np-hw:active { transform:translateY(2px); box-shadow:0 1px 0 #000; }
  .np-hw svg { width:22px; height:22px; stroke:#e6ecef; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  `;
  // simple stroked line icons, drawn for this component
  const ICON = {
    map: '<svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
    fpl: '<svg viewBox="0 0 24 24"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="6" cy="19" r="2"/><path d="M7 5.8l10 5.4M17 12.9L8 18.2"/></svg>',
    proc: '<svg viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M12 20V9"/><path d="M8 13l4-4 4 4"/><path d="M5 4l7 5 7-5"/></svg>',
    navcom: '<svg viewBox="0 0 24 24"><path d="M12 20v-8"/><circle cx="12" cy="10" r="2"/><path d="M8 6a6 6 0 0 0 0 8M16 6a6 6 0 0 1 0 8M5 3a10 10 0 0 0 0 14M19 3a10 10 0 0 1 0 14"/></svg>',
    nearest: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    utilities: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
    direct: '<svg viewBox="0 0 30 24"><path d="M3 4h5a8 8 0 0 1 0 16H3z"/><path d="M1 12h26M22 7l5 5-5 5"/></svg>',
  };
  const PAGES = [['map', 'Map'], ['fpl', 'FPL'], ['proc', 'Proc'], ['navcom', 'Nav/Com'], ['nearest', 'Nearest'], ['utilities', 'Utilities']];
  const f3 = v => v == null || isNaN(v) ? '---' : String(Math.round(((v % 360) + 360) % 360) || 360).padStart(3, '0');
  const fd = v => v == null || isNaN(v) ? '--.-' : v < 100 ? v.toFixed(1) : Math.round(v).toString();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  class NavPanel {
    constructor(opts = {}) {
      this.opts = opts; this.data = {}; this.page = 'home'; this.lastHtml = ''; this.ranges = [2, 5, 10, 20, 40]; this.ri = 3;
      if (!document.getElementById('np-style')) { const st = document.createElement('style'); st.id = 'np-style'; st.textContent = CSS; document.head.appendChild(st); }
      const el = this.el = document.createElement('div'); el.className = 'np-root'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Navigator');
      el.innerHTML = `<div class="np-bezel">
          <div class="np-top" data-drag><div class="np-grip"></div><span class="np-brand">NAV · 4.6</span><button class="np-close" type="button" data-close aria-label="Hide navigator">×</button></div>
          <div class="np-screen">
            <div class="np-strip">
              <div class="np-cell"><small>GS</small><b data-k="gs">---</b><i>KT</i></div>
              <div class="np-cell"><small>TRK</small><b data-k="trk">---°</b><i>MAG</i></div>
              <div class="np-cell np-mag"><small>DIS</small><b data-k="dis">--.-</b><i>NM</i></div>
              <div class="np-cell np-mag"><small>DTK</small><b data-k="dtk">---°</b><i>MAG</i></div>
            </div>
            <div class="np-main">
              <div class="np-title"><span data-title>HOME</span>
                <div class="np-freq" aria-label="COM frequencies"><div class="np-f np-act" data-fa-name><i>COM</i><b data-fa>---.---</b></div><div class="np-f np-sby" data-fs-name><i>STBY</i><b data-fs>---.---</b></div></div>
              </div>
              <div class="np-page" data-page></div></div>
          </div>
          <div class="np-keys">
            <button class="np-hw" type="button" data-hw="home" aria-label="Home">${ICON.home}<span>HOME</span></button>
            <button class="np-hw" type="button" data-hw="direct" aria-label="Direct-To">${ICON.direct}</button>
          </div></div>`;
      (opts.mount || document.body).appendChild(el);
      this.$ = sel => el.querySelector(sel);
      this.strip = { gs: this.$('[data-k=gs]'), trk: this.$('[data-k=trk]'), dis: this.$('[data-k=dis]'), dtk: this.$('[data-k=dtk]') };
      el.addEventListener('click', e => this._click(e));
      this._drag();
      this.place(opts.position);
      if (opts.open === false) el.hidden = true;
      this.render(true);
      addEventListener('resize', () => this.place());
    }
    // ---- public API ----
    update(d) {
      this.data = { ...this.data, ...d };
      const s = this.strip;
      s.gs.textContent = d.gs == null ? '---' : Math.round(d.gs); s.trk.textContent = f3(d.trk) + '°';
      s.dis.textContent = fd(d.dis); s.dtk.textContent = f3(d.dtk) + '°';
      const c = this.data.com || {}, a = c.active || {}, sb = c.standby || {};
      this.$('[data-fa]').textContent = a.freq || '---.---'; this.$('[data-fs]').textContent = sb.freq || '---.---';
      this.$('[data-fa-name]').title = a.name || ''; this.$('[data-fs-name]').title = sb.name || '';
      this.render();
    }
    show() { this.el.hidden = false; this.place(); this.render(true); }
    hide() { this.el.hidden = true; }
    toggle() { this.el.hidden ? this.show() : this.hide(); return !this.el.hidden; }
    get visible() { return !this.el.hidden; }
    go(page) { this.page = page; this.render(true); }
    place(pos) {
      if (pos) this.pos = pos;
      const W = innerWidth, H = innerHeight, w = 300, h = 430, sc = Math.min(1, (W - 24) / w, (H - 250) / h);
      this.el.style.transform = `scale(${Math.max(.55, sc)})`;
      const p = this.pos || { right: 12, top: 96 };
      this.el.style.right = Math.max(0, p.right) + 'px'; this.el.style.top = Math.max(0, Math.min(H - 80, p.top)) + 'px';
    }
    // ---- internals ----
    _click(e) {
      const t = e.target.closest('[data-close],[data-hw],[data-go],[data-dto],[data-act],[data-zoom]'); if (!t) return;
      if (t.dataset.zoom) { this.ri = Math.max(0, Math.min(this.ranges.length - 1, this.ri + (t.dataset.zoom === '+' ? -1 : 1))); return this._drawMap(); }
      if (t.hasAttribute('data-close')) return this.hide();
      if (t.dataset.hw === 'home') return this.go('home');
      if (t.dataset.hw === 'direct') return this.go('direct');
      if (t.dataset.go) return this.go(t.dataset.go);
      if (t.dataset.dto) { this.opts.onDirectTo && this.opts.onDirectTo(t.dataset.dto); return this.go('fpl'); }
      if (t.dataset.act) { this.opts.onAction && this.opts.onAction(t.dataset.act); this.render(true); }
    }
    _drag() {
      const bar = this.$('[data-drag]'); let st = null;
      bar.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = this.el.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, right: innerWidth - r.right, top: r.top }; bar.setPointerCapture(e.pointerId); e.preventDefault(); });
      bar.addEventListener('pointermove', e => { if (!st) return; this.place({ right: st.right - (e.clientX - st.x), top: st.top + (e.clientY - st.y) }); });
      const end = () => { if (st && this.opts.onMove) this.opts.onMove(this.pos); st = null; };
      bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    }
    render(force) {
      if (this.el.hidden) return;
      const d = this.data, P = this.page, title = { home: 'HOME', direct: 'DIRECT-TO', map: 'MAP', fpl: 'FLIGHT PLAN', proc: 'PROCEDURES', navcom: 'NAV / COM', nearest: 'NEAREST AIRPORT', utilities: 'UTILITIES' }[P];
      this.$('[data-title]').textContent = title;
      const pg = this.$('[data-page]'); pg.classList.toggle('np-mappage', P === 'map');
      if (P === 'map') {
        if (force || !this.canvas) { pg.innerHTML = `<div class="np-mapwrap"><canvas class="np-canvas"></canvas><div class="np-mwpt" data-mwpt></div><div class="np-mrng" data-mrng></div>
          <div class="np-zoom" role="group" aria-label="Map range"><button type="button" data-zoom="+" aria-label="Zoom in">+</button><button type="button" data-zoom="-" aria-label="Zoom out">−</button></div></div>`;
          this.canvas = this.$('canvas'); this.lastHtml = ''; }
        const w = this.$('[data-mwpt]'); w.innerHTML = d.wpt ? `${d.direct ? 'D→ ' : ''}${esc(d.wpt)}<i>${fd(d.dis)} NM · ${f3(d.dtk)}°</i>` : '';
        return this._drawMap(); }
      this.canvas = null;
      let html = '';
      if (P === 'home') html = `<div class="np-grid">${PAGES.map(([k, l]) => `<button class="np-key" type="button" data-go="${k}">${ICON[k]}<span>${l}</span></button>`).join('')}</div>`;
      else if (P === 'direct') {
        const opts = [], seen = new Set();
        for (const l of d.fpl || []) if (!seen.has(l.id)) { seen.add(l.id); opts.push({ id: l.id, sub: 'flight plan', brg: null, dis: null }); }
        for (const n of d.nearest || []) if (!seen.has(n.id)) { seen.add(n.id); opts.push({ id: n.id, sub: n.name, brg: n.brg, dis: n.dis }); }
        html = `<div class="np-note">Select a waypoint to fly direct from your present position.</div><div class="np-list">${opts.map(o =>
          `<button class="np-row np-tap ${o.id === d.wpt ? 'np-active' : ''}" type="button" data-dto="${esc(o.id)}"><span><b>${esc(o.id)}</b><span class="np-sub">${esc(o.sub)}</span></span><span class="np-num">${o.brg == null ? '' : f3(o.brg) + '°'}</span><span class="np-num">${o.dis == null ? '' : fd(o.dis) + ' NM'}</span></button>`).join('')}</div>`;
      } else if (P === 'fpl') {
        const legs = d.fpl || [];
        html = `<div class="np-list">${d.direct ? `<div class="np-row np-active"><span><b>D→ ${esc(d.wpt)}</b><span class="np-sub">direct from present position</span></span><span class="np-num">${f3(d.dtk)}°</span><span class="np-num">${fd(d.dis)}</span></div>` : ''}
          ${legs.map(l => `<div class="np-row ${l.active && !d.direct ? 'np-active' : ''}"><span><b>${esc(l.id)}</b><span class="np-sub">${esc(l.name || '')}</span></span><span class="np-num">${l.dtk == null ? '' : f3(l.dtk) + '°'}</span><span class="np-num">${l.dis == null ? 'DEP' : fd(l.dis)}</span></div>`).join('')}</div>
          <div class="np-note">DTK and distance are shown for each leg. Use D→ to go direct to any waypoint.</div>`;
      } else if (P === 'nearest') {
        html = `<div class="np-list">${(d.nearest || []).map(n => `<button class="np-row np-tap" type="button" data-dto="${esc(n.id)}"><span><b class="${n.tw ? 'np-tw' : 'np-ntw'}">${esc(n.id)}</b><span class="np-sub">${esc(n.name)}</span></span><span class="np-num">${f3(n.brg)}°</span><span class="np-num">${fd(n.dis)}</span></button>`).join('')}</div>
          <div class="np-note">Tap an airport to go direct. <span class="np-tw">Blue</span> = towered, <span class="np-ntw">magenta</span> = CTAF.</div>`;
      } else if (P === 'navcom') {
        const c = d.com || {}, n = d.navaid || {};
        const ca = c.active || {}, cs = c.standby || {};
        html = `<div class="np-kv"><span>COM ACT</span><b><span style="color:#39ff6a">${esc(ca.freq || '---.---')}</span> ${esc(ca.name || '')}</b><span>COM STBY</span><b>${esc(cs.freq || '---.---')} ${esc(cs.name || '')}</b>
          <span>NAV</span><b>${n.id ? esc(n.id) + ' ' + esc(n.name || '') : '—'}</b><span>BRG / DIS</span><b>${n.id ? f3(n.brg) + '° · ' + fd(n.dis) + ' NM' : '—'}</b></div>
          <div class="np-note">Use the RADIO button to call a facility. The last one you called shows here as active.</div>`;
      } else if (P === 'proc') html = `<div class="np-note">No procedures are loaded for a VFR flight.<br><br>Departures, arrivals and approaches will show here when IFR mode arrives.</div>`;
      else if (P === 'utilities') html = `<div class="np-list">${(d.utils || []).map(u => `<button class="np-row np-tap" type="button" data-act="${esc(u.id)}"><span><b>${esc(u.label)}</b></span><span></span><span class="np-num">${esc(u.value)}</span></button>`).join('')}</div>`;
      if (force || html !== this.lastHtml) { const sc = pg.scrollTop; pg.innerHTML = html; pg.scrollTop = sc; this.lastHtml = html; }
    }
    _drawMap() {
      const cv = this.canvas, d = this.data.map; if (!cv) return;
      const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#04080b'; g.fillRect(0, 0, w, h);
      if (!d) return;
      const R = this.ranges[this.ri], cx = w / 2, cy = h * .62, k = (Math.min(w, h) * .55) / R, rot = -(d.hdg || 0) * Math.PI / 180;   // track-up
      const rl = this.$('[data-mrng]'); if (rl) rl.textContent = R + ' NM';
      const toS = (dx, dy) => { const x = dx * Math.cos(rot) - dy * Math.sin(rot), y = dx * Math.sin(rot) + dy * Math.cos(rot); return [cx + x * k, cy + y * k]; };
      g.strokeStyle = '#1d3a48'; g.lineWidth = 1; for (const r of [R / 2, R]) { g.beginPath(); g.arc(cx, cy, r * k, 0, 6.283); g.stroke(); }
      if (d.leg) { const [a, b] = [toS(...d.leg[0]), toS(...d.leg[1])]; g.strokeStyle = '#ff4fd8'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
      for (const it of d.items || []) { const [x, y] = toS(it.dx, it.dy); if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
        g.strokeStyle = it.tw ? '#5aa0ff' : '#ff4fd8'; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, 4, 0, 6.283); g.stroke();
        g.fillStyle = '#c8d6de'; g.font = 'bold 9px "Courier New",monospace'; g.fillText(it.id, x + 6, y + 3); }
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx + 6, cy + 6); g.lineTo(cx, cy + 3); g.lineTo(cx - 6, cy + 6); g.closePath(); g.fill();
      g.fillStyle = '#4fd1e8'; g.font = 'bold 10px "Courier New",monospace'; g.fillText('TRK UP', 6, 13);
    }
  }
  window.NavPanel = NavPanel;
})();
