"""O'rmon relyefining tepadan ko'rinishi (tekshirish uchun): python -I tools/terrain-map.py -> assets-src/out/forest_map.png"""
import json
import os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
F = os.path.join(ROOT, 'client', 'public', 'maps', 'forest')
h = np.load(os.path.join(ROOT, 'assets-src', 'out', 'forest_height.npy'))
gz, gx = np.gradient(h, 0.5)
n = np.stack([-gx, np.ones_like(h), -gz], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
L = np.array([-0.5, 0.6, -0.6]); L /= np.linalg.norm(L)
shade = np.clip(n @ L, 0, 1)
sp = np.asarray(Image.open(os.path.join(F, 'splat.png')).convert('RGB')).astype(float) / 255
sp = np.pad(sp, ((0, 1), (0, 1), (0, 0)), mode='edge')
forest = np.clip(1 - sp.sum(-1), 0, 1)[..., None]
img = sp @ np.array([[0.45, 0.55, 0.22], [0.55, 0.38, 0.22], [0.55, 0.55, 0.55]]) + forest * np.array([0.22, 0.3, 0.14])
den = np.asarray(Image.open(os.path.join(F, 'density.png')).convert('L')).astype(float) / 255
den = np.pad(np.kron(den, np.ones((2, 2))), ((0, 1), (0, 1)), mode='edge')
img *= (1 - 0.5 * den[..., None])
img *= (0.3 + 0.9 * shade[..., None])
c = (np.floor(h / 5) % 2) != (np.floor(np.roll(h, 1, 0) / 5) % 2)
img[c] *= 0.65
m = json.load(open(os.path.join(F, 'terrain.json')))
for x, z, y in m['stream']['points']:
    j, i = int((x + 256) / 0.5), int((z + 256) / 0.5)
    img[max(i - 3, 0):i + 4, max(j - 3, 0):j + 4] = [0.15, 0.3, 0.6]
Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((800, 800), Image.LANCZOS).save(
    os.path.join(ROOT, 'assets-src', 'out', 'forest_map.png'))
