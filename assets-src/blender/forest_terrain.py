"""Qorong'u o'rmon relyefi: 512x512 m balandlik xaritasi, yo'llar, soy, tekstura qatlamlari (splat), o'rmon zichligi.

Ishga tushirish:
    blender -b --factory-startup -P assets-src/blender/forest_terrain.py [-- --preview]

Natija (client/public/maps/forest):
    terrain.bin    - Uint16 balandliklar (RES x RES, qatorlar +Z bo'yicha, ustunlar +X bo'yicha); har qatorda
                     qo'shni nuqtalar farqi saqlanadi (delta, mod 65536) - gzip/brotli bir necha barobar yaxshi siqadi
    terrain.json   - o'lcham, balandlik oralig'i, yo'l, soy, ko'prik ma'lumotlari
    splat.png      - R o'tloq, G yo'l/loy, B qoya; o'rmon tagi = 1 - R - G - B
                     (alfa kanal ishlatilmaydi: brauzer uni oldindan ko'paytirib RGB aniqligini buzadi)
    density.png    - o'rmon zichligi (5-bosqichda daraxtlar shu bo'yicha ekiladi)
--preview: Blender'da relyefni teksturalar bilan qurib, render qiladi (assets-src/out/forest_*.png)

Koordinatalar three.js'da: X sharq, Z janub, Y yuqori. Markaz (0,0) - gulxan.
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from common import CLIENT_PUBLIC, OUT_DIR, script_args  # noqa: E402

SIZE = 512.0          # metr
RES = 1025            # nuqtalar (0.5 m qadam)
HALF = SIZE / 2
STEP = SIZE / (RES - 1)
OUT = os.path.join(CLIENT_PUBLIC, 'maps', 'forest')

CASTLE = np.array([0.0, -205.0])   # qasr tepaligi markazi (plato)
PLATEAU_R = 40.0
CASTLE_H = 26.0
CLEARING_R = 21.0                  # to'liq tekis (y = 0) maydon radiusi
GATE = np.array([0.0, -165.0])     # qasr darvozasi (plato janubiy cheti)

rng = np.random.default_rng(7)


# ------------------------------------------------------------------ shovqin (Perlin, numpy)
class Perlin:
    def __init__(self, seed):
        r = np.random.default_rng(seed)
        self.perm = np.tile(r.permutation(256), 2)
        ang = r.random(256) * 2 * np.pi
        self.grad = np.stack([np.cos(ang), np.sin(ang)], 1)

    def __call__(self, x, y):
        xi = np.floor(x).astype(np.int64)
        yi = np.floor(y).astype(np.int64)
        xf, yf = x - xi, y - yi
        xi &= 255
        yi &= 255
        p = self.perm

        def g(ix, iy, dx, dy):
            gi = p[p[ix] + iy] & 255
            gr = self.grad[gi]
            return gr[..., 0] * dx + gr[..., 1] * dy

        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        n00 = g(xi, yi, xf, yf)
        n10 = g(xi + 1, yi, xf - 1, yf)
        n01 = g(xi, yi + 1, xf, yf - 1)
        n11 = g(xi + 1, yi + 1, xf - 1, yf - 1)
        a = n00 + u * (n10 - n00)
        b = n01 + u * (n11 - n01)
        return (a + v * (b - a)) * 1.414


def fbm(noise, x, y, octaves=5, lac=2.03, gain=0.5):
    s, amp, f, norm = 0.0, 1.0, 1.0, 0.0
    for i in range(octaves):
        s = s + amp * noise(x * f + i * 17.3, y * f - i * 9.1)
        norm += amp
        amp *= gain
        f *= lac
    return s / norm


def ridged(noise, x, y, octaves=5):
    s, amp, f, norm = 0.0, 1.0, 1.0, 0.0
    for i in range(octaves):
        n = 1.0 - np.abs(noise(x * f + i * 5.7, y * f + i * 3.3))
        s = s + amp * n * n
        norm += amp
        amp *= 0.5
        f *= 2.1
    return s / norm


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ to'r
coords = np.linspace(-HALF, HALF, RES)
X, Z = np.meshgrid(coords, coords)  # X[row, col] = x(col), Z[row, col] = z(row)
N1, N2, N3, N4 = Perlin(1), Perlin(2), Perlin(3), Perlin(4)

d_fire = np.hypot(X, Z)
d_castle = np.hypot(X - CASTLE[0], Z - CASTLE[1])

# ------------------------------------------------------------------ soy (g'arbdan sharqqa oqadi)
def stream_z(x):
    return -70.0 + 13.0 * np.sin(x / 41.0 + 0.6) + 5.0 * np.sin(x / 14.0 + 1.9)


def stream_bank(x):
    """Qirg'oq sathi: g'arbda baland, sharqda past (suv oqishi uchun)"""
    return 1.6 - x * 0.011


def stream_dist(x, z):
    eps = 0.5
    dz = (stream_z(x + eps) - stream_z(x - eps)) / (2 * eps)
    return np.abs(z - stream_z(x)) / np.sqrt(1 + dz * dz)


d_stream = stream_dist(X, Z)

# ------------------------------------------------------------------ yo'llar (Catmull-Rom)
def catmull(points, step=0.5):
    pts = [np.array(p, float) for p in points]
    pts = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        n = max(2, int(np.linalg.norm(p2 - p1) / step))
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-2])
    return np.array(out)


BRIDGE_X = -14.0
bridge_z = float(stream_z(BRIDGE_X))
# Shimoliy yo'l: maydondan ko'prik orqali qasr darvozasigacha (tepalikda ilon izi)
NORTH_PATH = catmull([
    (0, -16), (-4, -34), (-11, -50), (BRIDGE_X, bridge_z + 9), (BRIDGE_X, bridge_z), (BRIDGE_X + 1, bridge_z - 9),
    (-6, -82), (20, -95), (46, -108), (54, -116), (40, -124), (0, -138), (-26, -148), (-30, -155), (-18, -161), (GATE[0], GATE[1] + 1), tuple(GATE),
])
# Janubiy yo'l: maydondan xarita chetidagi daragacha (yo'lovchilar shu yerdan kelgan)
SOUTH_PATH = catmull([(0, 16), (6, 40), (12, 70), (-4, 105), (-10, 140), (6, 180), (2, 215), (0, 262)])


def stamp_path(path, radius=10.0):
    """Har bir to'r nuqtasi uchun yo'lgacha masofa va eng yaqin yo'l nuqtasi indeksi."""
    dist = np.full(X.shape, np.inf)
    idx = np.full(X.shape, -1, np.int64)
    r = int(radius / STEP) + 1
    for k, (px, pz) in enumerate(path):
        cj = int(round((px + HALF) / STEP))
        ci = int(round((pz + HALF) / STEP))
        i0, i1 = max(ci - r, 0), min(ci + r + 1, RES)
        j0, j1 = max(cj - r, 0), min(cj + r + 1, RES)
        if i0 >= i1 or j0 >= j1:
            continue
        d = np.hypot(X[i0:i1, j0:j1] - px, Z[i0:i1, j0:j1] - pz)
        sub = dist[i0:i1, j0:j1]
        m = d < sub
        sub[m] = d[m]
        idx[i0:i1, j0:j1][m] = k
    return dist, idx


d_npath, i_npath = stamp_path(NORTH_PATH)
d_spath, i_spath = stamp_path(SOUTH_PATH)
d_path = np.minimum(d_npath, d_spath)

# ------------------------------------------------------------------ balandlik
wx = X + 18 * N3(X / 90, Z / 90)
wz = Z + 18 * N3(X / 90 + 31, Z / 90 - 12)
hills = fbm(N1, wx / 150, wz / 150, 5) * 14.0 + fbm(N3, wx / 55, wz / 55, 3) * 3.5
hills *= smoothstep(22, 95, d_fire)                    # maydon atrofi yumshoq
hills *= 0.35 + 0.65 * smoothstep(5, 50, d_stream)     # soy vodiysi
detail = fbm(N2, X / 22, Z / 22, 4) * 0.7 + fbm(N4, X / 6, Z / 6, 3) * 0.12
h = 1.2 + hills + detail * smoothstep(CLEARING_R - 4, CLEARING_R + 12, d_fire)

# Xarita chetidagi tog'lar (chegara); janubiy yo'l joyida dara
p = 6.0
r_edge = (np.abs(X / HALF) ** p + np.abs(Z / HALF) ** p) ** (1 / p)
edge = smoothstep(0.72, 1.0, r_edge)
gorge = smoothstep(5, 26, d_spath) * smoothstep(8, 30, d_stream)
mount = edge ** 1.5 * (34 + 30 * ridged(N2, X / 70, Z / 70)) * gorge
h += mount

# Qasr tepaligi: tekis plato, janubda yumshoqroq, boshqa tomonlarda tik qoya
ang = np.arctan2(Z - CASTLE[1], X - CASTLE[0])          # janub = +pi/2
south = np.clip(np.sin(ang), 0, 1) ** 2
# Plato cheti aylana emas: burchak bo'yicha shovqin (qoyalar chiqib turadi)
r_plat = PLATEAU_R + 5.5 * N2(np.cos(ang) * 1.7 + 3, np.sin(ang) * 1.7) + 2.0 * N4(np.cos(ang) * 5, np.sin(ang) * 5)
r_plat = np.where(np.abs(ang - np.pi / 2) < 0.35, PLATEAU_R, r_plat)  # darvoza oldi tekis
reach = 30 + 46 * south                                 # qiyalik eni
t = np.clip((d_castle - r_plat) / reach, 0, 1)
hill = CASTLE_H * (1 - smoothstep(0, 1, t) ** (0.8 + 0.6 * (1 - south)))
hill += (ridged(N4, X / 25, Z / 25) - 0.5) * 6 * (t > 0) * (t < 1) * (1 - south)
h = np.maximum(h, hill + 0.6 * N1(X / 9, Z / 9) * (d_castle > r_plat))
plateau = d_castle < r_plat
h[plateau] = CASTLE_H + fbm(N2, X[plateau] / 12, Z[plateau] / 12, 2) * 0.15

# Gulxan maydoni: to'liq tekis (y = 0), chetlari silliq
f = 1 - smoothstep(CLEARING_R, CLEARING_R + 16, d_fire)
h = h * (1 - f)


def sample(arr, x, z):
    j = np.clip(np.round((np.asarray(x) + HALF) / STEP).astype(int), 0, RES - 1)
    i = np.clip(np.round((np.asarray(z) + HALF) / STEP).astype(int), 0, RES - 1)
    return arr[i, j]


def smooth1d(a, win):
    k = np.ones(win) / win
    pad = np.pad(a, (win // 2, win - 1 - win // 2), mode='edge')
    return np.convolve(pad, k, mode='valid')


def flatten_along(path, dist, idx, h, core=1.7, edge=5.5, win=41):
    """Yo'l bo'ylab tekislash: ko'ndalang qiyalik yo'q, bo'ylama balandlik silliq."""
    ph = smooth1d(sample(h, path[:, 0], path[:, 1]), win)
    ph = smooth1d(ph, win)
    w = 1 - smoothstep(core, edge, dist)
    ok = idx >= 0
    target = np.where(ok, ph[np.clip(idx, 0, len(ph) - 1)], h)
    return h * (1 - w) + target * w, ph


h, npath_h = flatten_along(NORTH_PATH, d_npath, i_npath, h, core=1.6, edge=4.6)
h, spath_h = flatten_along(SOUTH_PATH, d_spath, i_spath, h)
# Maydon ichida yo'l ham y = 0 da qoladi
h = h * (1 - f)

# Soy o'zani (eng oxirida - ko'prik ostida yo'lni ham kesadi)
bank = stream_bank(X)
d_s = d_stream + 0.6 * N2(X / 7, Z / 7)
profile = np.where(d_s < 2.0, -1.25, np.where(d_s < 4.8, -1.25 + 1.45 * smoothstep(2.0, 4.8, d_s), 0.2 + (d_s - 4.8) * 0.06))
valley = bank + profile
wv = 1 - smoothstep(5.0, 26.0, d_s)
# Vodiy tubi qirg'oq sathiga keltiriladi (ko'tariladi ham, pasaytiriladi ham) - suv hech qayerda "osilib" qolmaydi
h = np.where(d_s < 4.8, valley, h * (1 - wv) + valley * wv)

# ------------------------------------------------------------------ qiyalik va qatlamlar
gz, gx = np.gradient(h, STEP)
slope = np.hypot(gx, gz)
n_a = fbm(N3, X / 9, Z / 9, 3)
n_b = fbm(N4, X / 3.5, Z / 3.5, 2)

rock = smoothstep(0.6, 0.95, slope + 0.15 * n_a)
rock = np.maximum(rock, smoothstep(0.55, 0.85, edge + 0.25 * n_a) * smoothstep(0.35, 0.6, slope + 0.2 * n_b))
path_w = 1 - smoothstep(1.1, 3.0, d_path + 0.9 * n_b + 0.5 * n_a)
mud = 1 - smoothstep(2.6, 6.5, d_stream + 1.2 * n_a)
fire_dirt = 1 - smoothstep(1.4, 3.4, d_fire + 0.6 * n_b)
trampled = (1 - smoothstep(3.0, 10.0, d_fire)) * smoothstep(-0.15, 0.25, n_b + 0.1)
dirt = np.clip(np.maximum.reduce([path_w, mud, fire_dirt, trampled * 0.8]), 0, 1)
dirt = np.maximum(dirt, (d_castle < r_plat + 2) * 0.45)

density_noise = fbm(N1, X / 55 + 7, Z / 55 - 3, 4)
meadow = smoothstep(-0.08, -0.3, density_noise)                      # siyrak o'tloqlar
grass = np.maximum(1 - smoothstep(CLEARING_R - 2, CLEARING_R + 14, d_fire + 5 * n_a), meadow * 0.9)
grass = np.maximum(grass, (1 - smoothstep(3.0, 7.0, d_path)) * 0.55)  # yo'l chetidagi o't

w_rock = rock
w_dirt = dirt * (1 - w_rock)
w_grass = grass * (1 - w_rock) * (1 - w_dirt)
w_forest = np.clip(1 - w_rock - w_dirt - w_grass, 0, 1)
W = np.stack([w_grass, w_forest, w_dirt, w_rock], -1)
W /= W.sum(-1, keepdims=True)
SPLAT = W[..., [0, 2, 3]]  # o'rmon tagi qoldiqdan tiklanadi

density = (0.55 + 0.6 * density_noise) * (1 - meadow * 0.85)
density *= smoothstep(CLEARING_R + 6, CLEARING_R + 22, d_fire)
density *= smoothstep(3.5, 8.0, d_path) * smoothstep(5.5, 10.0, d_stream)
density *= 1 - smoothstep(0.5, 0.9, slope) * 0.8
density *= smoothstep(r_plat + 3, r_plat + 12, d_castle)
density = np.clip(density, 0, 1)

# ------------------------------------------------------------------ eksport
os.makedirs(OUT, exist_ok=True)
hmin, hmax = float(h.min()), float(h.max())
q = np.round((h - hmin) / (hmax - hmin) * 65535).astype(np.int64)
delta = np.concatenate([q[:, :1], np.diff(q, axis=1)], axis=1) % 65536
delta.astype('<u2').tofile(os.path.join(OUT, 'terrain.bin'))


def save_png(path, arr, channels):
    import bpy
    rows, cols = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), cols, rows, alpha=False, float_buffer=False)
    rgba = np.ones((rows, cols, 4), np.float32)
    if channels == 1:
        rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = arr
    else:
        rgba[..., :channels] = arr
    img.colorspace_settings.name = 'Non-Color'
    # Blender rasmlari pastdan yuqoriga saqlanadi; biz PNG'da 0-qator = -Z bo'lishini xohlaymiz
    img.pixels.foreach_set(np.ascontiguousarray(np.flipud(rgba)).ravel())
    img.update()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


# 1024 o'lchamga (oxirgi qator/ustun tashlanadi - farqi 0.5 m)
save_png(os.path.join(OUT, 'splat.png'), SPLAT[:-1, :-1], 3)
save_png(os.path.join(OUT, 'density.png'), density[::2, ::2][:512, :512], 1)

stream_xs = np.arange(-HALF, HALF + 0.1, 2.0)
water = [[round(float(x), 2), round(float(stream_z(x)), 2), round(float(stream_bank(x) - 0.55), 3)] for x in stream_xs]
bridge_dir = NORTH_PATH[np.argmin(np.hypot(NORTH_PATH[:, 0] - BRIDGE_X, NORTH_PATH[:, 1] - bridge_z)) + 6] - \
             NORTH_PATH[np.argmin(np.hypot(NORTH_PATH[:, 0] - BRIDGE_X, NORTH_PATH[:, 1] - bridge_z)) - 6]
bridge_yaw = math.atan2(-bridge_dir[0], -bridge_dir[1])
meta = {
    'size': SIZE, 'res': RES, 'hmin': hmin, 'hmax': hmax, 'encoding': 'row-delta-u16',
    'layers': ['forrest_ground_01', 'forest_leaves_02', 'forest_ground_04', 'mossy_rock'],
    'stream': {'points': water, 'width': 4.6},
    'bridge': {'position': [BRIDGE_X, round(float(stream_bank(BRIDGE_X)) + 0.35, 3), round(bridge_z, 3)], 'yaw': round(bridge_yaw, 4), 'length': 11.0, 'width': 2.6},
    'paths': {
        'north': [[round(float(x), 2), round(float(z), 2)] for x, z in NORTH_PATH[::8]],
        'south': [[round(float(x), 2), round(float(z), 2)] for x, z in SOUTH_PATH[::8]],
    },
    'castle': {'center': [float(CASTLE[0]), CASTLE_H, float(CASTLE[1])], 'radius': PLATEAU_R, 'gate': [float(GATE[0]), CASTLE_H, float(GATE[1])]},
}
with open(os.path.join(OUT, 'terrain.json'), 'w') as fp:
    json.dump(meta, fp, indent=1)
np.save(os.path.join(OUT_DIR, 'forest_height.npy'), h.astype(np.float32))
print(f'[terrain] h: {hmin:.2f} .. {hmax:.2f} m, ko\'prik ({BRIDGE_X}, {bridge_z:.1f}), yo\'l uzunligi {len(NORTH_PATH) * 0.5:.0f} m')

if '--preview' in script_args():
    import forest_preview
    forest_preview.render(h, STEP, HALF, meta)
