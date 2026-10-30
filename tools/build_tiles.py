# Cut the FAA GeoTIFFs into Web-Mercator XYZ tiles for the 3D build's chart layer.
# The TAC (1:250k, ~21 m/px) is used inside its neatline; the Washington Sectional fills the rest.
# z13 is sampled bilinearly from the source charts, lower zooms are 2x2 averages of their children.
# usage: python3 tools/build_tiles.py <charts dir> [out dir]
import sys, math, os, numpy as np; sys.path.insert(0, 'tools'); import lcc as L
from PIL import Image; Image.MAX_IMAGE_PIXELS = None
D = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else '3d/tiles/chart'
BOUNDS = (-78.2, 38.3, -75.7, 40.07)          # game region plus a margin
ZMAX, ZMIN, T = 13, 7, 256

def chart(proj, path, rect):
    im = Image.open(path); pal = np.array(im.getpalette()[:768], np.float32).reshape(-1, 3)
    return dict(p=proj, idx=np.array(im), pal=pal, rect=rect)
# chart interiors in source pixels (collar, legend and neatline ticks excluded)
TAC = chart(L.TAC_BW(D), D + '/bw_tac/Baltimore-Washington TAC.tif', (1625, 200, 12010, 8590))
SEC = chart(L.SEC_W(D), D + '/wash_sec/Washington SEC.tif', (1840, 30, 16655, 11395))

def src_px(c, lat, lon):
    p = c['p']; phi = np.radians(lat); s = np.sin(phi)
    t = np.tan(np.pi / 4 - phi / 2) / ((1 - L.E * s) / (1 + L.E * s)) ** (L.E / 2)
    r = L.A * p.Fc * t ** p.n; th = p.n * (np.radians(lon) - p.lon0)
    return (r * np.sin(th) - p.c) / p.a, (p.r0 - r * np.cos(th) - p.f) / p.e

def sample(c, px, py):
    H, W = c['idx'].shape; x0 = np.floor(px).astype(int); y0 = np.floor(py).astype(int); fx = (px - x0)[..., None]; fy = (py - y0)[..., None]
    g = lambda yy, xx: c['pal'][c['idx'][np.clip(yy, 0, H - 1), np.clip(xx, 0, W - 1)]]
    return (g(y0, x0) * (1 - fx) + g(y0, x0 + 1) * fx) * (1 - fy) + (g(y0 + 1, x0) * (1 - fx) + g(y0 + 1, x0 + 1) * fx) * fy

def tile_range(z):
    n = 2 ** z; tx = lambda lon: int((lon + 180) / 360 * n)
    ty = lambda lat: int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return range(tx(BOUNDS[0]), tx(BOUNDS[2]) + 1), range(ty(BOUNDS[3]), ty(BOUNDS[1]) + 1)

def render(z, x, y):
    n = 2 ** z; u = (x + (np.arange(T) + .5) / T) / n; v = (y + (np.arange(T) + .5) / T) / n
    lon = np.broadcast_to(u * 360 - 180, (T, T)); lat = np.broadcast_to(np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * v))))[:, None], (T, T))
    out = np.full((T, T, 3), 255, np.float32)
    for c in (SEC, TAC):                       # TAC drawn over the sectional
        px, py = src_px(c, lat, lon); x0, y0, x1, y1 = c['rect']
        m = (px >= x0) & (px < x1) & (py >= y0) & (py < y1)
        if m.any(): out[m] = sample(c, px[m], py[m])
    return out

def save(z, x, y, a):
    os.makedirs(f'{OUT}/{z}/{x}', exist_ok=True)
    a = np.clip(a + .5, 0, 255).astype(np.uint8); Image.fromarray(a).save(f'{OUT}/{z}/{x}/{y}.webp', quality=80, method=5); return a

level = {}
xs, ys = tile_range(ZMAX)
for x in xs:
    for y in ys: level[x, y] = save(ZMAX, x, y, render(ZMAX, x, y))
print('z', ZMAX, len(level))
for z in range(ZMAX - 1, ZMIN - 1, -1):
    xs, ys = tile_range(z); nxt = {}
    for x in xs:
        for y in ys:
            big = np.full((2 * T, 2 * T, 3), 255, np.float32)
            for dx in (0, 1):
                for dy in (0, 1):
                    k = (2 * x + dx, 2 * y + dy)
                    big[dy * T:(dy + 1) * T, dx * T:(dx + 1) * T] = level[k] if k in level else render(z + 1, *k)
            nxt[x, y] = save(z, x, y, big.reshape(T, 2, T, 2, 3).mean(axis=(1, 3)))
    level = nxt; print('z', z, len(level))
