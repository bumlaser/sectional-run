/* GaugeStrip: the six round-dial instruments in a single row, sized to fit the width of their container.
 *
 * Same artwork and needle geometry as SixPack (QFlightInstruments SVG layers, MIT, (c) 2021 Marek M. Cel, supplied
 * as window.SIXPACK_SVG), but with no bezel, drag bar or knob: it sits inside the flight controls.
 *
 *   const strip = new GaugeStrip(document.getElementById('gstrip'));
 *   strip.update({ ias, pitch, roll, alt, baro, turn, slip, hdg, bug, vs });   // same units as SixPack.update()
 */
(function () {
  'use strict';
  const CSS = `
  .gstrip { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:4px; max-width:660px; width:100%; margin:0 auto; box-sizing:border-box; padding:5px;
    border-radius:6px; background:linear-gradient(180deg,#24282b,#16181a); box-shadow:inset 0 2px 6px rgba(0,0,0,.85), 0 0 0 1px #000, 0 2px 4px rgba(0,0,0,.4); }
  .gs-inst { position:relative; width:100%; aspect-ratio:1; max-width:96px; justify-self:center; }
  .gs-inst img, .gs-inst svg { position:absolute; inset:0; width:100%; height:100%; transform-origin:50% 50%; pointer-events:none; }
  .gs-inst img.gs-ball { transform-origin:50% -15%; }
  `;
  const LAYERS = {
    asi: ['asi_face', 'asi_hand', 'asi_case'],
    ai: ['ai_back', 'ai_face', 'ai_ring', 'ai_case'],
    alt: ['alt_face_1', 'alt_face_2', 'alt_face_3', 'alt_hand_1', 'alt_hand_2', 'alt_case'],
    tc: ['tc_back', 'tc_ball', 'tc_face_1', 'tc_face_2', 'tc_mark', 'tc_case'],
    hi: ['hi_face', 'BUG', 'hi_case'],
    vsi: ['vsi_face', 'vsi_hand', 'vsi_case'],
  };
  const NAMES = { asi: 'Airspeed', ai: 'Attitude', alt: 'Altimeter', tc: 'Turn coordinator', hi: 'Heading', vsi: 'Vertical speed' };
  const BUG_SVG = '<svg viewBox="0 0 240 240" data-bug aria-hidden="true"><path d="M110 30 L110 41 L116 41 L120 47 L124 41 L130 41 L130 30 Z" fill="#ffb000" stroke="#000" stroke-width="1.5"/></svg>';
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const asiAngle = v => v < 40 ? .9 * v : v < 70 ? 36 + 1.8 * (v - 40) : v < 130 ? 90 + 2 * (v - 70) : v < 160 ? 210 + 1.8 * (v - 130) : 264 + 1.2 * (v - 160);

  class GaugeStrip {
    constructor(el) {
      const A = window.SIXPACK_SVG || {}; this.el = el;
      if (!document.getElementById('gs-style')) { const st = document.createElement('style'); st.id = 'gs-style'; st.textContent = CSS; document.head.appendChild(st); }
      el.classList.add('gstrip');
      el.innerHTML = Object.keys(LAYERS).map(k => `<div class="gs-inst" role="img" aria-label="${NAMES[k]}">${LAYERS[k].map(l => l === 'BUG' ? BUG_SVG
        : `<img alt="" draggable="false" data-l="${l}" class="${l === 'tc_ball' ? 'gs-ball' : ''}" src="${A[l] || ''}">`).join('')}</div>`).join('');
      this.L = {}; el.querySelectorAll('[data-l]').forEach(i => this.L[i.dataset.l] = i); this.L.BUG = el.querySelector('[data-bug]');
    }
    update(s) {
      const L = this.L, size = this.el.querySelector('.gs-inst').clientWidth || 60, rot = (k, d, extra = '') => { if (L[k]) L[k].style.transform = `${extra}rotate(${d}deg)`; };
      rot('asi_hand', asiAngle(clamp(s.ias || 0, 0, 235)));
      const roll = clamp(s.roll || 0, -180, 180), pitch = clamp(s.pitch || 0, -25, 25), r = roll * Math.PI / 180, dp = 1.7 * pitch * (size / 240);
      rot('ai_back', -roll); rot('ai_ring', -roll); rot('ai_face', -roll, `translate(${(dp * Math.sin(r)).toFixed(2)}px, ${(dp * Math.cos(r)).toFixed(2)}px) `);
      const alt = s.alt || 0, baro = clamp(s.baro || 29.92, 28, 31.5);
      rot('alt_hand_1', alt * .036); rot('alt_hand_2', (alt % 1000) * .36); rot('alt_face_1', -(baro - 28) * 100); rot('alt_face_3', alt * .0036);
      rot('tc_mark', clamp(s.turn || 0, -6, 6) / 3 * 20); rot('tc_ball', -clamp(s.slip || 0, -15, 15));
      const hdg = s.hdg || 0; rot('hi_face', -hdg); rot('BUG', (s.bug ?? hdg) - hdg);
      rot('vsi_hand', clamp(s.vs || 0, -2000, 2000) * .086);
    }
  }
  window.GaugeStrip = GaugeStrip;
})();
