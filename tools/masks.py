import sys, math, numpy as np; sys.path.insert(0, 'tools'); from lcc import *
from PIL import Image, ImageFilter; Image.MAX_IMAGE_PIXELS = None
REG = dict(lon0=-77.95, lon1=-75.95, lat0=38.55, lat1=39.82, clat=39.2, clon=-76.95)
COS = math.cos(math.radians(REG['clat']))
def nm_xy(lat, lon): return (lon - REG['clon']) * 60 * COS, -(lat - REG['clat']) * 60
def ll_of(x, y): return REG['clat'] - y / 60, REG['clon'] + x / (60 * COS)
if __name__ == '__main__':
    tac = TAC_BW('charts'); im = Image.open('charts/bw_tac/Baltimore-Washington TAC.tif')
    pal = np.array(im.getpalette()[:768]).reshape(-1, 3)
    r, g, b = pal[:, 0].astype(int), pal[:, 1].astype(int), pal[:, 2].astype(int)
    water = (b >= 236) & (b - r >= 18) & (r >= 196) & (g >= 214)
    city = (r >= 230) & (g >= 200) & (b <= 140)
    white = (r >= 250) & (g >= 250) & (b >= 250)
    land = (r >= 185) & (g >= 195) & (b >= 150) & ~water & ~city & ~white & (g - b >= 10) & (g - b < 60)
    idx = np.array(im)                           # palette indices
    S = 4; H, W = idx.shape; H4, W4 = H // S, W // S
    def frac(lut):
        m = lut[idx[:H4 * S, :W4 * S]].astype(np.float32)
        return m.reshape(H4, S, W4, S).mean(axis=(1, 3))
    fw, fc = frac(water), frac(city)
    # sample onto the game grid (PX px per nm, equirectangular nm frame)
    PX = 10
    x0, y0 = nm_xy(REG['lat1'], REG['lon0']); x1, y1 = nm_xy(REG['lat0'], REG['lon1'])
    nx, ny = int((x1 - x0) * PX), int((y1 - y0) * PX)
    xs = x0 + (np.arange(nx) + .5) / PX; ys = y0 + (np.arange(ny) + .5) / PX
    X, Y = np.meshgrid(xs, ys); LAT = REG['clat'] - Y / 60; LON = REG['clon'] + X / (60 * COS)
    # vectorised LCC forward
    import lcc as L
    phi = np.radians(LAT); s = np.sin(phi); t = np.tan(np.pi / 4 - phi / 2) / ((1 - L.E * s) / (1 + L.E * s)) ** (L.E / 2)
    rr = L.A * tac.Fc * t ** tac.n; th = tac.n * (np.radians(LON) - tac.lon0)
    PXc = (rr * np.sin(th) - tac.c) / tac.a / S; PYc = (tac.r0 - rr * np.cos(th) - tac.f) / tac.e / S
    ci = np.clip(PXc.astype(int), 0, W4 - 1); cj = np.clip(PYc.astype(int), 0, H4 - 1)
    fl = frac(land)
    def win(f, R=2):  # block mean around each sample; ink and label boxes don't vote
        acc = np.zeros_like(X)
        for dj in range(-R, R + 1):
            for di in range(-R, R + 1): acc += f[np.clip(cj + dj, 0, H4 - 1), np.clip(ci + di, 0, W4 - 1)]
        return acc
    Wv, Cv, Lv = win(fw), win(fc), win(fl); tot = Wv + Cv + Lv + 1e-6
    weak = tot < 6                                    # mostly ink/white here: widen the vote
    W2, C2, L2 = win(fw, 7), win(fc, 7), win(fl, 7)
    Wv = np.where(weak, W2 * 25 / 225, Wv); Cv = np.where(weak, C2 * 25 / 225, Cv); Lv = np.where(weak, L2 * 25 / 225, Lv); tot = Wv + Cv + Lv + 1e-6
    cls = np.zeros(X.shape, np.uint8); cls[(Cv / tot > .42) & (Cv > .8)] = 2; cls[(Wv / tot > .5) & (Wv > .6)] = 1
    cls[tot < 1.2] = 9                                  # no evidence (white bands, labels): fill from neighbours
    for _ in range(40):
        unk = cls == 9
        if not unk.any(): break
        votes = np.zeros((3,) + cls.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                sh = np.roll(np.roll(cls, dy, 0), dx, 1)
                for k in (0, 1): votes[k] += sh == k
        best = votes.argmax(0); has = votes.sum(0) > 0
        cls[unk & has] = best[unk & has]
    cls[cls == 9] = 0
    img = Image.fromarray(cls * 100).filter(ImageFilter.ModeFilter(5))
    # close small gaps inside water (bridges, airspace lines, text)
    wm = Image.fromarray(((np.array(img) == 100) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
    arr = np.array(img); arr[np.array(wm) > 0] = 100; img = Image.fromarray(arr)
    img.save('charts/mask.png', optimize=True)
    print('mask', img.size, 'water %', round((np.array(img) == 100).mean() * 100, 1), 'city %', round((np.array(img) == 200).mean() * 100, 1), 'origin nm', round(x0, 2), round(y0, 2))
    # warped real-chart layer for the 'real chart' toggle (RGB, PXR px per nm)
    PXR = 20
    nxr, nyr = int((x1 - x0) * PXR), int((y1 - y0) * PXR)
    xs = x0 + (np.arange(nxr) + .5) / PXR; ys = y0 + (np.arange(nyr) + .5) / PXR
    X, Y = np.meshgrid(xs, ys); LAT = REG['clat'] - Y / 60; LON = REG['clon'] + X / (60 * COS)
    phi = np.radians(LAT); s = np.sin(phi); t = np.tan(np.pi / 4 - phi / 2) / ((1 - L.E * s) / (1 + L.E * s)) ** (L.E / 2)
    rr = L.A * tac.Fc * t ** tac.n; th = tac.n * (np.radians(LON) - tac.lon0)
    PXf = np.clip(((rr * np.sin(th) - tac.c) / tac.a).astype(int), 0, W - 1); PYf = np.clip(((tac.r0 - rr * np.cos(th) - tac.f) / tac.e).astype(int), 0, H - 1)
    # area-average: sample the 2x-downsampled RGB to reduce aliasing
    rgb = pal[idx[PYf, PXf]].astype(np.uint8)
    Image.fromarray(rgb).save('charts/tac_warp.jpg', quality=62, optimize=True, progressive=True)
    print('tac', nxr, nyr)
