/* Live traffic: real ADS-B aircraft from adsb.lol (data ODbL 1.0, © adsb.lol contributors), drawn on the MapLibre map.
 *
 * Self-contained apart from two hooks in map_layer.js: initTraffic(map) once the style has loaded, and
 * trafficTick(now) from the render loop. Polls every 5 s around the map's centre (40 NM), then dead-reckons
 * each aircraft between polls so it moves smoothly instead of jumping.
 *
 *   2D:  'flights-layer' symbols, rotated by ground track, with callsign and altitude under each one.
 *   3D:  the same symbols become ground shadows, and 'flights-3d' puts a marker at the aircraft's real
 *        altitude (same vertical scale as the airspace slabs) with a drop line down to its label.
 *
 * adsb.lol doesn't send CORS headers, so a browser page can't read it directly. Point TRAFFIC.base at a relay
 * that adds them (tools/traffic_relay.js), or pass ?tfc=https://your-relay.example once; it is remembered.
 */
const TRAFFIC = { base: 'https://api.adsb.lol', nm: 40, every: 5000, on: true, ac: [], at: 0, status: 'starting', fails: 0, next: 0, busy: false };
try {
  const q = new URLSearchParams(location.search).get('tfc'); if (q) localStorage.setItem('sr.tfcbase', q.replace(/\/+$/, ''));
  TRAFFIC.base = localStorage.getItem('sr.tfcbase') || TRAFFIC.base; TRAFFIC.on = localStorage.getItem('sr.tfc') !== '0';
} catch (_) {}
const TFC_ATTR = 'Traffic: <a href="https://adsb.lol" target="_blank">adsb.lol</a> (ODbL)';

function trafficIcon(map) {   // a small airliner silhouette, drawn on a canvas as an SDF so the layer can tint it
  const S = 48, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  g.translate(S / 2, S / 2); g.fillStyle = '#fff'; g.beginPath();
  for (const [x, y] of [[0, -21], [3, -17], [3, -5], [20, 4], [20, 8], [3, 3], [2.5, 14], [8, 18], [8, 21], [0, 19], [-8, 21], [-8, 18], [-2.5, 14], [-3, 3], [-20, 8], [-20, 4], [-3, -5], [-3, -17]]) g.lineTo(x, y);
  g.closePath(); g.fill();
  map.addImage('airplane-icon', { width: S, height: S, data: new Uint8Array(g.getImageData(0, 0, S, S).data.buffer) }, { sdf: true, pixelRatio: 2 });
}

function initTraffic(map) {
  trafficIcon(map);
  map.addSource('live-flights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: TFC_ATTR });
  map.addSource('live-flights-3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const col = ['case', ['==', ['get', 'near'], 1], '#ffb000', '#00a6c8'];   // amber when within 3 NM and 1,000 ft of you
  map.addLayer({ id: 'flights-3d', type: 'fill-extrusion', source: 'live-flights-3d',
    paint: { 'fill-extrusion-color': col, 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': .9 } }, 'x-d');
  map.addLayer({ id: 'flights-layer', type: 'symbol', source: 'live-flights',
    layout: { 'icon-image': 'airplane-icon', 'icon-size': ['interpolate', ['linear'], ['zoom'], 7, .55, 12, 1], 'icon-rotate': ['get', 'trk'], 'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'text-field': ['concat', ['get', 'cs'], '\n', ['get', 'altTxt']], 'text-font': ['Noto Sans Bold'], 'text-size': 10.5, 'text-line-height': 1.1,
      'text-anchor': 'top', 'text-offset': [0, 1.1], 'text-optional': true },
    paint: { 'icon-color': col, 'icon-halo-color': '#fff', 'icon-halo-width': 1.2, 'icon-opacity': ['case', ['==', ['get', 'gnd3d'], 1], .45, 1],
      'text-color': ['case', ['==', ['get', 'near'], 1], '#9a5a00', '#05617a'], 'text-halo-color': '#fff', 'text-halo-width': 1.6 } });
  map.setLayoutProperty('flights-layer', 'visibility', TRAFFIC.on ? 'visible' : 'none');
  map.setLayoutProperty('flights-3d', 'visibility', TRAFFIC.on ? 'visible' : 'none');
  fetchTraffic(map);
}

function setTraffic(on) {
  TRAFFIC.on = on; try { localStorage.setItem('sr.tfc', on ? '1' : '0'); } catch (_) {}
  if (!map) return; for (const id of ['flights-layer', 'flights-3d']) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  if (on) { TRAFFIC.next = 0; TRAFFIC.status = 'connecting'; }
}

// adsb.lol aircraft (readsb v2 format) to the fields we use. Missing callsign → registration → hex; 'ground' → 0 ft.
function parseAircraft(a, t) {
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return null;
  const gnd = a.alt_baro === 'ground', alt = gnd ? 0 : typeof a.alt_baro === 'number' ? a.alt_baro : typeof a.alt_geom === 'number' ? a.alt_geom : null;
  return { id: a.hex, cs: (a.flight || '').trim() || a.r || (a.hex || '???').toUpperCase(), lat: a.lat, lon: a.lon, trk: typeof a.track === 'number' ? a.track : a.true_heading || 0,
    gs: a.gs || 0, alt, vs: typeof a.baro_rate === 'number' ? a.baro_rate : 0, gnd, t: t - (a.seen_pos || 0) * 1000 };
}

async function fetchTraffic(map) {
  if (TRAFFIC.busy) return; TRAFFIC.busy = true;
  const c = map.getCenter(), url = `${TRAFFIC.base}/v2/lat/${c.lat.toFixed(3)}/lon/${c.lng.toFixed(3)}/dist/${TRAFFIC.nm}`, ab = new AbortController(), to = setTimeout(() => ab.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ab.signal }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json(), now = performance.now();
    TRAFFIC.ac = (data.ac || []).map(a => parseAircraft(a, now)).filter(Boolean); TRAFFIC.at = now;
    TRAFFIC.fails = 0; TRAFFIC.status = `${TRAFFIC.ac.length} aircraft`;
  } catch (e) {
    TRAFFIC.fails++; TRAFFIC.status = TRAFFIC.fails > 2 ? 'unavailable' : 'retrying';
    if (TRAFFIC.fails === 3) console.warn('Live traffic unavailable from', TRAFFIC.base, '(adsb.lol needs a CORS relay: see src/live_traffic.js).', e.message);
  } finally {
    clearTimeout(to); TRAFFIC.busy = false;
    TRAFFIC.next = performance.now() + (TRAFFIC.fails > 2 ? 60000 : TRAFFIC.every);   // back off to once a minute after 3 failures
  }
}

// 4×/second: poll when due, dead-reckon every aircraft from its last report, and rebuild both sources.
let tfcT = 0;
function trafficTick(now) {
  if (!TRAFFIC.on || !map || now - tfcT < 250) return; tfcT = now;
  if (now >= TRAFFIC.next && !document.hidden) fetchTraffic(map);
  const z = map.getZoom(), three = viewMode !== 0, span = clamp(26 * Math.pow(2, 16.1 - z), 40, 6000), sym = [], vol = [];
  for (const a of TRAFFIC.ac) {
    const dt = Math.min(15, (now - a.t) / 1000), d = a.gs * dt / 3600 * 1852;   // metres flown since the report, capped at 15 s
    const [lon, lat] = metersLL(a.lon, a.lat, Math.sin(a.trk * D2R) * d, -Math.cos(a.trk * D2R) * d), alt = a.alt == null ? null : Math.max(0, a.alt + a.vs * dt / 60);
    const [x, y] = fromLL(lon, lat), near = alt != null && Math.hypot(x - pl.x, y - pl.y) < 3 && Math.abs(alt - pl.alt) < 1000 ? 1 : 0;
    const altTxt = a.gnd ? 'GND' : alt == null ? '--- ft' : Math.round(alt / 100) * 100 >= 18000 ? 'FL' + String(Math.round(alt / 100)).padStart(3, '0') : Math.round(alt / 100) * 100 + ' ft';
    sym.push({ type: 'Feature', properties: { cs: a.cs, altTxt, trk: a.trk, near, gnd3d: three && !a.gnd ? 1 : 0 }, geometry: { type: 'Point', coordinates: [lon, lat] } });
    if (!three || a.gnd || alt == null) continue;
    const gnd = map.getTerrain() ? elev(x, y) : 0, h = Math.max(30, (Math.min(alt, CAP + 2000) - gnd) * FT * EX), c = Math.cos(a.trk * D2R), s = Math.sin(a.trk * D2R);
    const ring = pts => { const r = pts.map(([px, py]) => metersLL(lon, lat, (px * c - py * s) * span, (px * s + py * c) * span)); r.push(r[0]); return [r]; };
    vol.push({ type: 'Feature', properties: { near, b: h, h: h + span * .1 }, geometry: { type: 'Polygon', coordinates: ring([[0, -.5], [.35, .35], [0, .18], [-.35, .35]]) } });   // arrowhead, nose along track
    vol.push({ type: 'Feature', properties: { near, b: 0, h }, geometry: { type: 'Polygon', coordinates: ring([[-.02, -.02], [.02, -.02], [.02, .02], [-.02, .02]]) } });           // drop line to the label
  }
  map.getSource('live-flights').setData({ type: 'FeatureCollection', features: sym });
  map.getSource('live-flights-3d').setData({ type: 'FeatureCollection', features: vol });
}
