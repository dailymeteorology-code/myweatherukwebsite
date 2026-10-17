"""Render MWUK rain + lightning as transparent frames in the storm-outlook tool's own map space.

    python mwuk_frames.py out-2026-10-18.json

The tool draws its map and risk areas in a 0..1 "map" space (Mercator over the tool's UK box,
-10.8..2.5°E, 49.5..61°N). These frames are rendered in exactly that space over a rectangle of
it, so the browser places them with the tool's own zoom and they register with the coastline and
the risk areas by construction. Output: server/uploads/mwukshot/f_NNN.png + manifest.json.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import mwuk as M          # sets the ~2 km grid before importing blend
B = M.B

OUT = os.path.join('..', '..', 'server', 'uploads', 'mwukshot')
FPH = 6                    # frames per forecast hour


def main():
    out_json = sys.argv[1]
    res = json.load(open(out_json))
    hours = B.uk_hours(res['day'])
    rain, light = M.build_model(out_json.replace('.json', '-mwuk-fields.pkl'), hours)

    # the frame rectangle in map space = the model grid's extent
    nx0, ny0 = M.to_norm(B.LON[0], B.LAT[-1]); nx1, ny1 = M.to_norm(B.LON[-1], B.LAT[0])
    W = 1600
    Hh = int(round(W * (ny1 - ny0) * 666 / ((nx1 - nx0) * 450)))
    cx = (np.arange(W) + 0.5) / W; cy = (np.arange(Hh) + 0.5) / Hh
    lon = M.MAP['lonMin'] + (nx0 + cx * (nx1 - nx0)) * (M.MAP['lonMax'] - M.MAP['lonMin'])
    lat = M.inv_merc(M.Y_TOP - (ny0 + cy * (ny1 - ny0)) * (M.Y_TOP - M.Y_BOT))
    LON2, LAT2 = np.meshgrid(lon, lat)
    fi, fj = (LAT2 - B.LAT[0]) / B.STEP, (LON2 - B.LON[0]) / B.STEP
    i0 = np.clip(fi.astype(int), 0, len(B.LAT) - 2); j0 = np.clip(fj.astype(int), 0, len(B.LON) - 2)
    ti, tj = np.clip(fi - i0, 0, 1), np.clip(fj - j0, 0, 1)

    def sample(f):
        return (f[i0, j0] * (1 - ti) * (1 - tj) + f[i0, j0 + 1] * (1 - ti) * tj + f[i0 + 1, j0] * ti * (1 - tj) + f[i0 + 1, j0 + 1] * ti * tj)

    # strikes in frame pixels (same seeded Poisson recipe as mwuk.py)
    rng = np.random.default_rng(20261018)
    cell = (B.STEP * 111.2) ** 2 * np.cos(np.radians(B.GLAT))
    strikes = []
    for h in range(len(hours)):
        n = rng.poisson(np.minimum(light[h] * cell * 0.3, 8))
        for jj, ii in zip(*np.nonzero(n)):
            for _ in range(n[jj, ii]):
                la = B.LAT[jj] + rng.uniform(-B.STEP / 2, B.STEP / 2); lo = B.LON[ii] + rng.uniform(-B.STEP / 2, B.STEP / 2)
                x, y = M.to_norm(lo, la)
                strikes.append((h + rng.uniform(0, 1), (x - nx0) / (nx1 - nx0) * W, (y - ny0) / (ny1 - ny0) * Hh))
    print(len(strikes), 'strikes')

    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    total = (len(hours) - 1) * FPH + 1
    # the map is zoomed ~1.5x in the South England view, so dots are sized for that
    R = 2.6 * W / 1600
    for f in range(total):
        t = f / FPH
        h0 = min(int(t), len(hours) - 2); w = t - h0
        r = sample(rain[h0] * (1 - w) + rain[h0 + 1] * w)
        img = np.zeros((Hh, W, 4), np.uint8)
        img[..., :3] = M.palette(np.maximum(r, 0.05)).astype(np.uint8)
        img[..., 3] = np.where(r > 0.05, np.clip(150 + r * 6, 150, 230), 0).astype(np.uint8)
        frame = Image.fromarray(img, 'RGBA').filter(ImageFilter.GaussianBlur(0.7))
        glow = Image.new('RGBA', (W, Hh), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
        dots = Image.new('RGBA', (W, Hh), (0, 0, 0, 0)); dd = ImageDraw.Draw(dots)
        for ts, px, py in strikes:
            age = t - ts
            if 0 <= age < 0.7:
                a = 1 - age / 0.7
                rad = R * (1.4 if age < 0.12 else 1.0)
                gd.ellipse([px - rad * 3, py - rad * 3, px + rad * 3, py + rad * 3], fill=(255, 220, 90, int(110 * a)))
                col = (255, 255, 255, int(255 * a)) if age < 0.12 else (255, 214, 64, int(240 * a))
                dd.ellipse([px - rad, py - rad, px + rad, py + rad], fill=col, outline=(40, 25, 0, int(200 * a)))
        frame = Image.alpha_composite(frame, glow.filter(ImageFilter.GaussianBlur(R * 2)))
        frame = Image.alpha_composite(frame, dots)
        frame.save(os.path.join(OUT, f'f_{f:03d}.png'), optimize=False)
    json.dump({'rect': [nx0, ny0, nx1, ny1], 'frames': total, 'fph': FPH, 'start': hours[0].isoformat()},
              open(os.path.join(OUT, 'manifest.json'), 'w'))
    print('frames', total, 'rect', [round(v, 4) for v in (nx0, ny0, nx1, ny1)])


if __name__ == '__main__':
    main()
