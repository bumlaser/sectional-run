// ====================================================================
//  Airport operations at KFDK: ramp, ATIS, Ground, taxi, Tower, takeoff, the traffic pattern, landing, taxi in.
//  The plane flies itself through these phases; the player makes the decisions and the radio calls.
//
//  The field layout is the stylized KFDK from the first version of this game (traced from the airport diagram),
//  in feet, in a frame aligned with runway 5/23: s along the runway-5 direction from the runway midpoint, t toward
//  the southeast side (AOPA's side). It is placed on the FAA geometry for runway 5/23.
//  Frequencies are from the Baltimore-Washington TAC tower table: ATIS 124.875, Ground 127.425, Tower 132.4.
// ====================================================================
const FT_NM = 1 / 6076.12, CS_NM = 'N421AP', CS_SAY = 'Skyhawk N421AP';
const FDK_FREQ = { atis: '124.875', gnd: '127.425', twr: '132.400' };
const FIELD = (() => {
  const a = AP.FDK, r = a.rw.find(r => r[6] === '05/23');
  let [x1, y1, x2, y2] = r, h = brg(x1, y1, x2, y2);
  if (Math.abs(angDiff(norm(h + VAR), 50)) > 90) { [x1, y1, x2, y2] = [x2, y2, x1, y1]; h = norm(h + 180); }   // end 1 = runway 5 threshold
  const ux = Math.sin(h * D2R), uy = -Math.cos(h * D2R), nx = -uy, ny = ux, mx = (x1 + x2) / 2, my = (y1 + y2) / 2, len = Math.hypot(x2 - x1, y2 - y1);
  const F = (s, t) => [mx + (ux * s + nx * t) * FT_NM, my + (uy * s + ny * t) * FT_NM];
  const RW = {
    5: { id: '5', say: 'five', thr: [x1, y1], hdg: h, u: [ux, uy], side: 'right', dir: 1 },
    23: { id: '23', say: 'two three', thr: [x2, y2], hdg: norm(h + 180), u: [-ux, -uy], side: 'left', dir: -1 },
  };
  const TW = [   // taxiway centrelines [s, t] in feet
    { n: 'A', p: [[-2960, -400], [2960, -400]] }, { n: 'E', p: [[-700, 400], [2960, 400]] },
    ...[-2870, -1500].map(s => ({ n: 'A', p: [[s, -400], [s, 0]] })), ...[0, 1200, 2870].map(s => ({ n: 'X', p: [[s, -400], [s, 400]] })), { n: 'E', p: [[-650, 400], [-650, 0]] },
  ];
  const APRON = [[350, 425, 1150, 850, 'AOPA ramp'], [1150, 425, 1450, 560, 'AOPA hangar apron'], [-1700, -950, -100, -425, 'Main ramp'], [-1700, -1720, -250, -950, 'Hangars'],
    [1500, -950, 2400, -425, 'East hangars'], [-2960, -540, -2780, -425, 'Run-up 5'], [2780, 425, 2960, 540, 'Run-up 23']];
  const BLD = [[420, 900, 1080, 1010, 34, '#d4d7d9', 'AOPA headquarters'], [440, 1010, 580, 1170, 30, '#cdd1d3'], [920, 1010, 1060, 1170, 30, '#cdd1d3'], [690, 1010, 810, 1090, 38, '#b9c4cc'],
    [1170, 560, 1430, 820, 42, '#aeb8c1', 'AOPA hangar'], [-1250, -1160, -850, -990, 28, '#d9cdb8', 'Terminal'], [-700, -1080, -640, -1020, 80, '#c9c2b5', 'Tower'], [-1680, -1290, -1420, -990, 46, '#a7b1b9']];
  const HOLD = [[2870, 200], [-650, 200], [0, 200], [1200, 200], [-2870, -200], [-1500, -200], [0, -200], [1200, -200], [2870, -200]];
  a.sock = F(-300, 250);
  return { F, RW, TW, APRON, BLD, HOLD, len, h, elev: a.e, tpa: Math.round((a.e + 1000) / 100) * 100, start: [520, 600], park: [990, 520] };
})();
const fpts = pts => pts.map(([s, t]) => FIELD.F(s, t));

// ---- state ------------------------------------------------------------------------------------
const OPS = { phase: 'free', auto: false, rw: null, intent: null, atis: null, path: null, legs: null, routeVer: 0, spd: 0, onGround: false };
function opsBusy() { return OPS.phase !== 'free'; }
function opsReset() {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)], z = new Date(), alt = (29.8 + Math.random() * .45).toFixed(2);
  Object.assign(OPS, { phase: 'ramp', auto: true, rw: runwayForWind(), intent: null, heardAtis: false, atis: { L, time: `${String(z.getUTCHours()).padStart(2, '0')}53`, alt }, path: null, legs: null, spd: 0, onGround: true, cleared: {}, route: null, exitS: null, canJoin: false, freqChange: false, reportMid: false, reported: false });
  const [x, y] = FIELD.F(...FIELD.start);
  Object.assign(pl, { x, y, hdg: norm(FIELD.h - 90), bug: norm(FIELD.h - 90), alt: FIELD.elev, tgt: FIELD.elev, vs: 0, rate: 0, bank: 0, patt: 0 });
  OPS.routeVer++; opsZoom('ground'); opsCard();
}
function runwayForWind() {
  const w = windAt(AP.FDK.x, AP.FDK.y); if (w.spd < 3) return '23';   // calm: the long runway, 23
  const hw = id => w.spd * Math.cos((w.dir - FIELD.RW[id].hdg) * D2R);
  return hw('23') >= hw('5') ? '23' : '5';
}
const rwSay = id => `runway ${FIELD.RW[id].say}`;
const windSay = () => { const w = windAt(AP.FDK.x, AP.FDK.y); return w.spd < 3 ? 'wind calm' : `wind ${hdg3(Math.round(norm(w.dir + VAR) / 10) * 10)} at ${w.spd}${w.gust ? ' gusts ' + w.gust : ''}`; };
const depCourse = () => brg(AP.FDK.x, AP.FDK.y, DEST.x, DEST.y);
const depTurn = () => angDiff(depCourse(), FIELD.RW[OPS.rw].hdg) < 0 ? 'left' : 'right';

// ---- taxi routes (feet in the field frame) ------------------------------------------------------
function routeOut(id) {
  return id === '23' ? { pts: [FIELD.start, [520, 400], [2870, 400], [2870, 200]], via: 'Echo', lineup: [[2870, 200], [2885, 0]], say: `${rwSay('23')}, taxi via Echo` }
    : { pts: [FIELD.start, [520, 400], [0, 400], [0, -400], [-2870, -400], [-2870, -200]], via: 'Echo, cross 5/23, Alpha', lineup: [[-2870, -200], [-2885, 0]], cross: true,
      say: `${rwSay('5')}, taxi via Echo, cross runway five two three, then Alpha` };
}
function routeIn(sExit) { return [[sExit, 400], [FIELD.park[0], 400], FIELD.park]; }

// ---- the radio: tune, then choose what to say ---------------------------------------------------
// openCall({ who, freq, kicker, q, opts: [{ t, ok, why }], reply, onOk }) shows a two-step sheet: pick the frequency, then the call.
const FREQ_CHOICES = ['124.875', '127.425', '132.400', '121.500', '122.800'];
function openCall(c) {
  game.call = c; c.stage = c.freq ? 'tune' : 'say'; c.wrong = 0;
  c.optsS = c.opts.map(o => ({ ...o })); for (let i = c.optsS.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [c.optsS[i], c.optsS[k]] = [c.optsS[k], c.optsS[i]]; }
  callRender(); showSheet(true);
}
function callRender(msg) {
  const c = game.call, card = document.getElementById('sheetCard');
  if (c.stage === 'tune') {
    card.innerHTML = `<div class="kicker">RADIO · ${c.kicker}</div><h3>Tune ${c.who}</h3><p>Which frequency?</p><div class="opts freqs">${FREQ_CHOICES.map(f => `<button type="button" data-rc="tune" data-f="${f}">${f}</button>`).join('')}</div>${msg || ''}`;
  } else if (c.stage === 'say') {
    card.innerHTML = `<div class="kicker">RADIO · ${c.who.toUpperCase()}${c.freq ? ' · ' + c.freq : ''}</div><h3>${c.q}</h3><div class="opts">${c.optsS.map((o, i) => `<button type="button" data-rc="say" data-i="${i}">${o.t}</button>`).join('')}</div>${msg || ''}`;
  } else {
    card.innerHTML = `<div class="kicker">RADIO · ${c.who.toUpperCase()}</div><h3>${c.done.title}</h3>${c.done.html}<div class="actions"><button type="button" data-rc="next">Continue</button></div>`;
  }
}
document.getElementById('sheetCard').addEventListener('click', e => {
  const b = e.target.closest('[data-rc]'); if (!b || !game.call) return; const c = game.call;
  if (b.dataset.rc === 'tune') {
    if (b.dataset.f === c.freq) { c.stage = 'say'; return callRender(); }
    c.wrong++; addScore(-15, `Wrong frequency for ${c.who}`); b.disabled = true; b.classList.add('wrong'); return showWhy(`${b.dataset.f} isn't ${c.who}. ${c.tuneHint || ''}`);
  }
  if (b.dataset.rc === 'say') {
    const o = c.optsS[+b.dataset.i];
    if (!o.ok) { c.wrong++; addScore(-25, 'Radio call: ' + (o.miss || 'not quite')); b.disabled = true; b.classList.add('wrong'); return showWhy(o.why); }
    game.calls = (game.calls || 0) + 1; if (!c.wrong) { game.callsOk = (game.callsOk || 0) + 1; addScore(25, c.score || 'Good radio call'); }
    radioMsg('YOU', o.t); game.lastFac = c.who;
    const reply = typeof c.reply === 'function' ? c.reply(o) : c.reply; if (reply) radioMsg(c.replyWho || 'TWR', reply);
    c.stage = 'done'; c.done = { title: reply ? `${c.replyWho || 'ATC'} replies` : 'Roger', html: `${o.why ? `<p class="why">${o.why}</p>` : ''}${reply ? `<p class="atc">“${reply}”</p>` : ''}` };
    c.chosen = o; return callRender();
  }
  if (b.dataset.rc === 'next') { game.call = null; showSheet(false); c.onOk && c.onOk(c.chosen); opsCard(); }
});
function showWhy(text) { const p = document.createElement('p'), old = document.querySelector('#sheetCard .why'); p.className = 'why'; p.innerHTML = text; old ? old.replaceWith(p) : document.querySelector('#sheetCard .opts').after(p); }
function readback(who, q, right, wrongs, onOk) {
  openCall({ who, kicker: 'READBACK', q, opts: [{ t: right, ok: true }, ...wrongs.map(([t, w, miss]) => ({ t, ok: false, why: w, miss }))], score: 'Correct readback', onOk });
}

// ---- the card above the dock: what's happening and what you can do ------------------------------
function opsCard() {
  const el = document.getElementById('opsCard'); if (!el) return;
  const R = OPS.rw && FIELD.RW[OPS.rw], b = (op, label, cls = '') => `<button type="button" data-op="${op}" class="${cls}">${label}</button>`;
  let title = '', text = '', btns = '';
  switch (OPS.phase) {
    case 'ramp': title = 'AOPA ramp · engine running'; text = OPS.heardAtis ? `You have information ${OPS.atis.L}. Call Ground for taxi.` : 'Get the weather first: listen to the ATIS.';
      btns = b('atis', 'ATIS ' + FDK_FREQ.atis, OPS.heardAtis ? '' : 'hi') + b('ground', 'Call Ground', OPS.heardAtis ? 'hi' : ''); break;
    case 'taxi': title = `Taxi to ${rwSay(OPS.rw)}`; text = `Via ${OPS.route.via}. ${OPS.route.cross ? 'You were cleared to cross 5/23 on the way.' : ''}`; break;
    case 'runup': title = `Holding short ${rwSay(OPS.rw)}`; text = 'Run-up: mags, carb heat, controls free and correct, instruments set.'; btns = b('runup', 'Run-up complete', 'hi'); break;
    case 'ready': title = `Holding short ${rwSay(OPS.rw)}`; text = 'Run-up done. Tell Tower you\'re ready.'; btns = b('tower', 'Call Tower', 'hi'); break;
    case 'lineup': case 'roll': title = `Departing ${rwSay(OPS.rw)}`; text = OPS.phase === 'roll' ? 'Full power, rotate at 55 KIAS.' : 'Lining up.'; break;
    case 'pattern': { const L = OPS.legs[OPS.legI]; title = `${R.side === 'left' ? 'Left' : 'Right'} traffic · ${rwSay(OPS.rw)}`; text = `${L.label}.${OPS.cleared.land ? ' Cleared to land.' : ''}`;
      if (L.n === 'downwind' && OPS.reportMid && !OPS.reported) btns = b('midfield', 'Report midfield', 'hi'); break; }
    case 'depart': title = `Departing ${rwSay(OPS.rw)}`; text = `Climbing on runway heading. ${depTurn() === 'left' ? 'Left' : 'Right'} turn on course at 700 ft above the field.`; break;
    case 'flare': case 'rollout': case 'exitRoll': title = 'Landing'; text = OPS.phase === 'flare' ? 'Over the threshold: power off, flare.' : 'Slow to taxi speed and exit the runway.'; break;
    case 'exit': title = 'Clear of the runway'; text = 'Stop past the hold line, then call Ground.'; btns = b('groundIn', 'Call Ground', 'hi'); break;
    case 'taxiIn': title = 'Taxi to the AOPA ramp'; text = 'Via Echo, to the P spot.'; break;
    case 'parked': title = 'Parked on the AOPA ramp'; text = 'Nice flight.'; btns = b('shutdown', 'Shut down', 'hi'); break;
    case 'free': if (OPS.canJoin) { title = 'Frederick · Class D'; text = 'Tower wants to hear from you before you enter the Delta.'; btns = (OPS.heardAtis ? '' : b('atis', 'ATIS ' + FDK_FREQ.atis)) + b('inbound', 'Call Tower', 'hi'); } break;
  }
  el.hidden = !title; el.innerHTML = title ? `<div class="oc-t">${title}</div><div class="oc-x">${text}</div>${btns ? `<div class="oc-b">${btns}</div>` : ''}` : '';
  document.getElementById('ctl').classList.toggle('auto', OPS.auto);
}
document.getElementById('opsCard').addEventListener('click', e => { const b = e.target.closest('[data-op]'); if (b && running && !game.over) opsAction(b.dataset.op); });

function atisText() {
  const A = OPS.atis, R = OPS.rw;
  return `Frederick information ${A.L}, ${A.time} Zulu. ${windSay().replace(/^w/, 'W')}. Visibility one zero. Sky clear. Altimeter ${A.alt}. Landing and departing ${rwSay(R)}. ${FIELD.RW[R].side === 'left' ? 'Left' : 'Right'} traffic. Advise on initial contact you have information ${A.L}.`;
}
function opsAction(op) {
  const A = OPS.atis, R = OPS.rw, Rw = FIELD.RW[R];
  if (op === 'atis') {
    OPS.heardAtis = true; radioMsg('ATIS', atisText());
    document.getElementById('sheetCard').innerHTML = `<div class="kicker">ATIS · ${FDK_FREQ.atis}</div><h3>Frederick information ${A.L}</h3><p class="atc">${atisText()}</p><p class="why">Note the wind and the runway in use. You'll tell Ground and Tower you have “${A.L}”.</p><div class="actions"><button type="button" data-close>Got it</button></div>`;
    showSheet(true); return opsCard();
  }
  if (op === 'ground') {
    const atis = OPS.heardAtis ? ` with information ${A.L}` : '';
    openCall({ who: 'Frederick Ground', freq: FDK_FREQ.gnd, kicker: 'REQUEST TAXI', tuneHint: 'Ground is 127.425 at Frederick.', q: 'What do you say?',
      opts: [
        { t: `Frederick Ground, ${CS_SAY}, at the AOPA ramp${atis}, request taxi for closed traffic.`, ok: true, intent: 'pattern', why: 'Who you are, where you are, that you have the ATIS, and what you want.' },
        { t: `Frederick Ground, ${CS_SAY}, at the AOPA ramp${atis}, VFR departure to the east, request taxi.`, ok: true, intent: 'east', why: 'Who you are, where you are, that you have the ATIS, and what you want.' },
        { t: `Frederick Tower, ${CS_NM}, ready to taxi.`, ok: false, why: 'You\'re on the Ground frequency, so address Ground. Tower handles the runways and the air.', miss: 'called the wrong facility' },
        { t: `Frederick Ground, ${CS_NM}, request taxi to the active.`, ok: false, why: 'Ground needs your position and your intentions, and that you have the ATIS. “The active” isn\'t a clearance anyone can give.', miss: 'incomplete request' },
      ],
      reply: o => { if (!OPS.heardAtis) return `${CS_NM}, Frederick Ground, information ${A.L} is current. ${routeOut(R).say}.`; return `${CS_NM}, Frederick Ground, ${routeOut(R).say}.`; },
      replyWho: 'GND', score: 'Good call to Ground',
      onOk: o => {
        if (!OPS.heardAtis) addScore(-25, 'Called Ground without the ATIS');
        OPS.intent = o.intent; const rt = routeOut(R), core = rt.say.replace(/^runway/, 'Runway');
        readback('Frederick Ground', `Read back the taxi clearance`, `${core}, ${CS_NM}.`,
          [[`Taxi via Echo, ${CS_NM}.`, 'Always read back the runway you\'re taxiing to, and any hold-short or crossing instruction.', 'readback missed the runway'],
           [`Roger, ${CS_NM}.`, '“Roger” isn\'t a readback. Ground needs to hear the runway and route back.', '“Roger” is not a readback'],
           ...(rt.cross ? [[`${rwSay(R).replace(/^r/, 'R')}, taxi via Echo and Alpha, ${CS_NM}.`, 'You must read back every runway crossing clearance. Since 2023 a taxi clearance no longer implies you may cross runways.', 'readback missed the crossing']] : [])],
          () => { OPS.route = rt; startTaxi(rt.pts, 'runup', 'taxi'); });
      } });
    return;
  }
  if (op === 'runup') { OPS.phase = 'ready'; return opsCard(); }
  if (op === 'tower') {
    const want = OPS.intent === 'east' ? 'departing to the east' : 'closed traffic', dep = OPS.intent === 'east' ? `, ${depTurn()} turn on course approved` : `, make ${Rw.side} closed traffic`;
    openCall({ who: 'Frederick Tower', freq: FDK_FREQ.twr, kicker: 'READY FOR DEPARTURE', tuneHint: 'Tower is 132.4 at Frederick.', q: 'What do you say?',
      opts: [
        { t: `Frederick Tower, ${CS_SAY}, holding short ${rwSay(R)}, ready for departure, ${want}.`, ok: true, why: 'Runway, ready, and what you plan to do after takeoff.' },
        { t: `Frederick Tower, ${CS_NM}, ready to go.`, ok: false, why: 'Say which runway you\'re holding short of. At a field with more than one runway, Tower needs to know where you are.', miss: 'didn\'t say the runway' },
        { t: `Frederick Ground, ${CS_NM}, holding short ${rwSay(R)}, ready.`, ok: false, why: 'You\'re talking to Tower now. Ground\'s job ends at the hold-short line.', miss: 'addressed Ground on the Tower frequency' },
      ],
      reply: `${CS_NM}, Frederick Tower, ${windSay()}, ${rwSay(R)}, cleared for takeoff${dep}.`, replyWho: 'TWR', score: 'Good call to Tower',
      onOk: () => readback('Frederick Tower', 'Read back the takeoff clearance', `Cleared for takeoff ${rwSay(R)}${dep}, ${CS_NM}.`,
        [[`Cleared for takeoff, ${CS_NM}.`, 'Read back the runway with every takeoff clearance. It\'s your last chance to catch a wrong-runway departure.', 'readback missed the runway'],
         [`Roger, rolling, ${CS_NM}.`, 'Read back the clearance itself: “cleared for takeoff runway …”.', '“Roger” is not a readback']],
        () => { OPS.phase = 'lineup'; startPath(OPS.route.lineup, 'lineup'); opsCard(); }) });
    return;
  }
  if (op === 'midfield') {
    openCall({ who: 'Frederick Tower', kicker: 'MIDFIELD DOWNWIND', q: 'What do you say?',
      opts: [{ t: `Frederick Tower, ${CS_NM}, midfield ${Rw.side} downwind ${rwSay(R)}.`, ok: true, why: 'Where you are in the pattern, and which runway.' },
        { t: `Frederick Tower, ${CS_NM}, in the pattern.`, ok: false, why: 'Be specific: which leg, and which runway.', miss: 'position too vague' }],
      reply: `${CS_NM}, ${rwSay(R)}, cleared to land.`, replyWho: 'TWR',
      onOk: () => { OPS.reported = true; landingReadback(); } });
    return;
  }
  if (op === 'groundIn') {
    openCall({ who: 'Frederick Ground', freq: FDK_FREQ.gnd, kicker: 'TAXI IN', tuneHint: 'Ground is 127.425 at Frederick.', q: 'What do you say?',
      opts: [{ t: `Frederick Ground, ${CS_NM}, clear of ${rwSay(R)}, taxi to the AOPA ramp.`, ok: true, why: 'Where you are, and where you want to go.' },
        { t: `Frederick Ground, ${CS_NM}, on the ground.`, ok: false, why: 'Tell Ground where you are and where you want to go.', miss: 'incomplete request' }],
      reply: `${CS_NM}, Frederick Ground, taxi to the AOPA ramp via Echo.`, replyWho: 'GND',
      onOk: () => startTaxi(routeIn(OPS.exitS), 'parked', 'taxiIn') });
    return;
  }
  if (op === 'inbound') {
    const atis = OPS.heardAtis ? ` with information ${A.L}` : '';
    openCall({ who: 'Frederick Tower', freq: FDK_FREQ.twr, kicker: 'INBOUND', tuneHint: 'Tower is 132.4 at Frederick.', q: 'What do you say?',
      opts: [{ t: `Frederick Tower, ${CS_SAY}, ${posn(AP.FDK.x, AP.FDK.y)}${atis}, inbound for landing.`, ok: true, why: 'Who, where (distance, direction and altitude), the ATIS, and what you want.' },
        { t: `Frederick Tower, ${CS_NM}, landing Frederick.`, ok: false, why: 'Tower needs your position and altitude to sequence you, and the ATIS code.', miss: 'no position report' }],
      reply: () => `${CS_NM}, Frederick Tower, ${OPS.heardAtis ? '' : `information ${A.L} is current, `}enter ${Rw.side} downwind ${rwSay(R)}, report midfield.`, replyWho: 'TWR',
      onOk: () => { if (!OPS.heardAtis) addScore(-25, 'Called Tower without the ATIS'); game.contact['D:FDK'] = true; OPS.canJoin = false;
        readback('Frederick Tower', 'Read back the pattern entry', `Enter ${Rw.side} downwind ${rwSay(R)}, report midfield, ${CS_NM}.`,
          [[`Enter downwind, ${CS_NM}.`, 'Read back the runway and which side the downwind is on.', 'readback missed the runway'],
           [`Wilco, ${CS_NM}.`, '“Wilco” acknowledges, but read back pattern entries so Tower knows you have it right.', 'no readback']],
          () => joinPattern()); } });
    return;
  }
  if (op === 'shutdown') { OPS.phase = 'done'; OPS.auto = false; opsCard(); game.over = true; addScore(200, 'Full stop and back on the AOPA ramp'); if (game.viol === 0) addScore(100, 'No airspace violations'); game.endTitle = 'Back on the AOPA ramp'; game.grades = [520, 450, 350, 200]; setTimeout(showEnd, 600); }
}
function landingReadback() {
  readback('Frederick Tower', 'Read back the landing clearance', `Cleared to land ${rwSay(OPS.rw)}, ${CS_NM}.`,
    [[`Cleared to land, ${CS_NM}.`, 'Read back the runway with every landing clearance.', 'readback missed the runway']], () => { OPS.cleared.land = true; opsCard(); });
}

// ---- movement -------------------------------------------------------------------------------------
function startPath(ptsFt, next) { OPS.path = fpts(ptsFt); OPS.pathI = 0; OPS.next = next; OPS.routeVer++; }
function startTaxi(ptsFt, next, phase) { OPS.phase = phase; startPath(ptsFt, next); opsZoom('ground'); opsCard(); }
function steer(target, maxRate, dt) { const want = brg(pl.x, pl.y, target[0], target[1]), e = angDiff(want, pl.hdg), r = clamp(e * 2, -maxRate, maxRate); pl.rate = r; pl.hdg = norm(pl.hdg + r * dt); pl.bug = pl.hdg; return Math.abs(e); }
function move(spdKt, dt) { const d = spdKt / 3600 * dt; pl.x += Math.sin(pl.hdg * D2R) * d; pl.y -= Math.cos(pl.hdg * D2R) * d; }
function followPath(dt, kt) {   // returns true at the end of the path
  const p = OPS.path[OPS.pathI]; if (!p) return true;
  const dist = Math.hypot(p[0] - pl.x, p[1] - pl.y), e = steer(p, 40, dt);
  OPS.spd = Math.min(kt, e > 45 ? 6 : kt, dist / FT_NM < 60 ? 6 : kt); move(OPS.spd, dt);
  if (dist < 25 * FT_NM) { OPS.pathI++; if (OPS.pathI >= OPS.path.length) { OPS.spd = 0; return true; } }
  return false;
}
// Traffic pattern legs for runway id: positions in nm, each leg has a target point and how to fly it.
function patternLegs(id, join) {
  const R = FIELD.RW[id], T = R.thr, [ux, uy] = R.u, sgn = R.side === 'left' ? -1 : 1, sx = -uy * sgn, sy = ux * sgn, D = .75, Lr = FIELD.len;
  const at = (a, s) => [T[0] + ux * a + sx * s, T[1] + uy * a + sy * s];
  const legs = [];
  if (!join) legs.push({ n: 'upwind', label: 'Upwind: climbing out', p: at(Lr + .6, 0), spd: 75 }, { n: 'crosswind', label: 'Crosswind', p: at(Lr + .6, D), spd: 80 });
  else { const m = at(Lr / 2, D), k = 1.6 / Math.SQRT2; legs.push({ n: 'entry', label: 'Joining: heading for the 45° entry', p: [m[0] + (ux + sx) * k, m[1] + (uy + sy) * k], spd: 95 }, { n: 'entry45', label: '45° entry to downwind', p: m, spd: 90 }); }
  legs.push({ n: 'downwind', label: 'Downwind', p: at(-D, D), spd: 90 }, { n: 'base', label: 'Base', p: at(-D, 0), spd: 72 }, { n: 'final', label: 'Final', p: T, spd: 65 });
  return legs;
}
function joinPattern() { OPS.phase = 'pattern'; OPS.auto = true; OPS.legs = patternLegs(OPS.rw, true); OPS.legI = 0; OPS.reportMid = true; OPS.reported = false; OPS.cleared = {}; OPS.routeVer++; opsZoom('pattern'); opsCard(); }
const alongRw = id => { const R = FIELD.RW[id]; return (pl.x - R.thr[0]) * R.u[0] + (pl.y - R.thr[1]) * R.u[1]; };   // nm past the threshold, along the landing direction
function opsStep(dt) {
  const R = OPS.rw && FIELD.RW[OPS.rw], E = FIELD.elev, climb = (target, fpm) => { const d = target - pl.alt, r = fpm / 60; pl.vs = Math.abs(d) < 2 ? 0 : Math.sign(d) * Math.abs(fpm); pl.alt += clamp(d, -r * dt, r * dt); };
  pl.vs = 0;
  switch (OPS.phase) {
    case 'ramp': case 'runup': case 'ready': case 'exit': case 'parked': OPS.spd = 0; pl.rate = 0; break;
    case 'taxi': case 'taxiIn': if (followPath(dt, 14)) { OPS.phase = OPS.next; if (OPS.next === 'parked') pl.hdg = pl.bug = norm(FIELD.h - 90); opsCard(); } break;
    case 'lineup': if (followPath(dt, 8)) { const e = angDiff(R.hdg, pl.hdg); pl.hdg = norm(pl.hdg + clamp(e, -25 * dt, 25 * dt)); pl.bug = pl.hdg; if (Math.abs(e) < 1) { OPS.phase = 'roll'; OPS.spd = 0; opsCard(); } } break;
    case 'roll': {
      pl.hdg = pl.bug = R.hdg; OPS.spd = Math.min(75, OPS.spd + (OPS.spd < 55 ? 4.5 : 2) * dt); move(OPS.spd, dt);
      if (OPS.spd >= 55) { OPS.onGround = false; climb(FIELD.tpa, 700); pl.patt = 8; }
      if (pl.alt > E + 150) {
        if (OPS.intent === 'east') { OPS.phase = 'depart'; opsZoom('pattern'); }
        else { OPS.phase = 'pattern'; OPS.legs = patternLegs(OPS.rw, false); OPS.legI = 0; OPS.reportMid = false; OPS.cleared = {}; OPS.routeVer++; opsZoom('pattern'); }
        opsCard();
      } break; }
    case 'depart': {   // climb out on runway heading to 700 AGL past the departure end, then hand over on course
      OPS.spd = 75; pl.hdg = pl.bug = R.hdg; move(OPS.spd, dt); climb(FIELD.tpa + 1200, 700);
      if (pl.alt >= E + 700 && alongRw(OPS.rw) > FIELD.len) { OPS.phase = 'free'; OPS.auto = false; OPS.onGround = false; pl.bug = depCourse(); pl.tgt = 2500; opsZoom('enroute'); opsCard();
        flash(`On course ${hdg3(depCourse() + VAR)}°: climb to 2,500. You have the airplane.`, '#9fe0ff', 3.2); }
      break; }
    case 'pattern': {
      const L = OPS.legs[OPS.legI], a = alongRw(OPS.rw), agl = pl.alt - E;
      if (L.n === 'upwind') { pl.hdg = pl.bug = R.hdg; OPS.spd = 75; move(OPS.spd, dt); climb(FIELD.tpa, 700); if (a > FIELD.len + .35 && agl > 650) nextLeg(); break; }
      OPS.spd += clamp(L.spd - OPS.spd, -3 * dt, 3 * dt);
      const e = steer(L.p, 3, dt); move(OPS.spd, dt);
      const dist = Math.hypot(L.p[0] - pl.x, L.p[1] - pl.y), rTurn = OPS.spd / (60 * Math.PI) * .9;
      if (L.n === 'final') {
        const gp = E + 50 + Math.max(0, -a) * 318;   // 3° glidepath to 50 ft over the threshold
        climb(Math.min(gp, pl.alt), Math.max(300, Math.min(900, (pl.alt - gp) * 4 + 450)));
        if (a > -.02) {
          if (!OPS.cleared.land) { addScore(-200, 'Landed without a landing clearance'); OPS.cleared.land = true; }
          OPS.phase = 'flare'; opsCard();
        }
      } else if (L.n === 'downwind' || L.n === 'entry45' || L.n === 'entry') {
        climb(L.n === 'downwind' && a < .05 ? FIELD.tpa - 300 : FIELD.tpa, 500);   // abeam the threshold: power back, start down
        if (L.n === 'downwind' && !OPS.cleared.land && !OPS.reportMid && a < FIELD.len * .55) {   // closed traffic: Tower clears you on downwind
          OPS.cleared.asked = true; OPS.reportMid = true; OPS.reported = true; radioMsg('TWR', `${CS_NM}, ${rwSay(OPS.rw)}, cleared to land.`); landingReadback();
        }
      } else climb(L.n === 'base' ? E + 450 : FIELD.tpa, 500);
      if (L.n === 'downwind' && OPS.reportMid && !OPS.reported && a < FIELD.len * .3) { OPS.reported = true; addScore(-25, 'Forgot to report midfield downwind'); }
      if (L.n !== 'final' && (dist < rTurn || (L.n === 'downwind' && a < -.75))) nextLeg();
      if (L.n === 'base' && Math.abs(angDiff(R.hdg, pl.hdg)) < 35 && Math.abs((pl.x - R.thr[0]) * -R.u[1] + (pl.y - R.thr[1]) * R.u[0]) < .25) nextLeg();
      break; }
    case 'flare': { const e = angDiff(R.hdg, pl.hdg); pl.hdg = pl.bug = norm(pl.hdg + clamp(e, -6 * dt, 6 * dt)); OPS.spd = Math.max(55, OPS.spd - 2 * dt); move(OPS.spd, dt); climb(E, 240);
      if (pl.alt <= E + .5) { pl.alt = E; OPS.onGround = true; OPS.phase = 'rollout'; opsZoom('ground'); opsCard(); landingScore(); } break; }
    case 'rollout': {
      pl.hdg = pl.bug = R.hdg; OPS.spd = Math.max(12, OPS.spd - 5 * dt); move(OPS.spd, dt);
      if (OPS.spd <= 12.5 && !OPS.exitS) {   // first Echo-side taxiway ahead of us
        const sNow = (pl.x - FIELD.F(0, 0)[0]) / FT_NM * Math.sin(FIELD.h * D2R) - (pl.y - FIELD.F(0, 0)[1]) / FT_NM * Math.cos(FIELD.h * D2R);
        const ahead = [-650, 0, 1200, 2870].filter(s => (s - sNow) * R.dir > 150).sort((p, q) => (p - q) * R.dir);
        OPS.exitS = ahead[0] ?? (R.dir > 0 ? 2870 : -650);
        const side = angDiff(brg(...FIELD.F(OPS.exitS, 0), ...FIELD.F(OPS.exitS, 400)), R.hdg) > 0 ? 'right' : 'left';
        radioMsg('TWR', `${CS_NM}, turn ${side} next taxiway, contact Ground point four two five.`);
        startPath([[OPS.exitS, 0], [OPS.exitS, 230]], 'exit'); OPS.phase = 'exitRoll';
      } break; }
    case 'exitRoll': if (followPath(dt, 12)) { OPS.phase = 'exit'; opsCard(); } break;
  }
  if (OPS.auto) pl.tgt = Math.round(pl.alt);   // the altitude readout shows what the plane is doing, not a stale en-route target
}
function nextLeg() { OPS.legI = Math.min(OPS.legI + 1, OPS.legs.length - 1); OPS.routeVer++; opsCard(); }
function landingScore() {
  const w = windAt(AP.FDK.x, AP.FDK.y), R = FIELD.RW[OPS.rw], hw = w.spd * Math.cos((w.dir - R.hdg) * D2R);
  if (hw < -3) addScore(-75, `Downwind landing (${Math.round(-hw)} kt tailwind)`); else addScore(100, `Landed ${rwSay(OPS.rw)}`);
}
// free flight near Frederick: offer the Tower call before the Delta
function opsFreeTick() {
  const near = d2(AP.FDK) < 9 && d2(AP.FDK) > 4.6 && !game.contact['D:FDK'] && pl.alt < FIELD.elev + 3200;
  if (near !== !!OPS.canJoin) { OPS.canJoin = near; if (near) { OPS.rw = runwayForWind(); } opsCard(); }
  if (game.contact['D:FDK'] && d2(AP.FDK) > 5 && OPS.intent === 'east' && !OPS.freqChange) { OPS.freqChange = true; game.contact['D:FDK'] = false; radioMsg('TWR', `${CS_NM}, frequency change approved.`); }
}
function opsZoom(kind) { if (typeof setOpsZoom === 'function') setOpsZoom(kind); }
function setOpsZoom(kind) { cam.s = { ground: 1300, pattern: 110, enroute: clamp(Math.min(W, H) / 18, 14, 40) }[kind]; }

// ---- drawing (canvas build); the 3D build draws the same geometry as MapLibre layers -------------
function fieldGeo() {
  const poly = (s1, t1, s2, t2) => { const r = fpts([[s1, t1], [s2, t1], [s2, t2], [s1, t2], [s1, t1]]); return r; };
  return { aprons: FIELD.APRON.map(a => ({ ring: poly(...a.slice(0, 4)), name: a[4] })), twys: FIELD.TW.map(w => ({ line: fpts(w.p), n: w.n })),
    blds: FIELD.BLD.map(b => ({ ring: poly(...b.slice(0, 4)), h: b[4], c: b[5], name: b[6] })),
    holds: FIELD.HOLD.map(([s, t]) => fpts([[s - 30, t], [s + 30, t]])), park: FIELD.F(...FIELD.park) };
}
const FGEO = fieldGeo();
function opsRoute() {   // what's left of the route to show: taxi path, or the pattern ahead of you
  if (OPS.phase === 'taxi' || OPS.phase === 'taxiIn' || OPS.phase === 'lineup' || OPS.phase === 'exitRoll') return OPS.path ? [[pl.x, pl.y], ...OPS.path.slice(OPS.pathI)] : null;
  if (OPS.phase === 'pattern') return [[pl.x, pl.y], ...OPS.legs.slice(OPS.legI).map(l => l.p)];
  return null;
}
function drawField() {
  if (cam.s < 60 || d2(AP.FDK) > 6) return;
  const k = cam.s * FT_NM, path = r => { ctx.beginPath(); r.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](...P(p[0], p[1]))); };
  ctx.fillStyle = 'rgba(120,122,126,.92)'; for (const a of FGEO.aprons) { path(a.ring); ctx.fill(); }
  ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(120,122,126,.95)'; ctx.lineWidth = Math.max(2, 50 * k); for (const w of FGEO.twys) { path(w.line); ctx.stroke(); }
  if (k > .15) { ctx.strokeStyle = '#f2c230'; ctx.lineWidth = Math.max(1, 1.5 * k * 2); for (const w of FGEO.twys) { path(w.line); ctx.stroke(); }
    ctx.lineWidth = Math.max(1.5, 4 * k); for (const h of FGEO.holds) { path(h); ctx.stroke(); } }
  for (const b of FGEO.blds) { ctx.fillStyle = b.c; path(b.ring); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke(); }
  if (k > .1) { const [px, py] = P(...FGEO.park); ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 2; ctx.strokeRect(px - 26 * k, py - 26 * k, 52 * k, 52 * k); label('P', px, py + 4, '#f2c230', Math.max(9, 24 * k), '900'); }
  const rt = opsRoute(); if (rt) { ctx.strokeStyle = 'rgba(214,52,170,.85)'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); path(rt); ctx.stroke(); ctx.setLineDash([]); }
}
