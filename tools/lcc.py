import math
A = 6378137.0; F = 1 / 298.257222101; E = math.sqrt(2 * F - F * F)
def _m(phi): return math.cos(phi) / math.sqrt(1 - (E * math.sin(phi)) ** 2)
def _t(phi): s = math.sin(phi); return math.tan(math.pi / 4 - phi / 2) / ((1 - E * s) / (1 + E * s)) ** (E / 2)
class LCC:
    def __init__(self, p1, p2, lat0, lon0, tfw):
        p1, p2, self.lat0, self.lon0 = map(math.radians, (p1, p2, lat0, lon0))
        m1, m2, t1, t2 = _m(p1), _m(p2), _t(p1), _t(p2)
        self.n = math.log(m1 / m2) / math.log(t1 / t2); self.Fc = m1 / (self.n * t1 ** self.n)
        self.r0 = A * self.Fc * _t(self.lat0) ** self.n
        self.a, _, _, self.e, self.c, self.f = tfw  # pixel size x, rot, rot, pixel size y (neg), ulx, uly (pixel centre)
    def fwd(self, lat, lon):
        r = A * self.Fc * _t(math.radians(lat)) ** self.n; th = self.n * (math.radians(lon) - self.lon0)
        return r * math.sin(th), self.r0 - r * math.cos(th)
    def inv(self, x, y):
        r = math.copysign(math.hypot(x, self.r0 - y), self.n); th = math.atan2(x, self.r0 - y)
        t = (r / (A * self.Fc)) ** (1 / self.n); phi = math.pi / 2 - 2 * math.atan(t)
        for _ in range(8): s = math.sin(phi); phi = math.pi / 2 - 2 * math.atan(t * ((1 - E * s) / (1 + E * s)) ** (E / 2))
        return math.degrees(phi), math.degrees(th / self.n + self.lon0)
    def px(self, lat, lon): x, y = self.fwd(lat, lon); return (x - self.c) / self.a, (y - self.f) / self.e
    def ll(self, col, row): return self.inv(self.c + col * self.a, self.f + row * self.e)
def load(prefix, p1, p2, lat0, lon0):
    return LCC(p1, p2, lat0, lon0, [float(v) for v in open(prefix + '.tfw').read().split()])
TAC_BW = lambda d: load(d + '/bw_tac/Baltimore-Washington TAC', 45, 33, 38.99166666666667, -77.05)
SEC_W = lambda d: load(d + '/wash_sec/Washington SEC', 38.66666666666666, 33.33333333333334, 38.16666666666666, -75.5)
