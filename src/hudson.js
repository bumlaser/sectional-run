// ====================================================================
//  Hudson River SFRA (14 CFR 93 Subpart W): the Hudson River Exclusion, surface up to but not including 1,300 ft
//  MSL, Alpine Tower to the Verrazano-Narrows Bridge. Inside it (below 1,300) the New York Class B doesn't apply.
//  Self-announce on 123.05 at the reporting points, keep to the right-hand shore, and the plane slows to 90 kt and
//  may bank to 30° so it can turn round inside the river. Circling the Statue of Liberty scores.
// ====================================================================
const HUD = WD.hudson || null, HUD_FREQ = '123.050';
const STATUE = HUD && HUD.pts.find(p => p.id === 'SOL');
const HUD_VOLS = VOL.filter(v => v.k === 'HSFRA');
function hudIn(x = pl.x, y = pl.y, alt = pl.alt) { return alt < 1300 && HUD_VOLS.some(v => horiz(v, x, y)); }
const shortName = n => n.replace(/^the /, '');
// nearest point on the river centreline: lateral offset (+ = east of a southbound track) and the southbound tangent
function hudSide() {
  let best = null;
  for (let i = 0; i < HUD.cl.length - 1; i++) {
    const [ax, ay] = HUD.cl[i], [bx, by] = HUD.cl[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
    const u = clamp(((pl.x - ax) * dx + (pl.y - ay) * dy) / L2, 0, 1), qx = ax + u * dx, qy = ay + u * dy, d = Math.hypot(pl.x - qx, pl.y - qy);
    if (!best || d < best.d) best = { d, tx: dx / L, ty: dy / L, lat: (pl.x - qx) * (dy / L) - (pl.y - qy) * (dx / L) };
  }
  const along = Math.sin(pl.hdg * D2R) * best.tx - Math.cos(pl.hdg * D2R) * best.ty;
  return { ...best, dir: along > .5 ? 'south' : along < -.5 ? 'north' : null };
}
function hudTick() {
  if (!HUD) return;
  const H = game.hud || (game.hud = { visits: {}, wrongT: 0, wrongAt: -999, circ: 0, circN: 0, prevAng: null, t: game.t }), dt = game.t - H.t, inn = hudIn(); H.t = game.t;
  for (const p of HUD.pts) {   // reporting points: announce while you're within about a mile
    const d = Math.hypot(pl.x - p.x, pl.y - p.y), v = H.visits[p.id];
    if (inn && d < .8 && !v) H.visits[p.id] = { ann: false };
    else if (v && d > 1.1) { if (!v.ann) addScore(-25, `No self-announce at ${shortName(p.n)}`); delete H.visits[p.id]; }
  }
  if (inn && STATUE && pl.y < STATUE.y - .7) {   // keep right: southbound on the west (New Jersey) shore, northbound on the east (Manhattan) shore
    const s = hudSide(), wrong = (s.dir === 'south' && s.lat > .05) || (s.dir === 'north' && s.lat < -.05);
    H.wrongT = wrong ? H.wrongT + dt : 0;
    if (H.wrongT > 15 && game.t - H.wrongAt > 120) { H.wrongAt = game.t; addScore(-25, 'Wrong side of the river: keep to the right-hand shore'); }
  }
  if (STATUE) {   // circle the lady
    const d = Math.hypot(pl.x - STATUE.x, pl.y - STATUE.y);
    if (inn && d < .7) {
      const a = Math.atan2(pl.y - STATUE.y, pl.x - STATUE.x);
      if (H.prevAng != null) { let da = a - H.prevAng; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; H.circ += da; }
      H.prevAng = a;
      if (Math.abs(H.circ) >= 2 * Math.PI) { H.circ = 0; H.circN++; if (H.circN <= 3) addScore(100, 'Circled the Statue of Liberty'); else flash('Another lap around the lady', '#71CF88'); }
    } else if (d > .9) { H.circ = 0; H.prevAng = null; }
  }
}
function hudFacility() {
  if (!HUD || pl.alt > 2500 || !HUD.pts.some(p => Math.hypot(pl.x - p.x, pl.y - p.y) < 3)) return null;
  FREQ['Hudson CTAF'] = HUD_FREQ; const p = HUD.pts[1];
  return { g: 'HUD', name: 'Hudson CTAF', note: 'self-announce at each reporting point', x: p.x, y: p.y, act: 'Announce' };
}
function hudAnnounce() {
  const p = HUD.pts.slice().sort((a, b) => Math.hypot(pl.x - a.x, pl.y - a.y) - Math.hypot(pl.x - b.x, pl.y - b.y))[0], d = Math.hypot(pl.x - p.x, pl.y - p.y);
  const s = hudSide(), dir = s.dir || (Math.cos(pl.hdg * D2R) < 0 ? 'south' : 'north');
  radioMsg('YOU', `Hudson traffic, Skyhawk N421AP, ${d < .8 ? shortName(p.n) : 'approaching ' + shortName(p.n)}, ${dir}bound, ${fmt(pl.alt)}, ${dir === 'south' ? 'west' : 'east'} shore, Hudson.`);
  game.lastFac = 'Hudson CTAF';
  if (d < 1.1 && pl.alt < 1300) { const H = game.hud || (hudTick(), game.hud), v = H.visits[p.id] || (H.visits[p.id] = { ann: false });
    if (!v.ann) { v.ann = true; addScore(25, `Self-announced at ${shortName(p.n)}`); } }
}
QUIZ.push(
  { id: 'hudCeil', when: () => HUD && hudIn(), kicker: 'Hudson River SFRA', q: 'You\'re in the Hudson River Exclusion. How high can you fly without a Class B clearance?',
    a: ['Up to 1,299 ft MSL: the exclusion is up to, but not including, 1,300', 'Up to and including 1,300 ft MSL', '1,000 ft above the river'],
    why: 'The Exclusion runs from the surface up to but not including 1,300 ft MSL. At 1,300 you\'re in the New York Class B, which needs a clearance. Transit pilots usually fly 1,000 to 1,299.' },
  { id: 'hudRules', when: () => HUD && hudIn() && game.asked.hudCeil, kicker: 'Hudson River SFRA', q: 'Which of these is a Hudson River SFRA rule?',
    a: ['140 knots or less, keep to the right-hand shore, and self-announce on 123.05 at each reporting point', 'Call New York Approach for a clearance before entering', 'Stay above 1,000 ft MSL at all times'],
    why: 'In the Exclusion you need no clearance. Fly at 140 KIAS or less, keep right (southbound on the New Jersey side, northbound on the Manhattan side), and announce on 123.05 at the charted reporting points.' });
// reporting points on the canvas chart (the 3D build draws them as map layers)
function drawHudPts() {
  if (!HUD || cam.s < 18) return;
  for (const p of HUD.pts) { const [x, y] = P(p.x, p.y); if (x < -60 || x > W + 60 || y < -20 || y > H + 20) continue;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = BLUE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    label(shortName(p.n).toUpperCase(), x + 9, y + 4, BLUE, 10, 'bold', 'left'); }
}
