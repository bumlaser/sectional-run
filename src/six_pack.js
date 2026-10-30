/* SixPack: a floating, draggable "six pack" of round-dial flight instruments.
 *
 * Artwork: QFlightInstruments SVG layers (MIT, (c) 2021 Marek M. Cel), supplied as window.SIXPACK_SVG by
 * src/sixpack_assets.js. Each 240×240 layer is stacked and moved with CSS transforms, using the same rotation
 * centers and scale factors as the Qt widgets.
 *
 *   const six = new SixPack({ mount: document.body, onBug: deg => {...}, onMove: pos => {...} });
 *   six.update({ ias, pitch, roll, alt, baro, turn, slip, hdg, bug, vs });   // call every frame or two
 *
 * Units: ias kt · pitch/roll deg (roll + = right wing down) · alt ft · baro inHg · turn deg/s (+ = right) ·
 * slip deg (ball, + = right) · hdg/bug magnetic deg · vs ft/min.
 * The heading indicator has a heading-bug knob: drag it round, scroll on it, or tap it to sync the bug to the heading.
 */
(function () {
  'use strict';
  const CSS = `
  .sp-root { position:fixed; z-index:4; touch-action:none; user-select:none; -webkit-user-select:none; transform-origin:bottom left; }
  .sp-root[hidden] { display:none !important; }
  .sp-bezel { background:linear-gradient(160deg,#2a2f34 0%,#181b1e 45%,#121416 100%); border:2px solid #000; border-radius:14px; padding:8px 10px 10px;
    box-shadow:0 0 0 1px #3a4046 inset, 0 1px 0 #4a5158 inset, 4px 6px 0 rgba(0,0,0,.55), 0 14px 40px rgba(0,0,0,.5); }
  .sp-top { display:flex; align-items:center; justify-content:space-between; height:20px; padding:0 4px 6px; cursor:grab; }
  .sp-top:active { cursor:grabbing; }
  .sp-grip { width:44px; height:6px; border-radius:3px; background:repeating-linear-gradient(90deg,#4a5158 0 3px,transparent 3px 6px); }
  .sp-brand { font:bold 9px "Courier New",monospace; letter-spacing:2px; color:#7d8892; }
  .sp-close { width:22px; height:18px; border:1px solid #000; border-radius:4px; background:#23272b; color:#9aa6b0; font:bold 12px/1 "Courier New",monospace; cursor:pointer; padding:0; box-shadow:none; }
  .sp-panel { display:grid; grid-template-columns:repeat(3,128px); gap:6px; padding:8px; border-radius:6px; background:#1b1e21; box-shadow:inset 0 2px 8px rgba(0,0,0,.8); }
  .sp-inst { position:relative; width:128px; height:128px; }
  .sp-inst img, .sp-inst svg.sp-ov { position:absolute; inset:0; width:100%; height:100%; transform-origin:50% 50%; pointer-events:none; }
  .sp-inst img.sp-ball { transform-origin:50% -15%; }
  .sp-knob { position:absolute; right:-4px; bottom:-4px; width:34px; height:34px; border-radius:50%; border:2px solid #000; cursor:grab; touch-action:none;
    background:radial-gradient(circle at 38% 32%, #6b737a 0%, #3a4045 45%, #1d2124 100%); box-shadow:0 2px 0 #000, inset 0 1px 0 rgba(255,255,255,.2); padding:0; }
  .sp-knob::before { content:""; position:absolute; inset:3px; border-radius:50%; background:repeating-conic-gradient(rgba(0,0,0,.35) 0 6deg, transparent 6deg 15deg); }
  .sp-knob i { position:absolute; left:50%; top:3px; width:3px; height:9px; margin-left:-1.5px; border-radius:2px; background:#ffb000; }
  .sp-knob:active { cursor:grabbing; }
  .sp-knob:focus-visible { outline:2px solid #fff; }
  .sp-kl { position:absolute; right:30px; bottom:-3px; font:bold 8px "Courier New",monospace; color:#ffb000; letter-spacing:.5px; pointer-events:none; text-shadow:0 1px 0 #000; }
  .sp-credit { margin-top:6px; text-align:right; font:9px "Courier New",monospace; color:#5d6870; }
  `;
  const LAYERS = {
    asi: ['asi_face', 'asi_hand', 'asi_case'],
    ai: ['ai_back', 'ai_face', 'ai_ring', 'ai_case'],
    alt: ['alt_face_1', 'alt_face_2', 'alt_face_3', 'alt_hand_1', 'alt_hand_2', 'alt_case'],
    tc: ['tc_back', 'tc_ball', 'tc_face_1', 'tc_face_2', 'tc_mark', 'tc_case'],
    hi: ['hi_face', 'BUG', 'hi_case'],
    vsi: ['vsi_face', 'vsi_hand', 'vsi_case'],
  };
  const ORDER = ['asi', 'ai', 'alt', 'tc', 'hi', 'vsi'];
  const BUG_SVG = '<svg class="sp-ov" viewBox="0 0 240 240" data-bug><path d="M110 30 L110 41 L116 41 L120 47 L124 41 L130 41 L130 30 Z" fill="#ffb000" stroke="#000" stroke-width="1.5"/></svg>';
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const asiAngle = v => v < 40 ? .9 * v : v < 70 ? 36 + 1.8 * (v - 40) : v < 130 ? 90 + 2 * (v - 70) : v < 160 ? 210 + 1.8 * (v - 130) : 264 + 1.2 * (v - 160);

  class SixPack {
    constructor(opts = {}) {
      this.opts = opts; const A = window.SIXPACK_SVG || {}; this.bug = 0; this.hdg = 0;
      if (!document.getElementById('sp-style')) { const st = document.createElement('style'); st.id = 'sp-style'; st.textContent = CSS; document.head.appendChild(st); }
      const el = this.el = document.createElement('div'); el.className = 'sp-root'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Flight instruments');
      const inst = k => `<div class="sp-inst" data-i="${k}">${LAYERS[k].map(l => l === 'BUG' ? BUG_SVG : `<img alt="" draggable="false" data-l="${l}" class="${l === 'tc_ball' ? 'sp-ball' : ''}" src="${A[l] || ''}">`).join('')}
        ${k === 'hi' ? '<span class="sp-kl">HDG</span><button class="sp-knob" type="button" data-knob aria-label="Heading bug knob: drag to turn, tap to sync"><i></i></button>' : ''}</div>`;
      el.innerHTML = `<div class="sp-bezel"><div class="sp-top" data-drag><div class="sp-grip"></div><span class="sp-brand">FLIGHT INSTRUMENTS</span><button class="sp-close" type="button" data-close aria-label="Hide instruments">×</button></div>
        <div class="sp-panel">${ORDER.map(inst).join('')}</div><div class="sp-credit">gauges: QFlightInstruments (MIT)</div></div>`;
      (opts.mount || document.body).appendChild(el);
      this.L = {}; el.querySelectorAll('[data-l]').forEach(i => this.L[i.dataset.l] = i); this.L.BUG = el.querySelector('[data-bug]');
      el.querySelector('[data-close]').addEventListener('click', () => this.hide());
      this._drag(); this._knob();
      this.place(opts.position); if (opts.open === false) el.hidden = true;
      addEventListener('resize', () => this.place());
    }
    show() { this.el.hidden = false; this.place(); }
    hide() { this.el.hidden = true; }
    toggle() { this.el.hidden ? this.show() : this.hide(); return !this.el.hidden; }
    get visible() { return !this.el.hidden; }
    place(pos) {
      if (pos) this.pos = pos;
      const W = innerWidth, H = innerHeight, w = 424, h = 330, sc = Math.min(1, (W - 24) / w, (H - 220) / h);
      this.el.style.transform = `scale(${Math.max(.5, sc)})`;
      const p = this.pos || { left: 12, bottom: 130 };
      this.el.style.left = Math.max(0, Math.min(W - 60, p.left)) + 'px'; this.el.style.bottom = Math.max(0, Math.min(H - 60, p.bottom)) + 'px';
    }
    update(s) {
      if (this.el.hidden) return; const L = this.L, rot = (k, d, extra = '') => { if (L[k]) L[k].style.transform = `${extra}rotate(${d}deg)`; };
      rot('asi_hand', asiAngle(clamp(s.ias || 0, 0, 235)));
      const roll = clamp(s.roll || 0, -180, 180), pitch = clamp(s.pitch || 0, -25, 25), r = roll * Math.PI / 180, dp = 1.7 * pitch * (128 / 240);
      rot('ai_back', -roll); rot('ai_ring', -roll); rot('ai_face', -roll, `translate(${(dp * Math.sin(r)).toFixed(2)}px, ${(dp * Math.cos(r)).toFixed(2)}px) `);
      const alt = s.alt || 0, baro = clamp(s.baro || 29.92, 28, 31.5);
      rot('alt_hand_1', alt * .036); rot('alt_hand_2', (alt % 1000) * .36); rot('alt_face_1', -(baro - 28) * 100); rot('alt_face_3', alt * .0036);
      rot('tc_mark', clamp(s.turn || 0, -6, 6) / 3 * 20); rot('tc_ball', -clamp(s.slip || 0, -15, 15));
      this.hdg = s.hdg || 0; if (s.bug != null) this.bug = s.bug;
      rot('hi_face', -this.hdg); rot('BUG', this.bug - this.hdg);
      rot('vsi_hand', clamp(s.vs || 0, -2000, 2000) * .086);
    }
    _setBug(d) { this.bug = ((d % 360) + 360) % 360; if (this.L.BUG) this.L.BUG.style.transform = `rotate(${this.bug - this.hdg}deg)`; this.opts.onBug && this.opts.onBug(this.bug); }
    _knob() {
      const k = this.el.querySelector('[data-knob]'); if (!k) return; let st = null;
      const ang = e => { const r = k.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
      k.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); st = { a: ang(e), x: e.clientX, y: e.clientY, moved: false, rot: 0 }; k.setPointerCapture(e.pointerId); });
      k.addEventListener('pointermove', e => { if (!st) return; let a = ang(e), d = a - st.a; if (d > 180) d -= 360; if (d < -180) d += 360; st.a = a;
        if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 4) st.moved = true; if (!st.moved) return;
        st.rot += d; k.style.transform = `rotate(${st.rot}deg)`; this._setBug(this.bug + d); });   // one knob turn = 360° of bug
      const end = () => { if (st && !st.moved) this._setBug(Math.round(this.hdg)); st = null; };   // tap = push to sync
      k.addEventListener('pointerup', end); k.addEventListener('pointercancel', () => { st = null; });
      k.addEventListener('wheel', e => { e.preventDefault(); this._setBug(this.bug + (e.deltaY > 0 ? 5 : -5)); }, { passive: false });
      k.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this._setBug(this.bug + 5); } if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); this._setBug(this.bug - 5); } });
    }
    _drag() {
      const bar = this.el.querySelector('[data-drag]'); let st = null;
      bar.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = this.el.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, left: r.left, bottom: innerHeight - r.bottom }; bar.setPointerCapture(e.pointerId); e.preventDefault(); });
      bar.addEventListener('pointermove', e => { if (st) this.place({ left: st.left + (e.clientX - st.x), bottom: st.bottom - (e.clientY - st.y) }); });
      const end = () => { if (st && this.opts.onMove) this.opts.onMove(this.pos); st = null; };
      bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    }
  }
  window.SixPack = SixPack;
})();
