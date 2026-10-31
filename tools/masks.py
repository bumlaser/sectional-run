import sys, math, numpy as np; sys.path.insert(0, 'tools'); from lcc import *
from PIL import Image, ImageFilter; Image.MAX_IMAGE_PIXELS = None
# Game region: the Frederick-New York corridor. Everything (FAA data, terrain, mask, chart) is built for this box.
REG = dict(lon0=-78.2, lon1=-73.3, lat0=38.5, lat1=41.2, clat=39.85, clon=-75.75)
COS = math.cos(math.radians(REG['clat']))
def nm_xy(lat, lon): return (lon - REG['clon']) * 60 * COS, -(lat - REG['clat']) * 60
def ll_of(x, y): return REG['clat'] - y / 60, REG['clon'] + x / (60 * COS)
if __name__ == '__main__':
    import lcc as L
    # Charts in priority order (the TACs are more detailed than the sectional). rect = chart interior in source pixels.
    CHARTS = [('bw_tac/Baltimore-Washington TAC.tif', TAC_BW('charts'), (1625, 200, 12010, 8590)),
              ('ny_tac/New York TAC.tif', TAC_NY('charts'), (3075, 580, 11960, 6020)),
              ('wash_sec/Washington SEC.tif', SEC_W('charts'), (1840, 30, 16655, 11395))]
    S = 4
    def grid(PX):
        x0, y0 = nm_xy(REG['lat1'], REG['lon0']); x1, y1 = nm_xy(REG['lat0'], REG['lon1'])
        nx, ny = int((x1 - x0) * PX), int((y1 - y0) * PX)
        X, Y = np.meshgrid(x0 + (np.arange(nx) + .5) / PX, y0 + (np.arange(ny) + .5) / PX)
        return x0, y0, X, Y, REG['clat'] - Y / 60, REG['clon'] + X / (60 * COS)
    def chart_px(p, LAT, LON):   # vectorised LCC forward, to source pixels
        phi = np.radians(LAT); s = np.sin(phi); t = np.tan(np.pi / 4 - phi / 2) / ((1 - L.E * s) / (1 + L.E * s)) ** (L.E / 2)
        rr = L.A * p.Fc * t ** p.n; th = p.n * (np.radians(LON) - p.lon0)
        return (rr * np.sin(th) - p.c) / p.a, (p.r0 - rr * np.cos(th) - p.f) / p.e
    PX = 10; x0, y0, X, Y, LAT, LON = grid(PX)
    PXR = 10; _, _, XR, YR, LATR, LONR = grid(PXR)
    Wv = np.zeros(X.shape); Cv = np.zeros(X.shape); Lv = np.zeros(X.shape); W2 = np.zeros(X.shape); C2 = np.zeros(X.shape); L2 = np.zeros(X.shape)
    have = np.zeros(X.shape, bool); rgb = np.full(XR.shape + (3,), [222, 230, 205], np.uint8); haveR = np.zeros(XR.shape, bool)
    for path, proj, (rx0, ry0, rx1, ry1) in CHARTS:
        im = Image.open('charts/' + path); pal = np.array(im.getpalette()[:768]).reshape(-1, 3); idx = np.array(im); H, W = idx.shape
        r, g, b = pal[:, 0].astype(int), pal[:, 1].astype(int), pal[:, 2].astype(int)
        water = (b >= 236) & (b - r >= 18) & (r >= 196) & (g >= 214)
        city = (r >= 230) & (g >= 200) & (b <= 140)
        white = (r >= 250) & (g >= 250) & (b >= 250)
        land = (r >= 185) & (g >= 195) & (b >= 150) & ~water & ~city & ~white & (g - b >= 10) & (g - b < 60)
        H4, W4 = H // S, W // S
        frac = lambda lut: lut[idx[:H4 * S, :W4 * S]].astype(np.float32).reshape(H4, S, W4, S).mean(axis=(1, 3))
        fw, fc, fl = frac(water), frac(city), frac(land)
        PXc, PYc = chart_px(proj, LAT, LON)
        use = ~have & (PXc >= rx0) & (PXc < rx1) & (PYc >= ry0) & (PYc < ry1)
        ci = np.clip((PXc / S).astype(int), 0, W4 - 1); cj = np.clip((PYc / S).astype(int), 0, H4 - 1)
        def win(f, R):   # block mean around each sample; ink and label boxes don't vote
            acc = np.zeros(X.shape, np.float32)
            for dj in range(-R, R + 1):
                for di in range(-R, R + 1): acc += f[np.clip(cj + dj, 0, H4 - 1), np.clip(ci + di, 0, W4 - 1)]
            return acc
        for dst, f, R in ((Wv, fw, 2), (Cv, fc, 2), (Lv, fl, 2), (W2, fw, 7), (C2, fc, 7), (L2, fl, 7)): dst[use] = win(f, R)[use]
        have |= use
        PXf, PYf = chart_px(proj, LATR, LONR); useR = ~haveR & (PXf >= rx0) & (PXf < rx1) & (PYf >= ry0) & (PYf < ry1)
        rgb[useR] = pal[idx[np.clip(PYf[useR].astype(int), 0, H - 1), np.clip(PXf[useR].astype(int), 0, W - 1)]].astype(np.uint8); haveR |= useR
        print(path, 'cells', int(use.sum()), flush=True); del idx
    tot = Wv + Cv + Lv + 1e-6
    weak = tot < 6                                    # mostly ink/white here: widen the vote
    Wv = np.where(weak, W2 * 25 / 225, Wv); Cv = np.where(weak, C2 * 25 / 225, Cv); Lv = np.where(weak, L2 * 25 / 225, Lv); tot = Wv + Cv + Lv + 1e-6
    cls = np.zeros(X.shape, np.uint8); cls[(Cv / tot > .42) & (Cv > .8)] = 2; cls[(Wv / tot > .5) & (Wv > .6)] = 1
    cls[(tot < 1.2) & have] = 9                       # no evidence (white bands, labels): fill from neighbours
    for _ in range(40):
        unk = cls == 9
        if not unk.any(): break
        votes = np.zeros((3,) + cls.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                sh = np.roll(np.roll(cls, dy, 0), dx, 1)
                for k in (0, 1): votes[k] += sh == k
        best = votes.argmax(0); hasv = votes.sum(0) > 0
        cls[unk & hasv] = best[unk & hasv]
    cls[cls == 9] = 0
    img = Image.fromarray(cls * 100).filter(ImageFilter.ModeFilter(5))
    # close small gaps inside water (bridges, airspace lines, text)
    wm = Image.fromarray(((np.array(img) == 100) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
    arr = np.array(img); arr[np.array(wm) > 0] = 100; img = Image.fromarray(arr)
    img.save('charts/mask.png', optimize=True)
    print('mask', img.size, 'water %', round((np.array(img) == 100).mean() * 100, 1), 'city %', round((np.array(img) == 200).mean() * 100, 1), 'no chart %', round((~have).mean() * 100, 1), 'origin nm', round(x0, 2), round(y0, 2))
    # the real-chart layer for the canvas build's CHART button (TACs where they exist, sectional elsewhere)
    Image.fromarray(rgb).save('charts/tac_warp.jpg', quality=62, optimize=True, progressive=True)
    print('chart', rgb.shape[1], rgb.shape[0])
