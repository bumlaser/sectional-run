/* NavPanel: a generic touchscreen avionics navigator, mounted as a floating overlay.
 *
 * Self-contained: injects its own scoped CSS (all classes prefixed `np-`) and builds its own DOM.
 * It holds no flight logic. The host feeds it data with update() and reacts to its callbacks.
 *
 *   const nav = new NavPanel({ mount: document.body, onDirectTo: id => {...}, onAction: (name, arg) => {...} });
 *   nav.update({ gs, trk, dis, dtk, wpt, direct, fpl, nearest, map, com, xpdr, phase, msgs, tfc, navaid, utils });   // ~4×/second
 *   nav.toggle(); nav.show(); nav.hide();
 *
 * Data shapes (all optional except the readouts):
 *   gs  knots · trk/dtk magnetic degrees · dis nm · wpt active waypoint id · direct true when a Direct-To is active
 *   fpl     [{ id, name, dtk, dis, active }]          legs in order (the first entry is the departure, with no dtk/dis)
 *   nearest [{ id, name, dis, brg, tw }]              closest airports first (tw = towered)
 *   map     { items: [{ id, dx, dy, tw }], leg: [[dx0, dy0], [dx1, dy1]], hdg }   nm offsets from ownship, +x east, +y south
 *   com     { active: { freq, name }, standby: { freq, name } }   freq as '132.400'
 *   nav     { active: { freq, name }, standby: { freq, name } }   VOR freq as '116.85' (shown on the Nav/Com page)
 *   xpdr    { code: '1200', mode: 'ALT' } · phase 'TERM' | 'ENR' | 'DPRT' (bottom status strip)
 *   msgs    [{ who, text }] newest last · tfc { on, status } (omit to hide traffic) · navaid { id, name, dis, brg } · utils [{ id, label, value }]
 *
 * Layout: a landscape unit. The bezel has two knobs and HOME / Direct-To keys. On the screen, from left to right:
 * a narrow key column (Menu, Back), the moving map with DTK, TRK and distance laid over it, and a radio column
 * (COM, STBY, XPDR, zoom In / Out). A status strip runs along the bottom. Other pages replace the map area.
 */
(function () {
  'use strict';
  const W0 = 560, H0 = 232;   // design size in px; the panel scales down to fit narrow screens
  const CSS = `
  .np-root { position:fixed; z-index:4; width:${W0}px; touch-action:none; user-select:none; -webkit-user-select:none; transform-origin:top right;
    font-family:"Trebuchet MS","Segoe UI",system-ui,sans-serif; color:#eef3f6; }
  .np-root[hidden] { display:none !important; }
  .np-bezel { position:relative; display:grid; grid-template-columns:34px 1fr 40px; align-items:stretch; height:${H0}px; box-sizing:border-box; padding:8px 6px;
    background:linear-gradient(175deg,#3a3e42 0%,#24272a 40%,#1a1c1e 100%); border:2px solid #050505; border-radius:12px;
    box-shadow:0 0 0 1px #4a4f54 inset, 0 1px 0 #5a6066 inset, 4px 6px 0 rgba(0,0,0,.5), 0 14px 40px rgba(0,0,0,.5); }
  .np-lbz, .np-rbz { display:flex; flex-direction:column; align-items:center; justify-content:space-between; padding:2px 0; }
  .np-knob { width:24px; height:24px; border-radius:50%; background:radial-gradient(circle at 35% 30%,#6b7076,#2a2d30 60%,#151719); border:1px solid #000;
    box-shadow:0 2px 3px rgba(0,0,0,.7), inset 0 0 0 3px rgba(255,255,255,.04); cursor:grab; }
  .np-knob.np-big { width:30px; height:30px; }
  .np-slot { width:7px; height:56px; border-radius:3px; background:#08090a; box-shadow:inset 0 1px 2px #000, 0 1px 0 rgba(255,255,255,.06); }
  .np-hk { width:34px; height:30px; border-radius:6px; border:1px solid #000; padding:0; cursor:pointer; color:#e6ecef; font:bold 8px "Trebuchet MS",sans-serif; letter-spacing:.3px;
    background:linear-gradient(180deg,#3b4045,#25292c); box-shadow:0 2px 0 #000, inset 0 1px 0 rgba(255,255,255,.12); display:flex; align-items:center; justify-content:center; }
  .np-hk:active { transform:translateY(1px); box-shadow:0 1px 0 #000; }
  .np-hk svg { width:20px; height:14px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .np-close { position:absolute; top:-9px; right:12px; width:20px; height:18px; border:1px solid #000; border-radius:4px; background:#2a2e32; color:#a9b4bd;
    font:bold 12px/1 "Courier New",monospace; cursor:pointer; padding:0; box-shadow:none; }
  .np-screen { display:grid; grid-template-columns:62px minmax(0,1fr) 128px; grid-template-rows:minmax(0,1fr) 18px; gap:3px; min-width:0; min-height:0; padding:3px;
    background:#000; border:2px solid #000; border-radius:3px; box-shadow:0 0 0 1px #3a4046, inset 0 0 14px rgba(0,0,0,.9); }
  /* softkeys and boxes */
  .np-col { display:flex; flex-direction:column; gap:3px; min-height:0; }
  .np-sk { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; min-height:0; padding:2px; cursor:pointer;
    background:linear-gradient(180deg,#14304d,#0b1d31); border:1px solid #2d5a85; border-radius:4px; color:#fff; font:bold 11px "Trebuchet MS",sans-serif; }
  .np-sk:active { background:linear-gradient(180deg,#245482,#163a5c); }
  .np-sk svg { width:28px; height:20px; }
  .np-sk.np-dim { visibility:hidden; }
  .np-info { flex:none; padding:3px 4px; border:1px solid #2d5a85; border-radius:4px; background:#081624; font:9px "Trebuchet MS",sans-serif; color:#c9d6e0; line-height:1.15; text-align:center; }
  .np-box { position:relative; flex:1; min-height:0; padding:1px 6px; display:flex; flex-direction:column; justify-content:space-between; background:#07111c; border:1px solid #2d5a85; border-radius:4px; cursor:pointer; overflow:hidden; }
  .np-box small { display:block; font:bold 9px "Trebuchet MS",sans-serif; color:#e6edf2; letter-spacing:.5px; line-height:1.1; }
  .np-box b { display:block; text-align:right; font:bold 19px "Trebuchet MS",sans-serif; font-variant-numeric:tabular-nums; line-height:1; letter-spacing:.5px; }
  .np-box i { display:block; font:normal 9px "Trebuchet MS",sans-serif; font-style:normal; color:#e6edf2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.15; }
  .np-act b { color:#4dff7c; } .np-sby b { color:#5ee0ff; } .np-xp b { color:#4dff7c; } .np-xp em { position:absolute; right:6px; top:2px; font:bold 9px sans-serif; font-style:normal; color:#4dff7c; }
  .np-zrow { flex:none; display:grid; grid-template-columns:1fr 1fr; gap:3px; height:44px; }
  .np-zrow .np-sk { font-size:10px; }
  /* centre: map or page */
  .np-main { position:relative; min-width:0; min-height:0; background:#06101a; border:1px solid #1d3348; border-radius:3px; overflow:hidden; }
  .np-canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
  .np-ov { position:absolute; pointer-events:none; text-shadow:0 1px 2px #000, 0 0 3px #000; line-height:1; }
  .np-ov small { display:block; font:bold 10px "Trebuchet MS",sans-serif; color:#5ee0ff; letter-spacing:.5px; }
  .np-ov b { font:bold 25px "Trebuchet MS",sans-serif; color:#fff; font-variant-numeric:tabular-nums; }
  .np-ov.np-dtk { left:6px; top:4px; } .np-ov.np-trk { right:6px; top:4px; text-align:right; }
  .np-ov.np-dis { left:6px; bottom:5px; } .np-ov.np-dis b { font-size:19px; } .np-ov.np-dis span { font:bold 11px sans-serif; color:#fff; }
  .np-ov.np-wpt { left:50%; top:5px; transform:translateX(-50%); padding:1px 5px; border:1px solid #ff4fd8; border-radius:3px; background:rgba(6,16,26,.8); font:bold 12px "Trebuchet MS",sans-serif; color:#ff4fd8; text-shadow:none; }
  .np-ov.np-rng { right:6px; bottom:5px; font:bold 11px "Trebuchet MS",sans-serif; color:#fff; }
  .np-ov.np-orient { left:6px; top:46px; font:bold 9px "Trebuchet MS",sans-serif; color:#fff; }
  .np-page { position:absolute; inset:0; overflow:auto; padding:5px; scrollbar-width:thin; }
  .np-ptitle { font:bold 10px "Trebuchet MS",sans-serif; color:#5ee0ff; letter-spacing:1px; margin:0 0 4px 2px; text-transform:uppercase; }
  .np-grid { display:grid; grid-template-columns:repeat(4,1fr); grid-auto-rows:1fr; gap:4px; height:calc(100% - 16px); }
  .np-key { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; min-height:0; padding:0; border-radius:4px; cursor:pointer;
    background:linear-gradient(180deg,#14304d,#0b1d31); border:1px solid #2d5a85; color:#fff; font:bold 10px "Trebuchet MS",sans-serif; }
  .np-key:active { background:linear-gradient(180deg,#245482,#163a5c); }
  .np-key svg { width:24px; height:24px; stroke:#5ee0ff; fill:none; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .np-list { display:flex; flex-direction:column; gap:3px; }
  .np-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; width:100%; box-sizing:border-box; gap:8px; align-items:center; padding:4px 6px; border-radius:3px;
    background:#0b1a29; border:1px solid #1d3348; font:11px "Trebuchet MS",sans-serif; color:#e6edf2; text-align:left; cursor:default; }
  .np-row.np-tap { cursor:pointer; } .np-row.np-tap:active { background:#163a5c; }
  .np-row > span:first-child { min-width:0; overflow:hidden; }
  .np-row b { font-size:12px; } .np-row .np-sub { color:#8ea3b3; font-size:9px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .np-row .np-num { font-variant-numeric:tabular-nums; color:#fff; font-weight:bold; }
  .np-row.np-active { border-color:#ff4fd8; } .np-row.np-active b { color:#ff4fd8; }
  .np-tw { color:#5aa0ff; } .np-ntw { color:#ff4fd8; }
  .np-note { font:11px/1.4 "Trebuchet MS",sans-serif; color:#a9bccb; padding:4px 2px; }
  .np-kv { display:grid; grid-template-columns:auto 1fr; gap:3px 10px; font:11px "Trebuchet MS",sans-serif; padding:2px; }
  .np-kv span { color:#5ee0ff; font-weight:bold; } .np-kv b { color:#fff; }
  .np-msg { padding:4px 6px; border-radius:3px; background:#0b1a29; border:1px solid #1d3348; font:11px/1.3 "Trebuchet MS",sans-serif; color:#e6edf2; }
  .np-msg b { color:#5ee0ff; margin-right:5px; } .np-msg.np-you b { color:#ffb000; }
  /* bottom status strip */
  .np-strip { grid-column:1 / -1; display:grid; grid-template-columns:62px 1fr 1fr 2fr; align-items:center; background:#0a1622; border-top:1px solid #1d3348; font:bold 11px "Trebuchet MS",sans-serif; }
  .np-strip > span { text-align:center; border-right:1px solid #1d3348; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .np-strip .np-ph { color:#4dff7c; } .np-strip .np-src { color:#ff4fd8; } .np-strip .np-hint { color:#c9d6e0; font-weight:normal; text-align:right; padding-right:6px; border:0; }
  .np-strip .np-msgind { color:#ffb000; }
  `;
  // simple stroked line icons, drawn for this component
  const ICON = {
    menu: '<svg viewBox="0 0 28 20"><rect x="1" y="1" width="26" height="18" rx="3" fill="#2a8fe0"/><path d="M6 6h16M6 10h16M6 14h16" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    back: '<svg viewBox="0 0 28 20"><path d="M9 4L4 9l5 5" fill="none" stroke="#2fb0ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 9h11a7 7 0 0 1 0 10" fill="none" stroke="#2fb0ff" stroke-width="3" stroke-linecap="round"/></svg>',
    zin: '<svg viewBox="0 0 28 20"><circle cx="17" cy="9" r="7" fill="none" stroke="#2fb0ff" stroke-width="2.2"/><path d="M13 9h8M17 5v8" stroke="#fff" stroke-width="2"/><path d="M4 18l8-5" stroke="#2fb0ff" stroke-width="3" stroke-linecap="round"/></svg>',
    zout: '<svg viewBox="0 0 28 20"><circle cx="17" cy="9" r="7" fill="none" stroke="#2fb0ff" stroke-width="2.2"/><path d="M13 9h8" stroke="#fff" stroke-width="2"/><path d="M4 18l8-5" stroke="#2fb0ff" stroke-width="3" stroke-linecap="round"/></svg>',
    map: '<svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
    fpl: '<svg viewBox="0 0 24 24"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="6" cy="19" r="2"/><path d="M7 5.8l10 5.4M17 12.9L8 18.2"/></svg>',
    proc: '<svg viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M12 20V9"/><path d="M8 13l4-4 4 4"/><path d="M5 4l7 5 7-5"/></svg>',
    navcom: '<svg viewBox="0 0 24 24"><path d="M12 20v-8"/><circle cx="12" cy="10" r="2"/><path d="M8 6a6 6 0 0 0 0 8M16 6a6 6 0 0 1 0 8M5 3a10 10 0 0 0 0 14M19 3a10 10 0 0 1 0 14"/></svg>',
    nearest: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    utilities: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
    msg: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>',
    traffic: '<svg viewBox="0 0 24 24"><path d="M12 3l5 5-5 5-5-5z"/><path d="M17 14l3 3-3 3-3-3z"/><path d="M5 15v6M3 17l2-2 2 2"/></svg>',
    direct: '<svg viewBox="0 0 30 24"><path d="M3 4h5a8 8 0 0 1 0 16H3z"/><path d="M1 12h26M22 7l5 5-5 5"/></svg>',
  };
  const PAGES = [['map', 'Map'], ['fpl', 'Flight Plan'], ['nearest', 'Nearest'], ['navcom', 'Nav / Com'], ['proc', 'Procedures'], ['msg', 'Messages'], ['traffic', 'Traffic'], ['utilities', 'Utilities']];
  const TITLES = { home: 'Menu', direct: 'Direct-To', fpl: 'Active Flight Plan', proc: 'Procedures', navcom: 'Nav / Com', nearest: 'Nearest Airport', utilities: 'Utilities', msg: 'Messages', traffic: 'Traffic' };
  const f3 = v => v == null || isNaN(v) ? '---' : String(Math.round(((v % 360) + 360) % 360) || 360).padStart(3, '0');
  const fd = v => v == null || isNaN(v) ? '--.-' : v < 100 ? v.toFixed(1) : Math.round(v).toString();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  class NavPanel {
    constructor(opts = {}) {
      this.opts = opts; this.data = {}; this.page = 'map'; this.hist = []; this.lastHtml = ''; this.ranges = [2, 4, 10, 20, 40]; this.ri = 2;
      if (!document.getElementById('np-style')) { const st = document.createElement('style'); st.id = 'np-style'; st.textContent = CSS; document.head.appendChild(st); }
      const el = this.el = document.createElement('div'); el.className = 'np-root'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Navigator');
      el.innerHTML = `<div class="np-bezel">
          <button class="np-close" type="button" data-close aria-label="Hide navigator">×</button>
          <div class="np-lbz" data-drag><div class="np-knob" title="Drag to move"></div><div class="np-slot"></div><div class="np-knob" title="Drag to move"></div></div>
          <div class="np-screen">
            <div class="np-col">
              <button class="np-sk" type="button" data-sk="menu" aria-label="Menu">${ICON.menu}<span>Menu</span></button>
              <div class="np-info" data-msgind></div>
              <button class="np-sk" type="button" data-sk="back" aria-label="Back">${ICON.back}<span>Back</span></button>
            </div>
            <div class="np-main" data-main></div>
            <div class="np-col">
              <div class="np-box np-act" data-go="navcom"><small>COM</small><b data-fa>---.---</b><i data-fa-name></i></div>
              <div class="np-box np-sby" data-go="navcom"><small>STBY</small><b data-fs>---.---</b><i data-fs-name></i></div>
              <div class="np-box np-xp"><small>XPDR</small><em data-xm>ALT</em><b data-xc>1200</b></div>
              <div class="np-zrow"><button class="np-sk" type="button" data-zoom="+" aria-label="Zoom in">${ICON.zin}<span>In</span></button><button class="np-sk" type="button" data-zoom="-" aria-label="Zoom out">${ICON.zout}<span>Out</span></button></div>
            </div>
            <div class="np-strip"><span class="np-msgind" data-mi></span><span class="np-ph" data-ph>ENR</span><span class="np-src">GPS</span><span class="np-hint" data-hint>Tap COM for Nav / Com</span></div>
          </div>
          <div class="np-rbz"><div class="np-knob" data-drag2 title="Drag to move"></div><button class="np-hk" type="button" data-hw="home" aria-label="Home">HOME</button>
            <button class="np-hk" type="button" data-hw="direct" aria-label="Direct-To">${ICON.direct}</button><div class="np-knob np-big" data-drag3 title="Drag to move"></div></div>
        </div>`;
      (opts.mount || document.body).appendChild(el);
      this.$ = sel => el.querySelector(sel);
      el.addEventListener('click', e => this._click(e));
      for (const s of ['[data-drag]', '[data-drag2]', '[data-drag3]']) this._drag(this.$(s));
      this.place(opts.position);
      if (opts.open === false) el.hidden = true;
      this.render(true);
      addEventListener('resize', () => this.place());
    }
    // ---- public API ----
    update(d) {
      this.data = { ...this.data, ...d };
      const D = this.data, c = D.com || {}, a = c.active || {}, sb = c.standby || {}, x = D.xpdr || {};
      this.$('[data-fa]').textContent = a.freq || '---.---'; this.$('[data-fa-name]').textContent = a.name || '';
      this.$('[data-fs]').textContent = sb.freq || '---.---'; this.$('[data-fs-name]').textContent = sb.name || '';
      this.$('[data-xc]').textContent = x.code || '1200'; this.$('[data-xm]').textContent = x.mode || 'ALT';
      this.$('[data-ph]').textContent = D.phase || 'ENR';
      const msgs = D.msgs || [], last = msgs.length ? msgs[msgs.length - 1] : null, key = m => m.who + '|' + m.text;
      if (this.page === 'msg' || this.seen === undefined) this.seen = last ? key(last) : '';
      const si = msgs.findIndex(m => key(m) === this.seen), unread = !this.seen || si < 0 ? msgs.length : msgs.length - 1 - si;
      this.$('[data-mi]').textContent = unread > 0 ? 'MSG' : ''; this.$('[data-msgind]').textContent = unread > 0 ? `${unread} new message${unread > 1 ? 's' : ''}` : '';
      this.$('[data-msgind]').style.visibility = unread > 0 ? 'visible' : 'hidden';
      this.render();
    }
    show() { this.el.hidden = false; this.place(); this.render(true); }
    hide() { this.el.hidden = true; }
    toggle() { this.el.hidden ? this.show() : this.hide(); return !this.el.hidden; }
    get visible() { return !this.el.hidden; }
    go(page) { if (page !== this.page) { this.hist.push(this.page); if (this.hist.length > 12) this.hist.shift(); } this.page = page; this.render(true); }
    back() { this.page = this.hist.pop() || 'map'; this.render(true); }
    place(pos) {
      if (pos) this.pos = pos;
      const W = innerWidth, H = innerHeight, sc = Math.max(.5, Math.min(1, (W - 16) / W0, (H - 260) / H0));
      this.el.style.transform = `scale(${sc})`;
      const p = this.pos || (W < 640 ? { right: 8, top: H - 236 - H0 * sc } : { right: 8, top: 96 });   // phones: just above the flight controls
      this.el.style.right = Math.max(0, p.right) + 'px'; this.el.style.top = Math.max(0, Math.min(H - 60, p.top)) + 'px';
    }
    // ---- internals ----
    _click(e) {
      const t = e.target.closest('[data-close],[data-hw],[data-sk],[data-go],[data-dto],[data-act],[data-zoom]'); if (!t) return;
      if (t.dataset.zoom) { this.ri = Math.max(0, Math.min(this.ranges.length - 1, this.ri + (t.dataset.zoom === '+' ? -1 : 1))); if (this.page !== 'map') this.go('map'); return this._drawMap(); }
      if (t.hasAttribute('data-close')) return this.hide();
      if (t.dataset.hw === 'home' || t.dataset.sk === 'menu') return this.go('home');
      if (t.dataset.sk === 'back') return this.back();
      if (t.dataset.hw === 'direct') return this.go('direct');
      if (t.dataset.go === 'traffic' && this.data.tfc) { this.opts.onAction && this.opts.onAction('traffic'); return this.render(true); }
      if (t.dataset.go) return this.go(t.dataset.go);
      if (t.dataset.dto) { this.opts.onDirectTo && this.opts.onDirectTo(t.dataset.dto); this.hist = []; return this.go('map'); }
      if (t.dataset.act) { this.opts.onAction && this.opts.onAction(t.dataset.act); this.render(true); }
    }
    _drag(h) {
      let st = null;
      h.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = this.el.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, right: innerWidth - r.right, top: r.top }; h.setPointerCapture(e.pointerId); e.preventDefault(); });
      h.addEventListener('pointermove', e => { if (!st) return; this.place({ right: st.right - (e.clientX - st.x), top: st.top + (e.clientY - st.y) }); });
      const end = () => { if (st && this.opts.onMove) this.opts.onMove(this.pos); st = null; };
      h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    }
    render(force) {
      if (this.el.hidden) return;
      const d = this.data, P = this.page, main = this.$('[data-main]');
      this.$('[data-hint]').textContent = P === 'map' ? 'Tap COM for Nav / Com' : 'Back returns · HOME for menu';
      if (P === 'map') {
        if (force || !this.canvas) { main.innerHTML = `<canvas class="np-canvas"></canvas>
          <div class="np-ov np-dtk"><small>DTK</small><b data-dtk>---°</b></div><div class="np-ov np-trk"><small>TRK</small><b data-trk>---°</b></div>
          <div class="np-ov np-wpt" data-wpt></div><div class="np-ov np-orient">TRK UP</div>
          <div class="np-ov np-dis"><b data-dis>--.-</b><span> NM</span></div><div class="np-ov np-rng" data-rng></div>`;
          this.canvas = main.querySelector('canvas'); this.lastHtml = ''; }
        main.querySelector('[data-dtk]').textContent = f3(d.dtk) + '°'; main.querySelector('[data-trk]').textContent = f3(d.trk) + '°';
        main.querySelector('[data-dis]').textContent = fd(d.dis);
        const w = main.querySelector('[data-wpt]'); w.textContent = d.wpt ? (d.direct ? 'D→ ' : '') + d.wpt : ''; w.style.display = d.wpt ? '' : 'none';
        return this._drawMap();
      }
      this.canvas = null;
      let html = `<div class="np-ptitle">${TITLES[P] || ''}</div>`;
      if (P === 'home') html += `<div class="np-grid">${PAGES.filter(([k]) => k !== 'traffic' || d.tfc).map(([k, l]) => `<button class="np-key" type="button" data-go="${k}">${ICON[k]}<span>${k === 'traffic' ? 'Traffic ' + (d.tfc.on ? 'ON' : 'OFF') : l}</span></button>`).join('')}</div>`;
      else if (P === 'direct') {
        const opts = [], seen = new Set();
        for (const l of d.fpl || []) if (!seen.has(l.id)) { seen.add(l.id); opts.push({ id: l.id, sub: 'flight plan', brg: null, dis: null }); }
        for (const n of d.nearest || []) if (!seen.has(n.id)) { seen.add(n.id); opts.push({ id: n.id, sub: n.name, brg: n.brg, dis: n.dis }); }
        html += `<div class="np-list">${opts.map(o => `<button class="np-row np-tap ${o.id === d.wpt ? 'np-active' : ''}" type="button" data-dto="${esc(o.id)}"><span><b>${esc(o.id)}</b><span class="np-sub">${esc(o.sub)}</span></span><span class="np-num">${o.brg == null ? '' : f3(o.brg) + '°'}</span><span class="np-num">${o.dis == null ? '' : fd(o.dis) + ' NM'}</span></button>`).join('')}</div>`;
      } else if (P === 'fpl') {
        const legs = d.fpl || [];
        html += `<div class="np-list">${d.direct ? `<div class="np-row np-active"><span><b>D→ ${esc(d.wpt)}</b><span class="np-sub">direct from present position</span></span><span class="np-num">${f3(d.dtk)}°</span><span class="np-num">${fd(d.dis)}</span></div>` : ''}
          ${legs.map(l => `<div class="np-row ${l.active && !d.direct ? 'np-active' : ''}"><span><b>${esc(l.id)}</b><span class="np-sub">${esc(l.name || '')}</span></span><span class="np-num">${l.dtk == null ? '' : f3(l.dtk) + '°'}</span><span class="np-num">${l.dis == null ? 'DEP' : fd(l.dis)}</span></div>`).join('')}</div>`;
      } else if (P === 'nearest') {
        html += `<div class="np-list">${(d.nearest || []).map(n => `<button class="np-row np-tap" type="button" data-dto="${esc(n.id)}"><span><b class="${n.tw ? 'np-tw' : 'np-ntw'}">${esc(n.id)}</b><span class="np-sub">${esc(n.name)}</span></span><span class="np-num">${f3(n.brg)}°</span><span class="np-num">${fd(n.dis)}</span></button>`).join('')}</div>
          <div class="np-note">Tap an airport to go direct. <span class="np-tw">Blue</span> = towered, <span class="np-ntw">magenta</span> = CTAF.</div>`;
      } else if (P === 'navcom') {
        const c = d.com || {}, nv = d.nav || {}, n = d.navaid || {}, ca = c.active || {}, cs = c.standby || {}, na = nv.active || {}, ns = nv.standby || {};
        html += `<div class="np-kv"><span>COM</span><b><span style="color:#4dff7c">${esc(ca.freq || '---.---')}</span> ${esc(ca.name || '')}</b><span>STBY</span><b><span style="color:#5ee0ff">${esc(cs.freq || '---.---')}</span> ${esc(cs.name || '')}</b>
          <span>NAV</span><b><span style="color:#4dff7c">${esc(na.freq || '---.--')}</span> ${esc(na.name || '')}</b><span>NAV STBY</span><b><span style="color:#5ee0ff">${esc(ns.freq || '---.--')}</span> ${esc(ns.name || '')}</b>
          <span>NEAREST VOR</span><b>${n.id ? `${esc(n.id)} ${esc(n.name || '')} · ${f3(n.brg)}° ${fd(n.dis)} NM` : '—'}</b></div>
          <div class="np-note">Use the RADIO button to call a facility. The last one you called shows as COM.</div>`;
      } else if (P === 'proc') html += `<div class="np-note">No procedures are loaded for a VFR flight.</div>`;
      else if (P === 'msg') { const m = (d.msgs || []).slice().reverse();
        html += m.length ? `<div class="np-list">${m.map(x => `<div class="np-msg ${x.who === 'YOU' ? 'np-you' : ''}"><b>${esc(x.who)}</b>${esc(x.text)}</div>`).join('')}</div>` : '<div class="np-note">No messages.</div>'; }
      else if (P === 'utilities') html += `<div class="np-list">${(d.utils || []).map(u => `<button class="np-row np-tap" type="button" data-act="${esc(u.id)}"><span><b>${esc(u.label)}</b></span><span></span><span class="np-num">${esc(u.value)}</span></button>`).join('')}</div>`;
      if (force || html !== this.lastHtml) { const pg = main.querySelector('.np-page'), sc = pg ? pg.scrollTop : 0; main.innerHTML = `<div class="np-page">${html}</div>`; main.querySelector('.np-page').scrollTop = sc; this.lastHtml = html; }
    }
    _drawMap() {
      const cv = this.canvas, d = this.data.map; if (!cv) return;
      const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#0d2233'); bg.addColorStop(1, '#0a1a28'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const R = this.ranges[this.ri], rl = this.$('[data-rng]'); if (rl) rl.textContent = R + ' NM';
      if (!d) return;
      const cx = w / 2, cy = h * .58, rr = Math.min(w * .36, h * .5), k = rr / R, rot = -(d.hdg || 0) * Math.PI / 180;   // track-up; the ring is the selected range
      const toS = (dx, dy) => { const x = dx * Math.cos(rot) - dy * Math.sin(rot), y = dx * Math.sin(rot) + dy * Math.cos(rot); return [cx + x * k, cy + y * k]; };
      // range ring with compass ticks and cardinal letters
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, rr, 0, 6.283); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, rr / 2, 0, 6.283); g.stroke();
      for (let a = 0; a < 360; a += 30) { const t = a * Math.PI / 180 + rot, s = Math.sin(t), c = -Math.cos(t), big = a % 90 === 0;
        g.strokeStyle = '#fff'; g.lineWidth = big ? 2 : 1.2; g.beginPath(); g.moveTo(cx + s * rr, cy + c * rr); g.lineTo(cx + s * (rr - (big ? 8 : 5)), cy + c * (rr - (big ? 8 : 5))); g.stroke();
        if (big) { g.fillStyle = '#fff'; g.font = 'bold 12px "Trebuchet MS",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NESW'[a / 90], cx + s * (rr - 17), cy + c * (rr - 17)); } }
      g.fillStyle = '#5ee0ff'; g.beginPath(); g.moveTo(cx, cy - rr - 2); g.lineTo(cx - 6, cy - rr - 11); g.lineTo(cx + 6, cy - rr - 11); g.closePath(); g.fill();   // track pointer
      if (d.leg) { const [a, b] = [toS(...d.leg[0]), toS(...d.leg[1])]; g.strokeStyle = '#ff3fd4'; g.lineWidth = 3; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      for (const it of d.items || []) { const [x, y] = toS(it.dx, it.dy); if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
        g.strokeStyle = it.tw ? '#5aa0ff' : '#ff4fd8'; g.fillStyle = '#06101a'; g.lineWidth = 1.8; g.beginPath(); g.arc(x, y, 4.5, 0, 6.283); g.fill(); g.stroke();
        g.fillStyle = '#e6edf2'; g.font = 'bold 10px "Trebuchet MS",sans-serif'; g.fillText(it.id, x + 7, y + 3); }
      g.save(); g.translate(cx, cy); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1;   // ownship
      g.beginPath(); g.moveTo(0, -11); g.lineTo(1.6, -4); g.lineTo(9, 1); g.lineTo(9, 3); g.lineTo(1.6, 1); g.lineTo(1.2, 7); g.lineTo(4, 9); g.lineTo(4, 10.5); g.lineTo(-4, 10.5); g.lineTo(-4, 9); g.lineTo(-1.2, 7); g.lineTo(-1.6, 1); g.lineTo(-9, 3); g.lineTo(-9, 1); g.lineTo(-1.6, -4); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
  }
  window.NavPanel = NavPanel;
})();
