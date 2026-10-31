"""Fetch AWS Terrain Tiles (Terrarium encoding) for the game region and build:
  data/derived/dem.json  elevation grid in feet on the game's nm frame (0.4 nm cells), base64 uint16
  MEF estimates per 15-minute quadrangle (terrain + obstacles)
Run from the repo root. Tiles are cached in tools/.dem_cache (not committed)."""
import math, os, json, base64, subprocess, sys, io, time
import numpy as np
from PIL import Image
sys.path.insert(0, 'tools')
from masks import REG   # one region for every build step
COS = math.cos(math.radians(REG['clat']))
Z = 11; N = 2 ** Z; CACHE = 'tools/.dem_cache'; os.makedirs(CACHE, exist_ok=True)
tx = lambda lon: (lon + 180) / 360 * N
ty = lambda lat: (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * N
Q = .25   # MEF quadrangle size (degrees); fetch tiles out to whole quadrangles
x0, x1 = int(tx(math.floor(REG['lon0'] / Q) * Q)), int(tx(math.ceil(REG['lon1'] / Q) * Q)); y0, y1 = int(ty(math.ceil(REG['lat1'] / Q) * Q)), int(ty(math.floor(REG['lat0'] / Q) * Q))
tiles = {}
for X in range(x0, x1 + 1):
    for Y in range(y0, y1 + 1):
        f = f'{CACHE}/{Z}_{X}_{Y}.png'
        if not os.path.exists(f):
            subprocess.run(['curl', '-sS', '-m', '60', '-o', f, f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{X}/{Y}.png'], check=True); time.sleep(.05)
        a = np.array(Image.open(f).convert('RGB')).astype(np.float32)
        tiles[(X, Y)] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
print('tiles', len(tiles))
def elev_m(lat, lon):
    fx, fy = tx(lon), ty(lat); X, Y = int(fx), int(fy); t = tiles[(X, Y)]
    px = min(255, int((fx - X) * 256)); py = min(255, int((fy - Y) * 256)); return t[py, px]
# grid on the game's nm frame
STEP = .4
gx0, gy0 = (REG['lon0'] - REG['clon']) * 60 * COS, -(REG['lat1'] - REG['clat']) * 60
gx1, gy1 = (REG['lon1'] - REG['clon']) * 60 * COS, -(REG['lat0'] - REG['clat']) * 60
nx, ny = int((gx1 - gx0) / STEP) + 1, int((gy1 - gy0) / STEP) + 1
grid = np.zeros((ny, nx), np.uint16)
for j in range(ny):
    for i in range(nx):
        x, y = gx0 + i * STEP, gy0 + j * STEP; lat = REG['clat'] - y / 60; lon = REG['clon'] + x / (60 * COS)
        grid[j, i] = max(0, round(elev_m(lat, lon) / .3048))
# MEF per 15' quadrangle: highest terrain (full tile resolution) or obstacle, plus allowances, rounded up to 100 ft
obs = json.load(open('data/faa/obstacles.geojson'))['features']
mefs = []
q = .25
lat = math.floor(REG['lat0'] / q) * q
while lat < REG['lat1']:
    lon = math.floor(REG['lon0'] / q) * q
    while lon < REG['lon1']:
        tmax = 0
        for la in np.arange(lat, lat + q, .004):
            for lo in np.arange(lon, lon + q, .004): tmax = max(tmax, elev_m(la, lo) / .3048)
        omax = max([o['properties']['AMSL'] for o in obs if lat <= float(o['properties']['Lat_DD']) < lat + q and lon <= float(o['properties']['Long_DD']) < lon + q] or [0])
        mef = math.ceil(max(tmax + 300, omax + 100) / 100) * 100
        mefs.append({'lat': round(lat, 3), 'lon': round(lon, 3), 'mef': int(mef), 't': int(tmax), 'o': int(omax)})
        lon += q
    lat += q
out = {'x0': round(gx0, 3), 'y0': round(gy0, 3), 'step': STEP, 'nx': nx, 'ny': ny, 'ft': base64.b64encode(grid.astype('<u2').tobytes()).decode(), 'mef': mefs}
json.dump(out, open('data/derived/dem.json', 'w'), separators=(',', ':'))
print('grid', nx, 'x', ny, 'max ft', int(grid.max()), 'KB', os.path.getsize('data/derived/dem.json') // 1024)
for m in mefs:
    if (m['lat'], m['lon']) in [(39.25, -77.5), (39.5, -77.5), (39.25, -77.25), (39.5, -77.25), (39.25, -76.75), (39.0, -76.5)]: print(m)
