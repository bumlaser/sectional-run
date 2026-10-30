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
    if code == 'SFC' or val is None: return 0
    v = float(val)
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
# airports
dlinks = {v['id'] for v in vols if v['k'] == 'D'}
aps = []
for f in json.load(open(D + 'airports.geojson'))['features']:
    p = f['properties']; lon, lat = f['geometry']['coordinates'][:2]; x, y = nm_xy(lat, lon)
    if not inreg(x, y) or p['TYPE_CODE'] != 'AD' or p['PRIVATEUSE'] != 0 or p['OPERSTATUS'] != 'OPERATIONAL': continue
    tw = p['IDENT'] in dlinks or p['IDENT'] in ('BWI', 'DCA', 'IAD', 'ADW')
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
vors = []
for f in nav:
    p = f['properties']; lon, lat = f['geometry']['coordinates'][:2]; x, y = nm_xy(lat, lon)
    if inreg(x, y) and 'VOR' in (p['CLASS_TXT'] or ''): vors.append({'id': p['IDENT'], 'n': p['NAME_TXT'], 'x': round(x, 2), 'y': round(y, 2), 'c': p['CLASS_TXT']})
mask = base64.b64encode(open('charts/mask.png', 'rb').read()).decode()
world = {'reg': {'x0': round(X0, 3), 'y0': round(Y0, 3), 'x1': round(X1, 3), 'y1': round(Y1, 3), 'clat': REG['clat'], 'clon': REG['clon'], 'cos': COS, 'maskPx': 10}, 'vols': vols, 'aps': aps, 'obs': obs, 'vors': vors, 'mask': mask}
open('sectional/world.json', 'w').write(json.dumps(world, separators=(',', ':')))
import collections
print('vols', collections.Counter(v['k'] for v in vols), 'aps', len(aps), 'towered', sum(a['tw'] for a in aps), 'obs', len(obs), 'vors', [v['id'] for v in vors])
print('size KB', len(json.dumps(world, separators=(',', ':'))) // 1024, 'mask KB', len(mask) // 1024)
print([ (v['n'], v['fl'], v['ce']) for v in vols if v['k'] in ('R','P','MOA')])
