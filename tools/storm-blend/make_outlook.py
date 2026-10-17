"""Turn a blend.py result into a filled-in Thunderstorm Outlook and save it to the
Graphic Studio (WeatherGraphic entity), ready to open with "Load Saved".

    python make_outlook.py out-2026-10-18.json [--dry-run]

Everything on the graphic comes from the blend:
  • risk areas   — the blend traced at each band of the tool's scale
                   (TSTM 5, MRGL 12, SLGT 22, ENH 35, MDT 50, HIGH 65 %)
  • timeline     — the blend's UK peak in each 3-hour window, 06:00 → 06:00
  • hazards      — lightning always; hail / flash flooding / strong winds only when
                   the models' CAPE, UKV hail, rain rates or gusts inside the risk area
                   reach the thresholds below
  • confidence   — from how far the five models disagree inside the risk area
  • discussion   — where, when, the hazards and which models drive it
"""
import json
import math
import sys
import urllib.request
from datetime import datetime, timedelta

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter, maximum_filter

LEVELS = [(5, 'Very Low'), (12, 'Low'), (22, 'Marginal'), (35, 'Slight'), (50, 'Moderate'), (65, 'High')]
REGION = 'south'          # South England view: land cut to the real southern counties
BBOX = {'lonMin': -10.8, 'lonMax': 2.5, 'latMin': 49.5, 'latMax': 61.0}       # the tool's MAP_BBOX
merc = lambda la: math.log(math.tan(math.pi / 4 + math.radians(la) / 2))
Y_TOP, Y_BOT = merc(BBOX['latMax']), merc(BBOX['latMin'])
API = 'http://localhost:8787'

# Places for the discussion (lat, lon, name)
PLACES = [(51.28, 1.08, 'Kent'), (50.9, -0.3, 'Sussex'), (50.95, -1.4, 'Hampshire'), (51.5, -0.12, 'London'), (51.75, 0.6, 'Essex'),
          (52.2, 1.2, 'Suffolk'), (52.65, 1.1, 'Norfolk'), (50.4, -4.1, 'Devon'), (50.3, -5.0, 'Cornwall'), (51.48, -3.18, 'south Wales'),
          (52.5, -1.9, 'the Midlands'), (53.5, -2.25, 'north-west England'), (53.8, -1.5, 'Yorkshire'), (54.97, -1.6, 'north-east England'),
          (55.9, -4.25, 'western Scotland'), (56.0, -3.2, 'eastern Scotland'), (57.5, -4.2, 'northern Scotland'), (54.6, -5.9, 'Northern Ireland'),
(51.6, 2.2, 'the southern North Sea'), (49.7, 0.6, 'the eastern Channel')]


def and_list(xs):
    xs = list(xs)
    return ', '.join(xs[:-1]) + f' and {xs[-1]}' if len(xs) > 1 else (xs[0] if xs else '')


def to_norm(lon, lat):
    return [round((lon - BBOX['lonMin']) / (BBOX['lonMax'] - BBOX['lonMin']), 5), round((Y_TOP - merc(lat)) / (Y_TOP - Y_BOT), 5)]


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    n = np.hypot(*ab) or 1e-12
    d = [abs(np.cross(ab, np.array(p) - a)) / n for p in pts[1:-1]]
    i = int(np.argmax(d)) + 1
    if d[i - 1] > eps:
        return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]


def rdp_closed(ring, eps):
    """RDP for a closed ring: split at the point farthest from the start, simplify both halves."""
    p0 = np.array(ring[0])
    k = int(np.argmax([np.hypot(*(np.array(p) - p0)) for p in ring]))
    return rdp(ring[:k + 1], eps)[:-1] + rdp(ring[k:], eps)


REGIONS = {'uk': None, 'south': {'lonMin': -5.8, 'lonMax': 1.8, 'latMin': 50.0, 'latMax': 52.5}}
WRAP_W, WRAP_H, WRAP_TOP, FOOTER_TOP = 450, 666, 20, 650      # the tool's map box and the top of its footer band


def visible_norm_rect(region):
    """The part of the map (0..1 map coordinates) visible in the tool's map box above the footer
    band, using the tool's own region-zoom formula."""
    bb = REGIONS.get(region)
    if not bb:
        k, tx, ty = 1, 0, 0
    else:
        x0, y0 = to_norm(bb['lonMin'], bb['latMax']); x1, y1 = to_norm(bb['lonMax'], bb['latMin'])
        k = min(6, max(1, min(1 / max(1e-3, x1 - x0), 1 / max(1e-3, y1 - y0)) * 0.86))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        tx, ty = WRAP_W * (0.5 - cx * k), WRAP_H * (0.5 - cy * k)
    ymax_px = FOOTER_TOP - WRAP_TOP
    return (-tx / (WRAP_W * k), -ty / (WRAP_H * k), (WRAP_W - tx) / (WRAP_W * k), (ymax_px - ty) / (WRAP_H * k))


def clip_rect(ring, r):
    """Sutherland-Hodgman clip of a polygon (map coordinates) to a rectangle."""
    x0, y0, x1, y1 = r
    edges = [(lambda p: p[0] >= x0, lambda a, b: [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / ((b[0] - a[0]) or 1e-12)]),
             (lambda p: p[0] <= x1, lambda a, b: [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / ((b[0] - a[0]) or 1e-12)]),
             (lambda p: p[1] >= y0, lambda a, b: [a[0] + (b[0] - a[0]) * (y0 - a[1]) / ((b[1] - a[1]) or 1e-12), y0]),
             (lambda p: p[1] <= y1, lambda a, b: [a[0] + (b[0] - a[0]) * (y1 - a[1]) / ((b[1] - a[1]) or 1e-12), y1])]
    out = ring
    for inside, cut in edges:
        inp, out = out, []
        for i, cur in enumerate(inp):
            prev = inp[i - 1]
            if inside(cur):
                if not inside(prev): out.append(cut(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cut(prev, cur))
        if not out: break
    return [[round(x, 5), round(y, 5)] for x, y in out]


def polygon_area(p):
    x, y = np.array(p).T
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def level_of(v):
    out = None
    for t, name in LEVELS:
        if v >= t:
            out = name
    return out


def main():
    res = json.load(open(sys.argv[1]))
    dry = '--dry-run' in sys.argv
    g = res['grid']
    b = np.array(res['blend']).reshape(g['ny'], g['nx'])
    # slightly broader areas: grow each by ~10 km, softly
    b = np.maximum(b, gaussian_filter(maximum_filter(b, size=5), 1.2))
    lat = g['lat0'] + np.arange(g['ny']) * g['d']
    lon = g['lon0'] + np.arange(g['nx']) * g['d']

    # ── risk areas: closed contours on a zero-padded grid, smoothed by RDP, small blobs dropped
    pad = np.pad(b, 1)
    plat = np.r_[lat[0] - g['d'], lat, lat[-1] + g['d']]
    plon = np.r_[lon[0] - g['d'], lon, lon[-1] + g['d']]
    shapes = []
    for t, name in LEVELS:
        if b.max() < t:
            continue
        cs = plt.contour(plon, plat, pad, levels=[t])
        for seg in cs.allsegs[0]:
            ring = [(float(x), float(y)) for x, y in seg]
            if len(ring) < 4 or polygon_area(ring) < 0.04:            # ~300 km²
                continue
            ring = rdp_closed(ring, 0.02)
            if len(ring) >= 4:
                pts = clip_rect([to_norm(x, y) for x, y in ring], visible_norm_rect(REGION))
                if len(pts) >= 3:
                    shapes.append({'riskLevel': name, 'points': pts})
        plt.close('all')

    # ── timeline (9 stamps, 06 → 06)
    stamp_risks = [level_of(v) for v in res['stamp_peak']]
    stamp_risks[-1] = None          # the closing 06:00 stamp marks the END of the day; filled, the tool reads it as running to 09:00

    # ── hazards
    hz = res['hazards']
    hazards, pct = ['lightning'], {'lightning': int(round(res['peak']))}
    if hz['ukv_hail_max'] >= 0.5 or hz['cape_max_in_risk'] >= 1000:
        hazards.append('hail')
    if hz['precip_max_in_risk'] >= 20:
        hazards.append('flood')
    if hz['gust_max_in_risk'] >= 20:                                   # ≈45 mph inside the risk area
        hazards.append('wind')

    # ── confidence from the model spread inside the risk area
    sp = res['spread']
    confidence = 'very-high' if sp < 8 else 'high' if sp < 13 else 'medium' if sp < 19 else 'low' if sp < 27 else 'very-low'

    # ── discussion
    mask = b >= 12
    jj, ii = np.where(mask)
    named = []
    for la, lo, nm in PLACES:
        if mask.any() and np.min((lat[jj] - la) ** 2 + ((lon[ii] - lo) * 0.6) ** 2) < 0.12:
            named.append(nm)
    where = and_list(named) or 'parts of the UK'
    tz_hours = ['06', '09', '12', '15', '18', '21', '00', '03', '06']
    peaks = [tz_hours[i] for i, v in enumerate(res['stamp_peak']) if v >= max(res['stamp_peak']) - 5]
    when = 'through the day' if len(peaks) >= 4 else ' and '.join(f'around {h}:00' for h in peaks[:2])
    strong = [m['label'] for m in res['models'].values() if m['peak'] >= 40]
    weak = [m['label'] for m in res['models'].values() if m['peak'] < 15]
    gust_mph = round(hz['gust_max_in_risk'] * 2.237)
    short = {'UKV 2 km': 'UKV', 'HARMONIE-AROME': 'HARMONIE', 'Met Office Global': 'MO Global', 'ECMWF IFS': 'ECMWF', 'GFS': 'GFS'}
    where = and_list(named[:4]) or 'parts of the UK'
    where = and_list(named[:3]) or 'parts of the UK'
    # two lines: the box must end above the footer band (the hazards card already shows wind/hail)
    text = f"Isolated storms possible for {where.replace(' and ', ' & ')}, mainly {when.replace('around ', '').replace(' and ', ' & ')}."

    # zoom to South England when the risk sits there
    south = (lat[jj] >= 49.5) & (lat[jj] <= 52.6) & (lon[ii] >= -5.8) & (lon[ii] <= 2.5)
    region = REGION

    day = datetime.fromisoformat(res['day'])
    state = {
        'validDate': res['day'], 'validDate2': '', 'activeRisk': 'Slight', 'hazards': hazards, 'hazardPct': pct,
        'stampRisks': stamp_risks, 'stampOverlays': [None] * len(stamp_risks),
        'footerText': 'Risk of Thunderstorms in a 15 mile radius', 'handle': '@MyWeatherUK', 'version': 'V5.00',
        'forecastType': 'initial', 'updateNumber': 1, 'overnightEnabled': False,
        'drawOpacity': 0.7, 'shapes': shapes, 'showShapes': True, 'showCities': True, 'graphicMode': 'outlook',
        'timelineGran': '3h', 'confidence': confidence,
        'validUntil': (day + timedelta(days=1)).strftime('%Y-%m-%dT06:00'),
        'discussionEnabled': True, 'discussionText': text, 'outlookRegion': region, 'annotations': [], 'arrows': [],
        'blendSource': {'models': res['models'], 'weights': res['weights'], 'window_utc': res['window_utc']},
    }
    print(json.dumps({k: state[k] for k in ('hazards', 'hazardPct', 'stampRisks', 'confidence', 'validUntil', 'discussionText')}, indent=1))
    print('shapes:', [(s['riskLevel'], len(s['points'])) for s in shapes])
    if dry:
        return
    tok = json.loads(urllib.request.urlopen(urllib.request.Request(f'{API}/api/auth/auto-login', data=b'{}', headers={'Content-Type': 'application/json'}, method='POST')).read())['access_token']
    title = f"Thunderstorm Outlook {day:%a %d %b} (5-model AWS blend)"
    body = json.dumps({'title': title, 'graphic_tool_state': state, 'published': False, 'is_forecast': False}).encode()
    rec = json.loads(urllib.request.urlopen(urllib.request.Request(f'{API}/api/entities/WeatherGraphic', data=body, headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {tok}'}, method='POST')).read())
    print('saved', rec.get('id'), title)
    # replace any earlier blend save for the same day
    lst = json.loads(urllib.request.urlopen(urllib.request.Request(f'{API}/api/entities/WeatherGraphic', headers={'Authorization': f'Bearer {tok}'})).read())
    for g in (lst if isinstance(lst, list) else lst.get('items', [])):
        if g.get('title') == title and g.get('id') != rec.get('id'):
            urllib.request.urlopen(urllib.request.Request(f'{API}/api/entities/WeatherGraphic/{g["id"]}', headers={'Authorization': f'Bearer {tok}'}, method='DELETE'))
            print('removed older', g['id'])


if __name__ == '__main__':
    main()
