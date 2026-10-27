"""Oy teksturalari: NASA SVS CGI Moon Kit (public domain, https://svs.gsfc.nasa.gov/4720/).
Xom fayllar assets-src/moon/ ga yuklanadi:
    lroc_color_poles_4k.tif  (LRO WAC rangli mozaika)
    ldem_4.tif               (LOLA balandlik, 4 piksel/gradus, km)
Ishga tushirish: python -I tools/moon-textures.py
Natija: client/public/maps/forest/textures/moon_color.jpg (2048x1024), moon_normal.jpg (tangent fazo, ekvirektangular)
"""
import os
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'assets-src', 'moon')
OUT = os.path.join(ROOT, 'client', 'public', 'maps', 'forest', 'textures')
W, H = 2048, 1024

col = Image.open(os.path.join(SRC, 'lroc_color_poles_4k.tif'))
if col.mode not in ('RGB', 'L'):
    a = np.asarray(col).astype(np.float64)
    a = a / a.max() * 255
    col = Image.fromarray(a.astype(np.uint8))
col.convert('RGB').resize((W, H), Image.LANCZOS).save(os.path.join(OUT, 'moon_color.jpg'), quality=92)

h = np.asarray(Image.open(os.path.join(SRC, 'ldem_4.tif')), np.float64)  # km
h = np.asarray(Image.fromarray(h.astype(np.float32)).resize((W, H), Image.BICUBIC), np.float64)
R = 1737.4  # km
lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
dx = 2 * np.pi * R / W * np.cos(lat)[:, None]  # bir piksel eni (km), qutbga qarab torayadi
dy = np.pi * R / H
gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * np.maximum(dx, 0.05))
gy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) / (2 * dy)
gy[0], gy[-1] = 0, 0
k = 6.0  # relyefni biroz kuchaytirish (uzoqdan ham ko'rinsin)
n = np.stack([-gx * k, -gy * k, np.ones_like(h)], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray(((n * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)).save(os.path.join(OUT, 'moon_normal.jpg'), quality=92)
print('moon_color.jpg, moon_normal.jpg tayyor; balandlik', round(h.min(), 2), '..', round(h.max(), 2), 'km')
