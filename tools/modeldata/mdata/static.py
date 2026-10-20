"""Static layers for the viewer, all on the display grid (built once).

    python -m mdata.static

basemap.png        2x the grid (2084 x 1940): dark map, land shaded by UKV's own 2 km orography
basemap_light.png  the same relief as a light paper map
sat_day.jpg        NASA Blue Marble (day satellite), reprojected onto the grid
night_lights.png   NASA Black Marble city lights (radiance), for the real-time day/night map
lines.json    coastlines and national borders (Natural Earth 1:10m), in grid pixels
cities.json   place labels, in grid pixels
grid.json     the projection
"""
from __future__ import annotations

import json

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from scipy import ndimage

from .common import DX, NX, NY, PROJ, REPO, STATIC, X0, Y_TOP, grid_meta, write_json
from .models import UKV

SS = 2                                                   # basemap supersampling
TOPO = REPO / 'node_modules' / 'world-atlas'

CITIES = [
    ('London', 51.507, -0.128, 1), ('Birmingham', 52.486, -1.890, 1), ('Manchester', 53.481, -2.242, 1),
    ('Newcastle', 54.978, -1.618, 1), ('Glasgow', 55.864, -4.252, 1), ('Edinburgh', 55.953, -3.189, 1),
    ('Aberdeen', 57.150, -2.094, 1), ('Cardiff', 51.481, -3.179, 1), ('Belfast', 54.597, -5.930, 1),
    ('Dublin', 53.350, -6.260, 1), ('Paris', 48.857, 2.352, 1), ('Amsterdam', 52.370, 4.895, 1),
    ('Brussels', 50.850, 4.352, 1), ('Leeds', 53.800, -1.549, 2), ('Inverness', 57.478, -4.225, 2),
    ('Cork', 51.898, -8.471, 2), ('Galway', 53.270, -9.057, 2), ('Plymouth', 50.376, -4.143, 2),
    ('Bristol', 51.454, -2.588, 2), ('Norwich', 52.630, 1.297, 2), ('Liverpool', 53.408, -2.991, 2),
    ('Stornoway', 58.209, -6.389, 2), ('Lerwick', 60.155, -1.145, 2), ('Lille', 50.629, 3.057, 2),
    ('Brest', 48.390, -4.486, 2), ('Bergen', 60.391, 5.322, 2), ('Stavanger', 58.970, 5.733, 2),
    ('Southampton', 50.910, -1.404, 3), ('Sheffield', 53.383, -1.465, 3), ('Nottingham', 52.954, -1.158, 3),
    ('Exeter', 50.718, -3.534, 3), ('Kirkwall', 58.981, -2.960, 3), ('Dundee', 56.462, -2.971, 3),
    ('Carlisle', 54.892, -2.932, 3), ('Hull', 53.767, -0.327, 3), ('Aberystwyth', 52.415, -4.083, 3),
    ('Oban', 56.415, -5.472, 3), ('Derry', 54.997, -7.309, 3), ('Limerick', 52.668, -8.630, 3),
    ('Douglas', 54.150, -4.482, 3), ('St Helier', 49.186, -2.107, 3), ('Rennes', 48.117, -1.678, 3),
    ('Cherbourg', 49.640, -1.616, 3), ('Ipswich', 52.056, 1.148, 3), ('Lincoln', 53.230, -0.540, 3),
    ('Fort William', 56.820, -5.105, 3), ('Penzance', 50.118, -5.537, 3), ('Brighton', 50.823, -0.137, 3),
]

_TR = Transformer.from_crs('EPSG:4326', PROJ, always_xy=True)


def to_px(lon, lat, scale=1.0):
    x, y = _TR.transform(np.asarray(lon, float), np.asarray(lat, float))
    return (x - (X0 - DX / 2)) / DX * scale, ((Y_TOP + DX / 2) - y) / DX * scale


def topo(name):
    t = json.loads((TOPO / name).read_text())
    sx, sy = t['transform']['scale']
    tx, ty = t['transform']['translate']
    arcs = []
    for a in t['arcs']:
        q = np.cumsum(np.asarray(a, float), axis=0)
        arcs.append(np.c_[q[:, 0] * sx + tx, q[:, 1] * sy + ty])
    return t, arcs


def ring(arcs, idx):
    pts = []
    for i in idx:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.append(a if not pts else a[1:])
    return np.vstack(pts)


def in_area(ll):
    return ((ll[:, 0] > -32) & (ll[:, 0] < 32) & (ll[:, 1] > 34) & (ll[:, 1] < 76)).any()


def thin(px, py, tol=0.35):
    keep = [0]
    for i in range(1, len(px)):
        if abs(px[i] - px[keep[-1]]) + abs(py[i] - py[keep[-1]]) >= tol or i == len(px) - 1:
            keep.append(i)
    return px[keep], py[keep]


def lines():
    t, arcs = topo('countries-10m.json')
    use = {}
    for g in t['objects']['countries']['geometries']:
        polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']] if g['type'] == 'Polygon' else []
        for poly in polys:
            for rr in poly:
                for i in rr:
                    k = i if i >= 0 else ~i
                    use[k] = use.get(k, 0) + 1
    out = {'coast': [], 'border': []}
    for k, n in use.items():
        ll = arcs[k]
        if not in_area(ll):
            continue
        px, py = to_px(ll[:, 0], ll[:, 1])
        if np.all((px < -5) | (px > NX + 5) | (py < -5) | (py > NY + 5)):
            continue
        px, py = thin(px, py)
        flat = np.round(np.c_[px, py].ravel(), 2).tolist()
        out['border' if n >= 2 else 'coast'].append(flat)
    return out


MWUK_BASEMAP = REPO.parent / 'mwuk-graphics' / 'assets' / 'basemap'
ROAD_CLASSES = ('motorway', 'trunk', 'primary')


def roads():
    """The motion graphics' road network (OpenStreetMap, ODbL; mwuk-graphics basemap bundle) on
    the display grid: motorway, trunk and primary roads, each as a coarse national set and the
    full-detail set, so the viewer can add detail as it zooms in. roads.bin holds int16 grid
    pixels x16 per line plus uint32 line starts; roads.json indexes it."""
    meta = json.loads((MWUK_BASEMAP / 'basemap.json').read_text())
    blob = (MWUK_BASEMAP / 'basemap.bin').read_bytes()
    ent = {e['name']: e for e in meta['entries']}
    p = meta['projection']
    inv = Transformer.from_crs(f"+proj=tmerc +lat_0={p['lat0']} +lon_0={p['lon0']} +k=1 +x_0=0 +y_0=0 +R={p['radiusKm'] * 1000} +units=km",
                               'EPSG:4326', always_xy=True)

    def arr(name, dt):
        e = ent[name]
        return np.frombuffer(blob, dt, e['length'], e['offset'])
    index, parts, at = {}, [], 0
    for cls in ROAD_CLASSES:
        for lod, tol in (('coarse', 0.45), ('fine', 0.06)):
            if f'roads.{cls}.{lod}.xy' not in ent:
                continue
            xy = arr(f'roads.{cls}.{lod}.xy', np.float32).reshape(-1, 2)
            off = arr(f'roads.{cls}.{lod}.off', np.uint32)
            lon, lat = inv.transform(xy[:, 0].astype(float), xy[:, 1].astype(float))
            px, py = to_px(lon, lat)
            pts, starts = [], [0]
            for i in range(len(off) - 1):
                a, b = int(off[i]), int(off[i + 1])
                if b - a < 2:
                    continue
                x, y = px[a:b], py[a:b]
                if np.all((x < -5) | (x > NX + 5) | (y < -5) | (y > NY + 5)):
                    continue
                x, y = thin(x, y, tol)
                if len(x) < 2:
                    continue
                pts.append(np.c_[x, y])
                starts.append(starts[-1] + len(x))
            q = np.round(np.vstack(pts) * 16).astype(np.int16).ravel()
            s = np.asarray(starts, np.uint32)
            index[f'{cls}.{lod}'] = {'xy': [at, q.size], 'off': [at + q.nbytes, s.size], 'lines': len(pts)}
            parts += [q.tobytes(), s.tobytes()]
            at += q.nbytes + s.nbytes
    (STATIC / 'roads.bin').write_bytes(b''.join(parts))
    write_json(STATIC / 'roads.json', {'scale': 16, 'classes': index, 'source': 'OpenStreetMap contributors (ODbL), via the MyWeatherUK graphics basemap'})
    return index


def land_mask():
    t, arcs = topo('land-10m.json')
    img = Image.new('L', (NX * SS, NY * SS), 0)
    dr = ImageDraw.Draw(img)
    for g in t['objects']['land']['geometries']:
        polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
        for poly in polys:
            for k, rr in enumerate(poly):
                ll = ring(arcs, rr)
                if not in_area(ll):
                    continue
                px, py = to_px(ll[:, 0], ll[:, 1], SS)
                if len(px) > 2:
                    dr.polygon(list(zip(px.tolist(), py.tolist())), fill=255 if k == 0 else 0)
    return np.asarray(img, np.float32) / 255.0


def orography():
    """UKV's own 2 km orography (any recent run carries it)."""
    m = UKV()
    for r, steps in m.runs(n=2):
        try:
            a, _ = m._read(r, steps[0], 'height_of_orography')
            return np.nan_to_num(a)
        except Exception:
            continue
    raise RuntimeError('no UKV orography found')


def basemap():
    land = land_mask()
    h = ndimage.zoom(orography(), SS, order=1)[:NY * SS, :NX * SS]
    gy, gx = np.gradient(h, DX / SS)
    z = 2.5                                              # vertical exaggeration for a readable relief
    slope = np.arctan(z * np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.deg2rad(315), np.deg2rad(42)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(shade / np.sin(alt), 0.35, 1.35)
    elev = np.clip(h / 1200.0, 0, 1)
    base = np.array([58, 66, 76], float) * (1 + 0.35 * elev[..., None])
    landc = np.clip(base * shade[..., None], 0, 255)
    sea = np.array([14, 27, 42], float)
    rgb = sea * (1 - land[..., None]) + landc * land[..., None]
    STATIC.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb.astype(np.uint8)).save(STATIC / 'basemap.png', optimize=True)
    np.save(STATIC / 'land_mask.npy', ndimage.zoom(land, 1 / SS, order=1)[:NY, :NX] > 0.5)


NASA = REPO.parent / 'mwuk-graphics' / 'assets' / 'basemap'      # same NASA imagery as the motion graphics
NASA_BOX = (-22.5, 40.5, 18.0, 67.5)                                # equirectangular, north-up
GIBS = ('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0'
        '&LAYERS={layer}&CRS=EPSG:4326&BBOX=40.5,-22.5,67.5,18&WIDTH=4608&HEIGHT=3072&FORMAT=image/jpeg')


def _nasa(name, layer):
    """NASA Blue Marble (day) / Black Marble (night) over NW Europe, from the motion-graphics
    assets, or straight from NASA GIBS if they are not on this machine."""
    f = NASA / name
    if not f.exists():
        from nova.io_aws import get
        STATIC.mkdir(parents=True, exist_ok=True)
        f = STATIC / name
        f.write_bytes(get(GIBS.format(layer=layer), tries=3, timeout=180))
    return np.asarray(Image.open(f).convert('RGB'), np.float32)


def _pixel_lonlat():
    """lon/lat of every basemap pixel (2x the grid)."""
    inv = Transformer.from_crs(PROJ, 'EPSG:4326', always_xy=True)
    x = (X0 - DX / 2) + (np.arange(NX * SS) + 0.5) * DX / SS
    y = (Y_TOP + DX / 2) - (np.arange(NY * SS) + 0.5) * DX / SS
    xx, yy = np.meshgrid(x, y)
    return inv.transform(xx, yy)


def _sample(img, lon, lat):
    lo0, la0, lo1, la1 = NASA_BOX
    h, w = img.shape[:2]
    cols = (lon - lo0) / (lo1 - lo0) * w - 0.5
    rows = (la1 - lat) / (la1 - la0) * h - 0.5
    return np.stack([ndimage.map_coordinates(img[..., c], [rows, cols], order=1, mode='nearest') for c in range(3)], -1)


def styled_basemaps():
    """Light map, satellite (Blue Marble) and night lights (Black Marble) on the display grid."""
    lon, lat = _pixel_lonlat()
    day = _sample(_nasa('day_europe.jpg', 'BlueMarble_NextGeneration'), lon, lat)
    # Blue Marble is a little dark and flat for a weather map: lift the midtones, add saturation
    day = 255 * np.power(np.clip(day / 255, 0, 1), 0.82)
    g = day.mean(-1, keepdims=True)
    day = np.clip(g + 1.18 * (day - g), 0, 255)
    Image.fromarray(day.astype(np.uint8)).save(STATIC / 'sat_day.jpg', quality=88, optimize=True)
    night = _sample(_nasa('night_europe.jpg', 'VIIRS_Black_Marble'), lon, lat).mean(-1)
    Image.fromarray(np.clip(night, 0, 255).astype(np.uint8), 'L').save(STATIC / 'night_lights.png', optimize=True)
    # light map: paper land with soft relief, pale sea
    land = land_mask()
    h = ndimage.zoom(orography(), SS, order=1)[:NY * SS, :NX * SS]
    gy, gx = np.gradient(h, DX / SS)
    slope = np.arctan(2.5 * np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    shade = np.sin(np.deg2rad(42)) * np.cos(slope) + np.cos(np.deg2rad(42)) * np.sin(slope) * np.cos(np.deg2rad(315) - aspect)
    shade = np.clip(shade / np.sin(np.deg2rad(42)), 0.55, 1.15)
    elev = np.clip(h / 1000.0, 0, 1)[..., None]
    lc = (np.array([238, 240, 233], float) * (1 - 0.18 * elev) + np.array([214, 206, 188], float) * 0.18 * elev) * shade[..., None]
    sea = np.array([201, 217, 231], float)
    rgb = sea * (1 - land[..., None]) + np.clip(lc, 0, 255) * land[..., None]
    Image.fromarray(rgb.astype(np.uint8)).save(STATIC / 'basemap_light.png', optimize=True)


def main():
    STATIC.mkdir(parents=True, exist_ok=True)
    write_json(STATIC / 'grid.json', grid_meta())
    write_json(STATIC / 'lines.json', lines())
    px, py = to_px([c[2] for c in CITIES], [c[1] for c in CITIES])
    write_json(STATIC / 'cities.json', [{'name': c[0], 'x': round(float(x), 2), 'y': round(float(y), 2), 'rank': c[3]}
                                        for c, x, y in zip(CITIES, px, py) if 0 <= x <= NX and 0 <= y <= NY])
    roads()
    basemap()
    styled_basemaps()
    print('static layers written to', STATIC)


if __name__ == '__main__':
    import sys
    if sys.argv[1:] == ['roads']:                  # roads only (the basemaps take minutes)
        print(roads())
    else:
        main()
