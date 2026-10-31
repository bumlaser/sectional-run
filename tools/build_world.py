import json, math, base64, sys
sys.path.insert(0, 'tools'); from masks import REG, nm_xy, COS
D = '/home/user/sectional-run/data/faa/'
X0, X1 = nm_xy(REG['lat1'], REG['lon0'])[0], nm_xy(REG['lat0'], REG['lon1'])[0]
Y0, Y1 = nm_xy(REG['lat1'], REG['lon0'])[1], nm_xy(REG['lat0'], REG['lon1'])[1]
inreg = lambda x, y, m=0: X0 - m <= x <= X1 + m and Y0 - m <= y <= Y1 + m
def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1e-9
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L if L > 1e-9 else math.hypot(pts[i][0] - a[0], pts[i][1] - a[1])
        if d > dmax: dmax, idx = d, i
    if dmax > eps: return dp(pts[:idx + 1], eps)[:-1] + dp(pts[idx:], eps)
    return [a, b]
def rings(g):
    return g['coordinates'] if g['type'] == 'Polygon' else [r for p in g['coordinates'] for r in p]
def conv(ring, eps):
    pts = [list(nm_xy(p[1], p[0])) for p in ring]
    s = dp(pts, eps); return [[round(x, 2), round(y, 2)] for x, y in s]
def inpoly(x, y, rs):
    c = False
    for p in rs:
        for i in range(len(p)):
            (xi, yi), (xj, yj) = p[i], p[i - 1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
    return c
def segd(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; l = dx * dx + dy * dy; u = max(0, min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l)) if l else 0
    return math.hypot(px - a[0] - u * dx, py - a[1] - u * dy)
def labelpt(rs):
    xs = [p[0] for r in rs for p in r]; ys = [p[1] for r in rs for p in r]
    best, bp = -1, (sum(xs) / len(xs), sum(ys) / len(ys))
    n = 24
    for i in range(n + 1):
        for j in range(n + 1):
            x = min(xs) + (max(xs) - min(xs)) * i / n; y = min(ys) + (max(ys) - min(ys)) * j / n
            if not inreg(x, y) or not inpoly(x, y, rs): continue
            d = min(segd(x, y, r[k], r[k - 1]) for r in rs for k in range(len(r)))
            if d > best: best, bp = d, (x, y)
    return [round(bp[0], 2), round(bp[1], 2)], round(best, 2)
def alt(val, code, uom):
    if val is None: return 0
    v = float(val)
    if code == 'SFC' and v <= 0: return 0   # a positive value with code SFC is a height above the surface (P-75: 1,000 ft); taken as MSL
    if v < 0: return 60000          # FAA code for unlimited
    return int(v * 100) if uom == 'FL' else int(v)
vols = []
ca = json.load(open(D + 'class_airspace.geojson'))['features']
for f in ca:
    p = f['properties']; lt = p['LOCAL_TYPE']; cls = p['CLASS']
    kind = {'CLASS_B': 'B', 'CLASS_C': 'C', 'CLASS_D': 'D', 'CLASS_E2': 'E2', 'CLASS_E5': 'E5', 'MODE C': 'MODEC'}.get(lt)
    if not kind: continue
    eps = .12 if kind == 'E5' else .04
    rs = [conv(r, eps) for r in rings(f['geometry'])]
    if not any(inreg(x, y, 2) for r in rs for x, y in r): continue
    if kind == 'E5' and not any(inreg(x, y, 0) for r in rs for x, y in r): continue
    lp, rad = labelpt(rs)
    vols.append({'k': kind, 'n': p['NAME'], 'id': p['IDENT'], 'fl': alt(p['LOWER_VAL'], p['LOWER_CODE'], p['LOWER_UOM']), 'ce': alt(p['UPPER_VAL'], p['UPPER_CODE'], p['UPPER_UOM']),
                 'sec': p.get('SECTOR'), 'r': rs, 'lp': lp})
for f in json.load(open(D + 'sua.geojson'))['features']:
    p = f['properties']; kind = {'R': 'R', 'P': 'P', 'MOA': 'MOA', 'W': 'W', 'A': 'A'}.get(p['TYPE_CODE'])
    if not kind: continue
    rs = [conv(r, .04) for r in rings(f['geometry'])]
    if not any(inreg(x, y, 1) for r in rs for x, y in r): continue
    lp, _ = labelpt(rs)
    vols.append({'k': kind, 'n': p['NAME'], 'fl': alt(p['LOWER_VAL'], p['LOWER_CODE'], p['LOWER_UOM']), 'ce': alt(p['UPPER_VAL'], p['UPPER_CODE'], p['UPPER_UOM']),
                 'tou': (p.get('TIMESOFUSE') or '').strip(), 'ag': (p.get('CONT_AGENT') or '').strip(), 'r': rs, 'lp': lp})
# DC SFRA / FRZ approximations around the DCA VOR
nav = json.load(open(D + 'navaids.geojson'))['features']
dca = next(f for f in nav if f['properties']['IDENT'] == 'DCA'); dlon, dlat = dca['geometry']['coordinates'][:2]
cx, cy = nm_xy(dlat, dlon)
circ = lambda R: [[round(cx + R * math.cos(i / 90 * math.pi), 2), round(cy + R * math.sin(i / 90 * math.pi), 2)] for i in range(180)]
vols.append({'k': 'SFRA', 'n': 'Washington DC SFRA', 'fl': 0, 'ce': 18000, 'r': [circ(30)], 'lp': [round(cx, 2), round(cy - 22, 2)], 'approx': 1})
vols.append({'k': 'FRZ', 'n': 'Washington DC FRZ', 'fl': 0, 'ce': 18000, 'r': [circ(15)], 'lp': [round(cx, 2), round(cy - 11, 2)], 'approx': 1})
# R-4009 when active: the 10 NM ring the TAC draws around P-40 (measured on the georeferenced TAC: 9.7-10.0 NM),
# surface to 12,500 ft. The game makes it hot only while a VIP is at Camp David; P-40 inside stays always active.
def expand_r4009(vols):
    p40 = next(v for v in vols if v['n'] == 'P-40'); r = p40['r'][0]
    pcx, pcy = sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)
    for v in vols:
        if v['n'] == 'R-4009':
            v.update(fl=0, ce=12500, r=[[[round(pcx + 10 * math.cos(i / 45 * math.pi), 2), round(pcy + 10 * math.sin(i / 45 * math.pi), 2)] for i in range(90)]],
                     lp=[round(pcx, 2), round(pcy + 7, 2)], tou='WHEN A VIP IS AT CAMP DAVID (BY NOTAM)')
expand_r4009(vols)
# Hudson River SFRA (14 CFR 93 Subpart W): the Hudson River Exclusion, surface up to but not including 1,300 ft MSL,
# from Alpine Tower to the Verrazano-Narrows Bridge. Shape: a hand-placed centreline down the river, widened at each
# step to the shorelines found in the chart-derived water mask, so the corridor follows the real banks.
# Shorelines are read from the New York TAC at full resolution (~21 m/px): the block-averaged mask calls the narrow,
# city-lined Hudson "town". Short gaps (labels, airspace lines printed over the water) are stepped over in reach().
import numpy as _np, lcc as _L
from PIL import Image as _I; _I.MAX_IMAGE_PIXELS = None
_nyt = _L.TAC_NY('charts'); _im = _I.open('charts/ny_tac/New York TAC.tif'); _pal = _np.array(_im.getpalette()[:768]).reshape(-1, 3).astype(int); _idx = _np.array(_im)
_wl = (_pal[:, 2] - _pal[:, 0] >= 25) & (_pal[:, 2] >= _pal[:, 1] - 10) & (_pal[:, 2] >= 100)   # any clearly blue ink: the TAC shades the river in several blues
def _water(x, y):
    lat, lon = REG['clat'] - y / 60, REG['clon'] + x / (60 * COS); i, j = _nyt.px(lat, lon); i, j = int(i), int(j)
    return 0 <= j < _idx.shape[0] and 0 <= i < _idx.shape[1] and bool(_wl[_idx[j, i]])
HUD_CL = [(40.966, -73.911), (40.958, -73.915), (40.930, -73.916), (40.900, -73.926), (40.878, -73.934), (40.852, -73.952), (40.820, -73.968),
          (40.800, -73.982), (40.780, -73.996), (40.765, -74.006), (40.750, -74.013), (40.730, -74.019), (40.715, -74.022), (40.700, -74.030),
          (40.689, -74.042), (40.665, -74.048), (40.640, -74.050), (40.620, -74.047), (40.604, -74.045)]
HUD_PTS = [('ALP', 'Alpine Tower', 40.958, -73.916), ('GWB', 'George Washington Bridge', 40.852, -73.952), ('INT', 'the Intrepid', 40.765, -74.006),
           ('SOL', 'the Statue of Liberty', 40.6892, -74.0445), ('VNB', 'the Verrazano-Narrows Bridge', 40.606, -74.045)]
def hudson():
    cl = [nm_xy(la, lo) for la, lo in HUD_CL]; samples = []
    for (ax, ay), (bx, by) in zip(cl, cl[1:]):
        L = math.hypot(bx - ax, by - ay); n = max(1, int(L / .05))
        for k in range(n): samples.append((ax + (bx - ax) * k / n, ay + (by - ay) * k / n, (bx - ax) / L, (by - ay) / L))
    samples.append((*cl[-1], samples[-1][2], samples[-1][3]))
    left, right = [], []
    for x, y, ux, uy in samples:
        px, py = uy, -ux   # perpendicular: +side is east of a southbound centreline
        if not _water(x, y):   # centreline point on land: re-centre on the nearest water across the river
            for d in [k * .01 for k in range(1, 61)]:
                if _water(x + px * d, y + py * d): x, y = x + px * d, y + py * d; break
                if _water(x - px * d, y - py * d): x, y = x - px * d, y - py * d; break
        def reach(sg):   # distance to the shore on one side, stepping over up to 0.08 NM of ink on the water
            d = last = 0
            while d < .9:
                d += .01
                if _water(x + sg * px * d, y + sg * py * d): last = d
                elif d - last > .08: break
            return max(last, .12)
        left.append((x - px * reach(-1), y - py * reach(-1))); right.append((x + px * reach(1), y + py * reach(1)))
    sm = lambda P: [(sum(q[0] for q in P[max(0, i - 3):i + 4]) / len(P[max(0, i - 3):i + 4]), sum(q[1] for q in P[max(0, i - 3):i + 4]) / len(P[max(0, i - 3):i + 4])) for i in range(len(P))]
    ring = [[round(x, 3), round(y, 3)] for x, y in sm(left) + sm(right)[::-1]]
    mid = nm_xy(40.80, -73.982)
    vols.append({'k': 'HSFRA', 'n': 'Hudson River SFRA', 'fl': 0, 'ce': 1300, 'r': [ring], 'lp': [round(mid[0], 2), round(mid[1], 2)], 'tou': 'CONTINUOUS', 'ag': ''})
    sx, sy = nm_xy(40.6892, -74.0445)   # the waters round Liberty Island, so you can circle the Statue inside the corridor
    vols.append({'k': 'HSFRA', 'n': 'Hudson River SFRA', 'fl': 0, 'ce': 1300, 'r': [[[round(sx + .7 * math.cos(i / 24 * math.pi), 3), round(sy + .7 * math.sin(i / 24 * math.pi), 3)] for i in range(48)]],
                 'lp': [round(sx, 2), round(sy, 2)], 'tou': 'CONTINUOUS', 'ag': '', 'nolab': 1})
    return {'cl': [[round(x, 3), round(y, 3)] for x, y in cl], 'pts': [{'id': i, 'n': n, 'x': round(nm_xy(la, lo)[0], 3), 'y': round(nm_xy(la, lo)[1], 3)} for i, n, la, lo in HUD_PTS]}
HUDSON = hudson()
# airports
dlinks = {v['id'] for v in vols if v['k'] in ('C', 'D')}   # airports with a Class C or D have a tower
aps = []
for f in json.load(open(D + 'airports.geojson'))['features']:
    p = f['properties']; lon, lat = f['geometry']['coordinates'][:2]; x, y = nm_xy(lat, lon)
    if not inreg(x, y) or p['TYPE_CODE'] != 'AD' or p['PRIVATEUSE'] != 0 or p['OPERSTATUS'] != 'OPERATIONAL': continue
    tw = p['IDENT'] in dlinks or p['IDENT'] in ('BWI', 'DCA', 'IAD', 'ADW', 'PHL', 'EWR', 'JFK', 'LGA')   # plus the Class B primaries
    aps.append({'id': p['IDENT'], 'n': p['NAME'], 'x': round(x, 2), 'y': round(y, 2), 'e': round(p['ELEVATION'] or 0), 'tw': 1 if tw else 0, 'mil': 1 if p['MIL_CODE'] != 'CIVIL' else 0, 'gid': p['GLOBAL_ID'], 'rw': []})
# runways: centreline from each runway outline (FAA ADDS Runways layer)
bygid = {a['gid']: a for a in aps}
try: rws = json.load(open(D + 'runways.geojson'))['features']
except FileNotFoundError: rws = []
for f in rws:
    p = f['properties']; a = bygid.get(p['AIRPORT_ID'])
    if not a or not f['geometry']: continue
    ring = [list(nm_xy(q[1], q[0])) for q in rings(f['geometry'])[0]]
    if ring[0] == ring[-1]: ring = ring[:-1]
    cx = sum(q[0] for q in ring) / len(ring); cy = sum(q[1] for q in ring) / len(ring)
    best = max(((ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))), key=lambda e: math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1]))
    dx, dy = best[1][0] - best[0][0], best[1][1] - best[0][1]; L = math.hypot(dx, dy) or 1; ux, uy = dx / L, dy / L
    half = (p['LENGTH'] or L * 6076) / 6076.1 / 2
    a['rw'].append([round(cx - ux * half, 3), round(cy - uy * half, 3), round(cx + ux * half, 3), round(cy + uy * half, 3), int(p['LENGTH'] or 0), int(p['WIDTH'] or 0), p['DESIGNATOR'], (p['COMP_CODE'] or '')[:4]])
for a in aps: del a['gid']
# obstacles: tallest per ~1.5 nm cell, 400 ft AGL and up
cells = {}
for f in json.load(open(D + 'obstacles.geojson'))['features']:
    p = f['properties']; lat, lon = float(p['Lat_DD']), float(p['Long_DD']); x, y = nm_xy(lat, lon)
    if not inreg(x, y) or (p['AGL'] or 0) < 400: continue
    k = (int((x + 100) // 1.5), int((y + 100) // 1.5))
    if k not in cells or p['AMSL'] > cells[k]['m']:
        cells[k] = {'x': round(x, 2), 'y': round(y, 2), 'm': int(p['AMSL']), 'a': int(p['AGL']), 'l': 1 if (p['Lighting'] or 'N').strip() not in ('N', 'U', '') else 0, 't': (p['Type_Code'] or '').strip().lower()}
obs = list(cells.values())
vfreq = {f['properties']['IDENT']: round(f['properties']['FREQUENCY'], 2) for f in json.load(open(D + 'navaid_freqs.geojson'))['features'] if f['properties']['FREQUENCY']}
vors = []
for f in nav:
    p = f['properties']; lon, lat = f['geometry']['coordinates'][:2]; x, y = nm_xy(lat, lon)
    if inreg(x, y) and 'VOR' in (p['CLASS_TXT'] or ''): vors.append({'id': p['IDENT'], 'n': p['NAME_TXT'], 'x': round(x, 2), 'y': round(y, 2), 'c': p['CLASS_TXT'], 'f': vfreq.get(p['IDENT'])})
mask = base64.b64encode(open('charts/mask.png', 'rb').read()).decode()
world = {'reg': {'x0': round(X0, 3), 'y0': round(Y0, 3), 'x1': round(X1, 3), 'y1': round(Y1, 3), 'clat': REG['clat'], 'clon': REG['clon'], 'cos': COS, 'maskPx': 10}, 'vols': vols, 'aps': aps, 'obs': obs, 'vors': vors, 'hudson': HUDSON, 'mask': mask}
open('sectional/world.json', 'w').write(json.dumps(world, separators=(',', ':')))
import collections
print('vols', collections.Counter(v['k'] for v in vols), 'aps', len(aps), 'towered', sum(a['tw'] for a in aps), 'obs', len(obs), 'vors', [v['id'] for v in vors])
print('size KB', len(json.dumps(world, separators=(',', ':'))) // 1024, 'mask KB', len(mask) // 1024)
print([ (v['n'], v['fl'], v['ce']) for v in vols if v['k'] in ('R','P','MOA')])
