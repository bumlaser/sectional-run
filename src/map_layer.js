// MapLibre renderer for Sectional Run: replaces the canvas map with OpenFreeMap vector tiles,
// FAA airspace as extruded volumes, and a follow camera that can rotate and pitch.
// The game logic (rules, quizzes, radio, HUD) is unchanged and still works in nm coordinates.
'use strict';
const EX = 2;                 // vertical exaggeration so the slabs read at map scale
const FT = .3048, CAP = 12500;
const toLL = (x, y) => [WD.reg.clon + x / (60 * WD.reg.cos), WD.reg.clat - y / 60];
const fromLL = (lon, lat) => [(lon - WD.reg.clon) * 60 * WD.reg.cos, -(lat - WD.reg.clat) * 60];
const MODES = [{ name: '2D', pitch: 0 }, { name: 'CHASE', pitch: 62 }, { name: 'ORBIT', pitch: 55 }];
let map = null, mapReady = false, viewMode = 1, terrainOn = true, planeT = 0;
try { terrainOn = localStorage.getItem('sr.terrain') !== '0'; } catch (_) {}
function setTerrainOn(on) { terrainOn = on; try { localStorage.setItem('sr.terrain', on ? '1' : '0'); } catch (_) {} if (map) { applyMode(); planeT = 0; } }
const KCOL = { B: '#1d5fae', D: '#1d5fae', R: '#1d5fae', P: '#1d5fae', SFRA: '#1d5fae', FRZ: '#c9a21a', MOA: '#a8327f', W: '#a8327f', A: '#a8327f', E2: '#a8327f', E5: '#a8327f', MODEC: '#a8327f' };
const fc = feats => ({ type: 'FeatureCollection', features: feats });
const ringLL = r => { const c = r.map(([x, y]) => toLL(x, y)); c.push(c[0]); return c; };
// with terrain on, extrusions are measured from the ground, so subtract the mean ground under each volume to stay MSL-true
const meanGround = v => { let s = 0, n = 0; for (const r of v.r) for (const [x, y] of r) { s += elev(x, y); n++; } s += elev(v.lp[0], v.lp[1]) * 4; return s / (n + 4); };
const volFeat = v => { const g = DEM ? meanGround(v) : 0, b = v.fl === 0 ? 0 : Math.max(0, v.fl - g), t = Math.max(b + 100, Math.min(v.ce, CAP) - g);
  return { type: 'Feature', properties: { k: v.k, n: v.n, fl: v.fl, ce: Math.min(v.ce, CAP), b, t, col: KCOL[v.k] || '#1d5fae' }, geometry: { type: 'Polygon', coordinates: v.r.map(ringLL) } }; };
const pt = (x, y, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: toLL(x, y) } });
const line = (pts, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: pts.map(([x, y]) => toLL(x, y)) } });
const metersLL = (lon, lat, dx, dy) => [lon + dx / (111320 * Math.cos(lat * D2R)), lat - dy / 110540];

function volLabel(v) {
  if (v.k === 'B') return `${label100(v.ce)}\n${label100(v.fl)}`;
  if (v.k === 'D') return `[${label100(v.ce)}]`;
  if (v.k === 'SFRA') return 'WASHINGTON DC SFRA\nSFC–FL180 (APPROX.)';
  if (v.k === 'FRZ') return 'DC FRZ (APPROX.)';
  if (v.k === 'R') return `${v.n}\n${v.fl ? fmt(v.fl) : 'SFC'}–${v.ce >= 60000 ? 'UNLTD' : fmt(v.ce)} ${SUA_STATUS[v.grp] ? 'HOT' : 'COLD'}`;
  if (v.k === 'P') return `${v.n}\nSFC–${fmt(v.ce)}`;
  if (v.k === 'MOA') return `${v.n}\n${fmt(v.fl)}–${fmt(v.ce)}`;
  return '';
}
function vorRose(vr) {
  const out = [], r = vr.r, c = [];
  for (let d = 0; d <= 360; d += 5) { const a = (d - VAR - 90) * D2R; c.push([vr.x + Math.cos(a) * r, vr.y + Math.sin(a) * r]); }
  out.push(line(c));
  for (let d = 0; d < 360; d += 10) { const a = (d - VAR - 90) * D2R, l = d % 30 === 0 ? .9 : .4;
    out.push(line([[vr.x + Math.cos(a) * r, vr.y + Math.sin(a) * r], [vr.x + Math.cos(a) * (r - l), vr.y + Math.sin(a) * (r - l)]])); }
  const a = (-VAR - 90) * D2R; out.push(line([[vr.x, vr.y], [vr.x + Math.cos(a) * (r + 1), vr.y + Math.sin(a) * (r + 1)]]));
  return out;
}
function sectionalTint(style) {
  // Positron, recoloured toward sectional-chart tones
  const set = (id, prop, v) => { const l = style.layers.find(l => l.id === id); if (l) { l.paint = l.paint || {}; l.paint[prop] = v; } };
  set('background', 'background-color', '#dde8c6');
  set('park', 'fill-color', '#cfe1b2');
  set('landcover_wood', 'fill-color', '#bdd6a0'); set('landcover_wood', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 6, .5, 12, 1]);
  set('landuse_residential', 'fill-color', '#f4df7c'); set('landuse_residential', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 6, .75, 12, .45]);
  set('water', 'fill-color', '#a6d1ee'); set('waterway', 'line-color', '#86bde3');
  set('building', 'fill-color', '#e2d6a6'); set('building', 'fill-outline-color', '#c9bc8a');
  for (const l of style.layers) {
    if (l.type === 'symbol' && l.paint) { l.paint['text-color'] = /water/.test(l.id) ? '#3d6f99' : '#38331f'; l.paint['text-halo-color'] = 'rgba(255,255,255,.85)'; }
    if (/^highway_(major|motorway)_inner|bridge_inner/.test(l.id) && l.paint) l.paint['line-color'] = '#fdfbf3';
    if (/casing/.test(l.id) && l.paint) l.paint['line-color'] = '#9d9580';
  }
  return style;
}
function addLayers() {
  const [w0, n0] = toLL(WORLD.x0, WORLD.y0), [e0, s0] = toLL(WORLD.x1, WORLD.y1);
  const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  const demSrc = extra => ({ type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 14, ...extra });
  map.addSource('dem', demSrc({ attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">AWS Terrain Tiles</a> (USGS 3DEP, SRTM, Mapzen)' }));
  map.addSource('dem-hs', demSrc({}));   // separate source for the hillshade, as MapLibre recommends
  const firstLine = map.getStyle().layers.find(l => l.type === 'line')?.id;
  map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem-hs', paint: { 'hillshade-exaggeration': .45, 'hillshade-shadow-color': '#5b6b45', 'hillshade-highlight-color': '#fffbe8', 'hillshade-accent-color': '#6d7f52' } }, firstLine);
  if (DEM) { const q = [], ql = [];
    for (const m of DEM.mef) { const [a, b] = [toNM(m.lat + .25, m.lon), toNM(m.lat, m.lon + .25)];
      q.push(line([[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]])); ql.push(pt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { t: String(m.mef / 100 | 0).replace(/^(\d)$/, '0$1') })); }
    map.addSource('mefq', { type: 'geojson', data: fc(q) }); map.addSource('mefl', { type: 'geojson', data: fc(ql) });
    map.addLayer({ id: 'mefq', type: 'line', source: 'mefq', paint: { 'line-color': '#1d5fae', 'line-opacity': .2, 'line-width': 1 } }, firstSymbol);
    map.addLayer({ id: 'mefl', type: 'symbol', source: 'mefl', layout: { 'text-field': ['concat', ['slice', ['get', 't'], 0, ['-', ['length', ['get', 't']], 1]], ' ', ['slice', ['get', 't'], ['-', ['length', ['get', 't']], 1]]], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 18, 11, 40], 'text-allow-overlap': true, 'text-pitch-alignment': 'map' },
      paint: { 'text-color': 'rgba(29,95,174,.42)' } }, firstSymbol); }
  // real chart: the FAA's own seamless tile services (whole US, current 56-day cycle). Sectional underneath, TACs over it
  // where they exist (transparent outside each TAC's neatline, 404 where there is none).
  const faa = n => `https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/${n}/MapServer/tile/{z}/{y}/{x}`, CH = 'Charts: FAA Aeronautical Information Services';
  map.addSource('sec', { type: 'raster', tiles: [faa('VFR_Sectional')], tileSize: 256, minzoom: 8, maxzoom: 12, attribution: CH });
  map.addSource('tac', { type: 'raster', tiles: [faa('VFR_Terminal')], tileSize: 256, minzoom: 10, maxzoom: 12 });
  for (const id of ['sec', 'tac']) map.addLayer({ id, type: 'raster', source: id, layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, firstSymbol);

  const ruled = VOL.filter(v => RULED.includes(v.k));
  map.addSource('vol', { type: 'geojson', data: fc(VOL.map(volFeat)) });
  map.addSource('vol3', { type: 'geojson', data: fc(ruled.map(volFeat)) });
  map.addSource('vlab', { type: 'geojson', data: fc(VOL.map(v => pt(v.lp[0], v.lp[1], { t: volLabel(v), col: KCOL[v.k], k: v.k })).filter(f => f.properties.t)) });
  map.addSource('route', { type: 'geojson', data: fc([line([[START.x, START.y], [DEST.x, DEST.y]])]) });
  map.addSource('aps', { type: 'geojson', data: fc(AIRPORTS.map(a => pt(a.x, a.y, { t: `${a.n.toUpperCase().replace(/\/.*$/, '')} (${a.id})\n${AP_FREQ[a.id] ? AP_FREQ[a.id] + (a.tw ? ' ★' : '') + ' · ' : a.tw ? 'CT ★ · ' : ''}${a.e}`, col: a.tw ? '#1d5fae' : '#a8327f', dest: a === DEST ? 1 : 0 }))) });
  map.addSource('obs', { type: 'geojson', data: fc(TOWERS.map(t => pt(t.x, t.y, { t: `${t.m}\n(${t.a})`, l: t.l }))) });
  map.addSource('obs3', { type: 'geojson', data: fc(TOWERS.map(t => { const [lon, lat] = toLL(t.x, t.y), s = 45;
    return { type: 'Feature', properties: { h: t.a * FT * EX }, geometry: { type: 'Polygon', coordinates: [[metersLL(lon, lat, -s, -s), metersLL(lon, lat, s, -s), metersLL(lon, lat, s, s), metersLL(lon, lat, -s, s), metersLL(lon, lat, -s, -s)]] } }; })) });
  map.addSource('nav', { type: 'geojson', data: fc([...VORS.flatMap(vorRose), ...CHECKPOINTS.map(([n, x, y]) => pt(x, y, { t: n, cp: 1 })), ...VORS.map(v => pt(v.x, v.y, { t: `${v.n} ${v.id}`, vor: 1 }))]) });
  // runways: true-scale outlines, plus a sectional-style layout drawn about 1 km around each airport for low zooms
  const rwFeats = [], rwSym = [];
  for (const a of AIRPORTS) {
    const rws = (a.rw || []).filter(r => !/^H/.test(r[6])); let ext = 1e-6;
    for (const r of rws) ext = Math.max(ext, Math.hypot(r[0] - a.x, r[1] - a.y), Math.hypot(r[2] - a.x, r[3] - a.y));
    const k = .5 / ext;   // layout radius 0.5 nm
    for (const r of rws) {
      const dx = r[2] - r[0], dy = r[3] - r[1], L = Math.hypot(dx, dy) || 1, hw = r[5] / 6076.1 / 2, nx = -dy / L * hw, ny = dx / L * hw;
      rwFeats.push({ type: 'Feature', properties: { d: r[6] }, geometry: { type: 'Polygon', coordinates: [ringLL([[r[0] + nx, r[1] + ny], [r[2] + nx, r[3] + ny], [r[2] - nx, r[3] - ny], [r[0] - nx, r[1] - ny]])] } });
      rwSym.push(line([[a.x + (r[0] - a.x) * k, a.y + (r[1] - a.y) * k], [a.x + (r[2] - a.x) * k, a.y + (r[3] - a.y) * k]], { col: a.tw ? '#1d5fae' : '#a8327f' }));
    }
  }
  map.addSource('rwy', { type: 'geojson', data: fc(rwFeats) });
  map.addSource('rwysym', { type: 'geojson', data: fc(rwSym) });
  map.addSource('plane', { type: 'geojson', data: fc([]) });
  map.addSource('planeFx', { type: 'geojson', data: fc([]) });

  // ground-level chart linework
  map.addLayer({ id: 'e5', type: 'line', source: 'vol', filter: ['==', ['get', 'k'], 'E5'], paint: { 'line-color': '#a8327f', 'line-opacity': .35, 'line-width': 9, 'line-blur': 7 } });
  map.addLayer({ id: 'frz-fill', type: 'fill', source: 'vol', filter: ['==', ['get', 'k'], 'FRZ'], paint: { 'fill-color': '#f5dd6a', 'fill-opacity': .22 } });
  map.addLayer({ id: 'sua-hatch', type: 'line', source: 'vol', filter: ['in', ['get', 'k'], ['literal', ['R', 'P', 'MOA', 'W', 'A', 'SFRA']]],
    paint: { 'line-color': ['get', 'col'], 'line-width': ['case', ['==', ['get', 'k'], 'SFRA'], 9, 7], 'line-dasharray': [.35, .8], 'line-opacity': .8 } });
  map.addLayer({ id: 'vol-line', type: 'line', source: 'vol', filter: ['in', ['get', 'k'], ['literal', ['B', 'R', 'P', 'MOA', 'W', 'A', 'SFRA', 'MODEC']]],
    paint: { 'line-color': ['get', 'col'], 'line-width': ['match', ['get', 'k'], 'B', 2.6, 'MODEC', 1.2, 'SFRA', 2.4, 1.6] } });
  map.addLayer({ id: 'vol-dash', type: 'line', source: 'vol', filter: ['in', ['get', 'k'], ['literal', ['D', 'E2', 'FRZ']]],
    paint: { 'line-color': ['get', 'col'], 'line-width': 2.2, 'line-dasharray': [3, 2] } });
  map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#a8327f', 'line-width': 3, 'line-opacity': .6, 'line-dasharray': [.5, 2] }, layout: { 'line-cap': 'round' } });
  map.addLayer({ id: 'nav-line', type: 'line', source: 'nav', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#1d5fae', 'line-width': 1.2 } });

  // 3D airspace, obstacles and plane
  map.addLayer({ id: 'obs3', type: 'fill-extrusion', source: 'obs3', minzoom: 8.5, paint: { 'fill-extrusion-color': '#1b2c4a', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': .9 } });
  map.addLayer({ id: 'plane-shadow', type: 'fill', source: 'planeFx', filter: ['in', ['get', 'p'], ['literal', ['shadow', 'ring']]], paint: { 'fill-color': ['case', ['==', ['get', 'p'], 'ring'], '#ff6a13', '#000'], 'fill-opacity': ['case', ['==', ['get', 'p'], 'ring'], .85, .28] } });
  map.addLayer({ id: 'plane-fx', type: 'fill-extrusion', source: 'planeFx', filter: ['!', ['in', ['get', 'p'], ['literal', ['shadow', 'ring']]]], paint: { 'fill-extrusion-color': ['get', 'col'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': .85 } });
  map.addLayer({ id: 'plane', type: 'fill-extrusion', source: 'plane', paint: { 'fill-extrusion-color': ['get', 'col'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 1 } });

  const ext = (id, kinds, opacity) => map.addLayer({ id, type: 'fill-extrusion', source: 'vol3', filter: ['in', ['get', 'k'], ['literal', kinds]],
    paint: { 'fill-extrusion-color': ['get', 'col'], 'fill-extrusion-base': ['*', ['get', 'b'], FT * EX], 'fill-extrusion-height': ['*', ['get', 't'], FT * EX], 'fill-extrusion-opacity': opacity } });
  // fill-extrusions share one depth buffer: draw small, inner volumes first so the big SFRA/MOA shells don't hide them
  ext('x-d', ['D'], .22); ext('x-sua', ['R', 'P'], .24); ext('x-b', ['B'], .24); ext('x-moa', ['MOA'], .1); ext('x-sfra', ['SFRA', 'FRZ'], .07);
  // symbols
  const font = ['Noto Sans Bold'];
  map.addLayer({ id: 'obs-pt', type: 'circle', source: 'obs', minzoom: 8, paint: { 'circle-radius': 3, 'circle-color': '#1b2c4a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
  map.addLayer({ id: 'obs-lab', type: 'symbol', source: 'obs', minzoom: 9.5, layout: { 'text-field': ['get', 't'], 'text-font': font, 'text-size': 11, 'text-anchor': 'left', 'text-offset': [.6, 0], 'text-allow-overlap': false },
    paint: { 'text-color': '#1b2c4a', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
  map.addLayer({ id: 'rwy', type: 'fill', source: 'rwy', minzoom: 11, paint: { 'fill-color': '#4b4c50', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 11.6, 1] } }, 'obs3');   // under the airport symbol and the plane
  const apR = ['interpolate', ['exponential', 2], ['zoom'], 7, 1.8, 10, 10, 12, 40];   // matches a 0.6 nm ground radius
  map.addLayer({ id: 'ap-pt', type: 'circle', source: 'aps', maxzoom: 11.6, paint: { 'circle-radius': apR, 'circle-color': 'rgba(255,255,255,.85)', 'circle-stroke-color': ['case', ['==', ['get', 'dest'], 1], '#ffcc33', ['get', 'col']], 'circle-stroke-width': ['case', ['==', ['get', 'dest'], 1], 4, 2.5], 'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map' } }, 'obs3');   // under the plane
  map.addLayer({ id: 'rwysym', type: 'line', source: 'rwysym', maxzoom: 11.6, paint: { 'line-color': ['get', 'col'], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 7, 1, 10, 3, 11.6, 5] } }, 'obs3');   // under the plane
  map.addLayer({ id: 'ap-lab', type: 'symbol', source: 'aps', layout: { 'text-field': ['get', 't'], 'text-font': font, 'text-size': 11, 'text-anchor': 'left', 'text-offset': [1, 0], 'text-justify': 'left' },
    paint: { 'text-color': ['get', 'col'], 'text-halo-color': '#fff', 'text-halo-width': 1.6 } });
  map.addLayer({ id: 'nav-lab', type: 'symbol', source: 'nav', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['get', 't'], 'text-font': font, 'text-size': 10.5, 'text-offset': [0, 1.1] },
    paint: { 'text-color': ['case', ['has', 'cp'], '#a8327f', '#1d5fae'], 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
  map.addLayer({ id: 'vlab', type: 'symbol', source: 'vlab', layout: { 'text-field': ['get', 't'], 'text-font': font, 'text-size': ['match', ['get', 'k'], 'B', 13, 'D', 13, 12], 'text-line-height': 1.05, 'text-allow-overlap': false },
    paint: { 'text-color': ['get', 'col'], 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.8 } });
  applyMode();
  if (!airOn) for (const id of AIR_LAYERS) map.setLayoutProperty(id, 'visibility', 'none');
}
const PLANE_SHAPE = [ // top view, metres for a 1-unit wingspan, nose toward -y
  [[0, -.5], [.07, -.42], [.08, -.12], [.5, -.1], [.5, .02], [.07, .04], [.04, .36], [.2, .38], [.2, .46], [-.2, .46], [-.2, .38], [-.04, .36], [-.07, .04], [-.5, .02], [-.5, -.1], [-.08, -.12], [-.07, -.42]]];
function planeGeom(lon, lat, span) {
  const c = Math.cos(pl.hdg * D2R), s = Math.sin(pl.hdg * D2R);
  return PLANE_SHAPE.map(r => { const ring = r.map(([x, y]) => metersLL(lon, lat, (x * c - y * s) * span, (x * s + y * c) * span)); ring.push(ring[0]); return ring; });
}
// Fill-extrusions on terrain are lifted by the rendered (exaggerated) terrain height at their centroid, so a shape at a
// fixed altitude needs that exact height taken off. Our own DEM grid differs from the rendered tiles and made the plane bob.
const terrainM = (lon, lat) => map.terrain ? map.terrain.getElevationForLngLatZoom(new maplibregl.LngLat(lon, lat), map.transform.tileZoom) : 0;
const altH = (lon, lat, altFt) => altFt * FT * EX - terrainM(lon, lat);
function updatePlane() {
  const [lon, lat] = toLL(pl.x, pl.y), z = map.getZoom(), span = clamp(36 * Math.pow(2, 16.1 - z) * (viewMode === 0 ? .5 : 1), 50, 9000), h = Math.max(30, altH(lon, lat, pl.alt));
  map.getSource('plane').setData(fc([{ type: 'Feature', properties: { col: '#ff6a13', b: h, h: h + span * .12 }, geometry: { type: 'Polygon', coordinates: planeGeom(lon, lat, span) } }]));
  const sq = span * .03, fx = [{ type: 'Feature', properties: { p: 'shadow' }, geometry: { type: 'Polygon', coordinates: planeGeom(lon, lat, span) } }];
  const ring = (rad) => Array.from({ length: 33 }, (_, i) => metersLL(lon, lat, Math.cos(i / 32 * 6.283) * rad, Math.sin(i / 32 * 6.283) * rad));
  fx.push({ type: 'Feature', properties: { p: 'ring' }, geometry: { type: 'Polygon', coordinates: [ring(span * .75), ring(span * .62).reverse()] } });
  if (viewMode !== 0) fx.push({ type: 'Feature', properties: { p: 'drop', col: '#ff6a13', b: 0, h: h }, geometry: { type: 'Polygon', coordinates: [[metersLL(lon, lat, -sq, -sq), metersLL(lon, lat, sq, -sq), metersLL(lon, lat, sq, sq), metersLL(lon, lat, -sq, sq), metersLL(lon, lat, -sq, -sq)]] } });
  const ahead = [pl.x + Math.sin(pl.hdg * D2R) * 4, pl.y - Math.cos(pl.hdg * D2R) * 4], [al, aa] = toLL(...ahead), steps = 12, w = span * .015;
  for (let i = 0; i < steps; i += 2) { const f0 = i / steps, f1 = (i + 1) / steps, la = lon + (al - lon) * f0, lb = lon + (al - lon) * f1, ta = lat + (aa - lat) * f0, tb = lat + (aa - lat) * f1;
    const nx = -Math.cos(pl.hdg * D2R) * w, ny = -Math.sin(pl.hdg * D2R) * w;
    const hs = Math.max(30, altH((la + lb) / 2, (ta + tb) / 2, pl.alt));
    fx.push({ type: 'Feature', properties: { p: 'hdg', col: '#22e04a', b: hs, h: hs + w * 2 }, geometry: { type: 'Polygon', coordinates: [[metersLL(la, ta, nx, ny), metersLL(lb, tb, nx, ny), metersLL(lb, tb, -nx, -ny), metersLL(la, ta, -nx, -ny), metersLL(la, ta, nx, ny)]] } }); }
  map.getSource('planeFx').setData(fc(fx));
}
function applyMode() {
  const three = viewMode !== 0;
  if (map.getSource('dem')) map.setTerrain(three && terrainOn ? { source: 'dem', exaggeration: EX } : null);
  for (const id of ['x-sfra', 'x-moa', 'x-b', 'x-sua', 'x-d', 'obs3']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', three && (id === 'obs3' || airOn) ? 'visible' : 'none');   // airspace slabs respect the airspace setting
  if (viewMode === 2) { CAM.bearing = map.getBearing(); CAM.pitchT = MODES[2].pitch; }
  document.getElementById('bView').textContent = MODES[viewMode].name;
}
// The follow camera owns the view: jumpTo() cancels MapLibre's own gestures, so wheel, pinch and drag are handled here
// and folded into the camera each frame.
const CAM = { zoomT: 10.3, zoom: 10.3, bearing: 112, pitchT: 62, pitch: 62, pan: 0 };
function updateCamera() {
  const k = .22, padTop = viewMode === 0 ? 0 : Math.round(H * .3);
  CAM.zoom += (CAM.zoomT - CAM.zoom) * k;
  const tb = viewMode === 1 ? pl.hdg : viewMode === 0 ? 0 : CAM.bearing, tp = viewMode === 0 ? 0 : viewMode === 1 ? MODES[1].pitch : CAM.pitchT;
  const cb = map.getBearing(), db = ((tb - cb + 540) % 360) - 180;
  map.jumpTo({ center: toLL(pl.x + cam.px, pl.y + cam.py), zoom: CAM.zoom, bearing: cb + db * (viewMode === 2 ? .5 : .25), pitch: map.getPitch() + (tp - map.getPitch()) * k,
    padding: { top: padTop, bottom: 0, left: 0, right: 0 } });
}
function wireGestures() {
  for (const h of ['scrollZoom', 'boxZoom', 'dragRotate', 'dragPan', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch']) map[h].disable();
  const el = map.getCanvasContainer(), pts = new Map(); let g = null;
  el.addEventListener('wheel', e => { e.preventDefault(); CAM.zoomT = clamp(CAM.zoomT - e.deltaY * (e.deltaMode ? .05 : .0022), 5.5, 15.5); }, { passive: false });
  const two = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  el.addEventListener('pointerdown', e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { el.setPointerCapture(e.pointerId); } catch (_) {}
    g = pts.size === 2 ? { ...two(), z: CAM.zoomT, b: CAM.bearing } : { x: e.clientX, y: e.clientY, btn: e.button, moved: false }; });
  el.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p || !g) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2 && g.d) { const t = two(); CAM.zoomT = clamp(g.z + Math.log2(t.d / g.d), 5.5, 15.5);
      if (viewMode === 2) { let da = t.a - g.a; if (da > 180) da -= 360; if (da < -180) da += 360; CAM.bearing = g.b - da; } return; }
    if (pts.size !== 1) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.moved = true; if (!g.moved) return;
    if (viewMode === 2 && !e.shiftKey && g.btn !== 1) { CAM.bearing += dx * .35; CAM.pitchT = clamp(CAM.pitchT - dy * .25, 0, 78); return; }
    // look around: move the view centre by the ground distance under the pointer
    const a = map.unproject([e.clientX - dx, e.clientY - dy]), b = map.unproject([e.clientX, e.clientY]), [ax, ay] = fromLL(a.lng, a.lat), [bx, by] = fromLL(b.lng, b.lat);
    cam.px -= bx - ax; cam.py -= by - ay; cam.lastPan = performance.now();
  });
  const up = e => { pts.delete(e.pointerId); g = pts.size === 1 ? { ...[...pts.values()][0], moved: true } : null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
// --- hook the game's view functions --------------------------------------------------------
P = function (x, y) { if (!map) return [0, 0]; const p = map.project(toLL(x, y)); return [p.x, p.y]; };
unP = function (sx, sy) { const ll = map.unproject([sx, sy]); return fromLL(ll.lng, ll.lat); };
viewName = () => MODES[viewMode].name[0] + MODES[viewMode].name.slice(1).toLowerCase();
toggleView = function () { viewMode = (viewMode + 1) % MODES.length; applyMode(); };
toggleChart = function () { cam.chart = !cam.chart; for (const id of ['sec', 'tac']) map.setLayoutProperty(id, 'visibility', cam.chart ? 'visible' : 'none'); document.getElementById('bChart').textContent = cam.chart ? 'MAP' : 'CHART'; };
const AIR_LAYERS = ['e5', 'frz-fill', 'sua-hatch', 'vol-line', 'vol-dash', 'vlab', 'x-d', 'x-sua', 'x-b', 'x-moa', 'x-sfra'];
const setAir2D = setAir;
setAir = function (on) { setAir2D(on); if (map && mapReady) { for (const id of AIR_LAYERS) map.setLayoutProperty(id, 'visibility', on && (viewMode !== 0 || !id.startsWith('x-')) ? 'visible' : 'none'); } };   // slabs only in the 3D camera modes
zoom = function (f) { CAM.zoomT = clamp(CAM.zoomT + Math.log2(f) * 1.2, 5.5, 15.5); };
render = function () {
  if (!mapReady || !pl) return;
  updateCamera();
  const now = performance.now(); if (now - planeT > 50) { planeT = now; updatePlane(); }   // ~20 Hz: rebuilding the plane geometry every frame is the costliest part
  if (FEATURES.traffic && typeof trafficTick === 'function') trafficTick(now);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  drawHUD();
};
(function initMap() {
  const c = toLL(START.x, START.y);
  fetch('https://tiles.openfreemap.org/styles/positron').then(r => r.json()).then(style => {
    map = new maplibregl.Map({ container: 'map', style: sectionalTint(style), center: c, zoom: 10.3, pitch: 62, bearing: 112, maxPitch: 78, dragPan: false, keyboard: false,
      pixelRatio: Math.min(devicePixelRatio || 1, 1.5),   // full Retina resolution costs a lot of GPU for little gain here
      attributionControl: { compact: true }, fadeDuration: 0 });
    map.on('load', () => { addLayers(); if (FEATURES.traffic && typeof initTraffic === 'function') initTraffic(map); wireGestures(); mapReady = true; mapReadyHook(); });
    map.on('click', e => info(e.point.x, e.point.y));
  }).catch(err => { document.getElementById('startBtn').textContent = 'Map tiles unavailable'; console.error(err); });
})();
