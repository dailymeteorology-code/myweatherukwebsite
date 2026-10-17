"""MWUK — MyWeatherUK's own blended model — and an animation of it over the outlook.

    python mwuk.py out-2026-10-18.json "Thunderstorm Outlook.jpg" out.mp4

MWUK is built from the same five AWS models and weights as the outlook (blend.py,
fields cached in <out>.fields.pkl), hour by hour across the outlook day:
  • rain    — weighted mean of the models' precipitation rates (mm/h); ECMWF and the
              Met Office Global (3-hourly here) are interpolated in time
  • lightning density (flashes per km² per hour) — UKV's explicit lightning where it has
              it, otherwise each model's convective signal (CAPE × rain × CIN) scaled to a
              density; blended with the same weights
Strikes on the animation are drawn at random positions in proportion to that density
(a fixed seed, so the same run always gives the same picture): they show where the
model puts lightning, not observed strikes.

The model is saved as <out>-mwuk.npz (rain, lightning, times, grid).
"""
import json
import math
import pickle
import subprocess
import sys
from datetime import timedelta
from zoneinfo import ZoneInfo

import urllib.request

import imageio_ffmpeg
from matplotlib.path import Path
from scipy.ndimage import gaussian_filter
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import blend as B

GW, GH = 640, 760                         # the graphic's own units
WRAP = (190, 20, 450, 630)                # map box (x, y, w, h) in a region view
MAP = {'lonMin': -10.8, 'lonMax': 2.5, 'latMin': 49.5, 'latMax': 61.0}
REGION = {'lonMin': -5.8, 'lonMax': 1.8, 'latMin': 50.0, 'latMax': 52.5}     # South England
OUT_W = 1080
S = OUT_W / GW
OUT_H = int(round(GH * S / 2) * 2)
FPH, FPS, HOLD = 6, 12, 18                 # frames per forecast hour, frame rate, end hold
# cards on the left of the graphic (graphic units) — no rain is drawn over them
CARDS = [(0, 0, 640, 76), (20, 80, 372, 124), (20, 126, 252, 152), (20, 158, 192, 394), (20, 398, 222, 536), (20, 540, 242, 632)]
STOPS = [(0.05, (150, 210, 255)), (0.3, (95, 175, 240)), (0.6, (50, 155, 230)), (1.0, (30, 160, 205)), (1.6, (60, 200, 180)),
         (2.2, (120, 215, 120)), (3.0, (205, 220, 90)), (4.5, (245, 205, 60)), (6.5, (255, 165, 45)), (9, (245, 110, 40)),
         (13, (225, 65, 50)), (20, (185, 35, 95)), (30, (150, 55, 165))]
merc = lambda la: np.log(np.tan(np.pi / 4 + np.radians(la) / 2))
inv_merc = lambda y: np.degrees(2 * np.arctan(np.exp(y)) - np.pi / 2)
Y_TOP, Y_BOT = merc(MAP['latMax']), merc(MAP['latMin'])


def to_norm(lon, lat):
    return (lon - MAP['lonMin']) / (MAP['lonMax'] - MAP['lonMin']), (Y_TOP - merc(lat)) / (Y_TOP - Y_BOT)


def zoom():
    """The tool's region zoom: map (0..1) -> map-box pixels, x = tx + k*450*nx, y = ty + k*666*ny."""
    x0, y0 = to_norm(REGION['lonMin'], REGION['latMax']); x1, y1 = to_norm(REGION['lonMax'], REGION['latMin'])
    k = min(6, max(1, min(1 / (x1 - x0), 1 / (y1 - y0)) * 0.86))
    return k, 450 * (0.5 - (x0 + x1) / 2 * k), 666 * (0.5 - (y0 + y1) / 2 * k)


def build_model(pkl, hours):
    data = pickle.load(open(pkl, 'rb'))
    ny, nx = B.GLAT.shape
    rain = np.zeros((len(hours), ny, nx), np.float32)
    light = np.zeros((len(hours), ny, nx), np.float32)

    def at(steps, vt, key):
        """A model's field at vt, linearly interpolated between its own times."""
        ts = sorted(t for t, f in steps.items() if key in f)
        if not ts or vt < ts[0] - timedelta(hours=2) or vt > ts[-1] + timedelta(hours=2):
            return None
        if vt in steps and key in steps[vt]:
            return steps[vt][key]
        before = max([t for t in ts if t <= vt], default=ts[0]); after = min([t for t in ts if t >= vt], default=ts[-1])
        if before == after:
            return steps[before][key]
        w = (vt - before) / (after - before)
        return steps[before][key] * (1 - w) + steps[after][key] * w

    for i, vt in enumerate(hours):
        sw, sr, sl = 0.0, 0, 0
        for m, d in data.items():
            pr, cape = at(d['steps'], vt, 'precip'), at(d['steps'], vt, 'cape')
            if pr is None or cape is None:
                continue
            cin = at(d['steps'], vt, 'cin')
            prox = B.s(cape, 150, 800) * B.s(pr, 0.5, 4.0) * (np.clip(1 + cin / 250, 0.3, 1) if cin is not None else 1)
            dens = prox * 0.15
            if m == 'ukv':
                lt = at(d['steps'], vt, 'lightning')
                if lt is not None:
                    dens = np.maximum(dens, lt)
            w = B.WEIGHTS[m]
            sw += w; sr = sr + w * pr; sl = sl + w * dens
        if sw:
            # the coarser models sit on 25 km cells: smooth so the blend reads as rain, not tiles
            rain[i], light[i] = gaussian_filter(sr / sw, 1.6), gaussian_filter(sl / sw, 1.2)
    return rain, light


def polys_of(gj):
    out = []
    for ft in gj['features']:
        g = ft['geometry']
        for p in ([g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']):
            out.append(Path(np.array(p[0])))
    return out


def visible_mask(lon, lat, sel):
    """Where the South England view actually shows map: sea, France and the southern counties
    (the rest of the UK's land is hidden in that view, so no rain is drawn over it)."""
    pts = np.c_[lon[sel], lat[sel]]
    uk = json.loads(urllib.request.urlopen('https://raw.githubusercontent.com/georgique/world-geojson/develop/countries/united_kingdom.json').read())
    south = json.load(open('../../public/static-data/south-england.geo.json'))
    on_uk = np.zeros(len(pts), bool); in_south = np.zeros(len(pts), bool)
    for p in polys_of(uk):
        on_uk |= p.contains_points(pts)
    for p in polys_of(south):
        in_south |= p.contains_points(pts)
    ok = np.zeros(lon.shape, bool)
    ok[sel] = ~on_uk | in_south
    return ok


def palette(v):
    rgb = np.zeros(v.shape + (3,), np.float32)
    xs = np.array([s[0] for s in STOPS]); cs = np.array([s[1] for s in STOPS], np.float32)
    idx = np.clip(np.searchsorted(xs, v) - 1, 0, len(xs) - 2)
    t = np.clip((v - xs[idx]) / (xs[idx + 1] - xs[idx]), 0, 1)[..., None]
    rgb[:] = cs[idx] * (1 - t) + cs[idx + 1] * t
    return rgb


def main():
    out_json, base_img, out_mp4 = sys.argv[1], sys.argv[2], sys.argv[3]
    res = json.load(open(out_json))
    hours = B.uk_hours(res['day'])
    rain, light = build_model(out_json + '.fields.pkl', hours)
    np.savez_compressed(out_json.replace('.json', '-mwuk.npz'), rain=rain, lightning=light,
                        times=np.array([h.isoformat() for h in hours]), lat=B.LAT, lon=B.LON)
    print(f'MWUK: rain max {rain.max():.1f} mm/h, lightning max {light.max():.2f} /km²/h')

    # pixel -> grid lookup for the map box, once
    k, tx, ty = zoom()
    X, Y = np.meshgrid(np.arange(OUT_W) / S, np.arange(OUT_H) / S)
    inside = (X >= WRAP[0]) & (X < WRAP[0] + WRAP[2]) & (Y >= WRAP[1]) & (Y < WRAP[1] + WRAP[3])
    for (a, b, c, d) in CARDS:
        inside &= ~((X >= a) & (X <= c) & (Y >= b) & (Y <= d))
    nx_, ny_ = (X - WRAP[0] - tx) / (k * 450), (Y - WRAP[1] - ty) / (k * 666)
    lon = MAP['lonMin'] + nx_ * (MAP['lonMax'] - MAP['lonMin'])
    lat = inv_merc(Y_TOP - ny_ * (Y_TOP - Y_BOT))
    fi, fj = (lat - B.LAT[0]) / 0.05, (lon - B.LON[0]) / 0.05
    inside &= (fi >= 0) & (fi < len(B.LAT) - 1) & (fj >= 0) & (fj < len(B.LON) - 1)
    inside &= visible_mask(lon, lat, inside)
    i0, j0 = np.clip(fi.astype(int), 0, len(B.LAT) - 2), np.clip(fj.astype(int), 0, len(B.LON) - 2)
    ti, tj = fi - i0, fj - j0

    def sample(field):
        return (field[i0, j0] * (1 - ti) * (1 - tj) + field[i0, j0 + 1] * (1 - ti) * tj
                + field[i0 + 1, j0] * ti * (1 - tj) + field[i0 + 1, j0 + 1] * ti * tj)

    def to_px(lo, la):
        n_x, n_y = to_norm(lo, la)
        return (WRAP[0] + tx + k * 450 * n_x) * S, (WRAP[1] + ty + k * 666 * n_y) * S

    # strikes: Poisson per grid cell and hour, each with a time inside its hour
    rng = np.random.default_rng(20261018)
    cell_km2 = (5.56 * 5.56 * np.cos(np.radians(B.GLAT)))
    strikes = []
    for h in range(len(hours)):
        n = rng.poisson(np.minimum(light[h] * cell_km2 * 0.3, 8))
        for jj, ii in zip(*np.nonzero(n)):
            for _ in range(n[jj, ii]):
                la = B.LAT[jj] + rng.uniform(-0.025, 0.025); lo = B.LON[ii] + rng.uniform(-0.025, 0.025)
                px, py = to_px(lo, la)
                gx, gy = px / S, py / S
                if not (WRAP[0] <= gx < WRAP[0] + WRAP[2] and WRAP[1] <= gy < WRAP[1] + WRAP[3]):
                    continue
                if any(a <= gx <= c and b <= gy <= d for (a, b, c, d) in CARDS):
                    continue
                yi, xi = int(round(py)), int(round(px))
                if not (0 <= yi < OUT_H and 0 <= xi < OUT_W and inside[yi, xi]):
                    continue
                strikes.append((h + rng.uniform(0, 1), px, py))
    print(f'{len(strikes)} modelled strikes')

    base = Image.open(base_img).convert('RGB').resize((OUT_W, OUT_H), Image.LANCZOS).convert('RGBA')
    fb = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(15 * S))
    fs = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(9 * S))
    tz = ZoneInfo('Europe/London')
    total = (len(hours) - 1) * FPH + 1
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    proc = subprocess.Popen([ff, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{OUT_W}x{OUT_H}', '-r', str(FPS),
                             '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'slow', '-movflags', '+faststart', out_mp4],
                            stdin=subprocess.PIPE)
    for f in range(total + HOLD):
        t = min(f, total - 1) / FPH                                  # forecast hour (fractional)
        h0 = min(int(t), len(hours) - 2); w = t - h0
        r = sample(rain[h0] * (1 - w) + rain[h0 + 1] * w)
        layer = np.zeros((OUT_H, OUT_W, 4), np.uint8)
        show = inside & (r > 0.05)
        layer[..., :3] = palette(np.maximum(r, 0.05)).astype(np.uint8)
        layer[..., 3] = np.where(show, np.clip(150 + r * 6, 150, 230), 0).astype(np.uint8)
        frame = Image.alpha_composite(base, Image.fromarray(layer, 'RGBA').filter(ImageFilter.GaussianBlur(0.6)))
        # lightning: a white flash that fades to amber over ~40 minutes
        glow = Image.new('RGBA', (OUT_W, OUT_H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
        dots = Image.new('RGBA', (OUT_W, OUT_H), (0, 0, 0, 0)); dd = ImageDraw.Draw(dots)
        for ts, px, py in strikes:
            age = t - ts
            if 0 <= age < 0.7:
                a = 1 - age / 0.7
                rad = (3.2 if age < 0.12 else 2.2) * S
                gd.ellipse([px - rad * 3, py - rad * 3, px + rad * 3, py + rad * 3], fill=(255, 220, 90, int(110 * a)))
                col = (255, 255, 255, int(255 * a)) if age < 0.12 else (255, 214, 64, int(240 * a))
                dd.ellipse([px - rad, py - rad, px + rad, py + rad], fill=col, outline=(40, 25, 0, int(200 * a)))
        frame = Image.alpha_composite(frame, glow.filter(ImageFilter.GaussianBlur(4 * S)))
        frame = Image.alpha_composite(frame, dots)
        # model + time chip and a small key, top right of the map
        d = ImageDraw.Draw(frame)
        when = (hours[0] + timedelta(hours=t)).astimezone(tz)
        label = f"MWUK   {when:%a %H:%M}".upper()
        bx1, by0 = (GW - 14) * S, 92 * S
        tw = d.textlength(label, font=fb)
        d.rounded_rectangle([bx1 - tw - 22 * S, by0, bx1, by0 + 26 * S], radius=13 * S, fill=(10, 14, 32, 225), outline=(125, 211, 252, 200), width=max(1, int(S)))
        d.text((bx1 - tw - 11 * S, by0 + 5 * S), label, font=fb, fill=(255, 255, 255, 255))
        ky = by0 + 32 * S
        kx0 = bx1 - 150 * S
        d.rounded_rectangle([kx0, ky, bx1, ky + 34 * S], radius=9 * S, fill=(10, 14, 32, 215))
        for n in range(100):
            v = 0.1 * (300 ** (n / 99))
            c = tuple(int(x) for x in palette(np.array([v]))[0])
            d.rectangle([kx0 + 8 * S + n * 0.8 * S, ky + 6 * S, kx0 + 8 * S + (n + 1) * 0.8 * S, ky + 13 * S], fill=c + (255,))
        d.text((kx0 + 8 * S, ky + 16 * S), 'RAIN  light → heavy', font=fs, fill=(226, 232, 240, 255))
        d.ellipse([bx1 - 50 * S, ky + 6 * S, bx1 - 43 * S, ky + 13 * S], fill=(255, 214, 64, 255))
        d.text((bx1 - 40 * S, ky + 5 * S), 'STRIKES', font=fs, fill=(226, 232, 240, 255))
        d.text((bx1 - 40 * S, ky + 16 * S), '(model)', font=fs, fill=(148, 163, 184, 255))
        proc.stdin.write(np.asarray(frame.convert('RGB')).tobytes())
    proc.stdin.close(); proc.wait()
    print('wrote', out_mp4, f'{(total + HOLD) / FPS:.1f}s')


if __name__ == '__main__':
    main()
