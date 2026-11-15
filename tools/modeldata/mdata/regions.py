"""The Model Data page's places to zoom to (15 Nov 2026): public/data/regions.json, built from Natural
Earth (public domain) countries and their first-level regions, kept on D: (naturalearth/).

    python -m mdata.regions

Four areas, as the user asked: the UK and Ireland (the four nations and Ireland, each with its
regions), Europe (its countries, each with its regions), North Africa (its countries) and North
America without the United States (its countries; Canada's provinces and Mexico's states too).
Every place is a lon/lat box [west, south, east, north]; the page turns it into the box of whichever
grid is on show and leaves out places that grid does not reach.

A country's box is its largest piece of land and whatever lies near it (Sicily and Sardinia with
Italy, the Balearics with Spain), never its far territories (French Guiana, the Azores, Svalbard
are left out of France, Portugal and Norway). Regions come from Natural Earth's own grouping where
it has one (France's regions, Italy's, Spain's communities, England's regions), else its first-level
units (Germany's states, Norway's counties, Canada's provinces), and only where there are 2 to 45.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from .common import REPO

NE = Path('D:/MyWeatherUK-data/naturalearth')
OUT = REPO / 'public' / 'data' / 'regions.json'

AREAS = {   # each area's own box (west, south, east, north)
    'ukie': ('UK & Ireland', (-11.0, 49.6, 2.2, 61.0)),
    'europe': ('Europe', (-25.0, 34.0, 45.0, 72.0)),
    'nafrica': ('North Africa', (-18.0, 14.0, 37.0, 38.0)),
    'namerica': ('North America', (-170.0, 7.0, -52.0, 84.0)),
}
EUROPE_SKIP = {'United Kingdom', 'Ireland', 'Isle of Man', 'Jersey', 'Guernsey', 'Vatican', 'Monaco', 'San Marino', 'Gibraltar'}
EUROPE_ADD = {'Turkey', 'Cyprus', 'N. Cyprus'}
NAFRICA = {'Morocco', 'Algeria', 'Tunisia', 'Libya', 'Egypt', 'W. Sahara', 'Mauritania', 'Sudan'}
NAMERICA_SKIP = {'United States of America', 'Puerto Rico', 'U.S. Virgin Is.', 'U.S. Minor Outlying Is.', 'USNB Guantanamo Bay',
                 'Bajo Nuevo Bank', 'Serranilla Bank'}
NAMERICA_REGIONS = {'Canada', 'Mexico'}
NAMES = {'Bosnia and Herz.': 'Bosnia and Herzegovina', 'Faeroe Is.': 'Faroe Islands', 'Czechia': 'Czech Republic',
         'Dominican Rep.': 'Dominican Republic', 'Antigua and Barb.': 'Antigua and Barbuda', 'St. Vin. and Gren.': 'St Vincent and the Grenadines',
         'St. Kitts and Nevis': 'St Kitts and Nevis', 'Turks and Caicos Is.': 'Turks and Caicos', 'Cayman Is.': 'Cayman Islands',
         'British Virgin Is.': 'British Virgin Islands', 'St. Pierre and Miquelon': 'St Pierre and Miquelon', 'W. Sahara': 'Western Sahara',
         'N. Cyprus': 'Northern Cyprus', 'Åland': 'Åland Islands'}


def polys(geom):
    """The geometry's outer rings, each as a list of (lon, lat)."""
    if geom['type'] == 'Polygon':
        return [geom['coordinates'][0]]
    return [p[0] for p in geom['coordinates']]


def ring_area(r):
    return abs(sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1))) / 2


def bbox(rings, cap=None):
    xs = [p[0] for r in rings for p in r if cap is None or p[0] <= cap]
    ys = [p[1] for r in rings for p in r if cap is None or p[0] <= cap]
    return [min(xs), min(ys), max(xs), max(ys)] if xs else None


def near(b, c, pad):
    return not (c[2] < b[0] - pad or c[0] > b[2] + pad or c[3] < b[1] - pad or c[1] > b[3] + pad)


def main_box(rings, cap=None, within=None):
    """The box of the largest piece and the pieces near it (inside `within`, if given)."""
    if within:
        rings = [r for r in rings if near(within, bbox([r]) or within, 0)] or rings
    big = max(rings, key=ring_area)
    b = bbox([big], cap)
    w, h = b[2] - b[0], b[3] - b[1]
    pad = max(1.0, 0.25 * max(w, h))
    keep = [r for r in rings if ring_area(r) > 1e-4 and near(b, bbox([r]), pad)]
    return bbox(keep, cap)


def rnd(b, pad=0.04):
    w, h = b[2] - b[0], b[3] - b[1]
    p = max(0.15, min(1.0, pad * max(w, h)))
    return [round(b[0] - p, 2), round(b[1] - p, 2), round(b[2] + p, 2), round(b[3] + p, 2)]


def regions_of(features, within, group_key=None):
    """A country's regions: Natural Earth's grouping where it has one, else its first-level units."""
    groups = {}
    keyed = group_key and len({f['properties'].get(group_key) or '' for f in features} - {''}) >= 2
    for f in features:
        p = f['properties']
        name = (p.get(group_key) if keyed else None) or p.get('name_en') or p.get('name')
        if not name:
            continue
        rings = [r for r in polys(f['geometry']) if near(within, bbox([r]), 0)]
        if rings:
            groups.setdefault(name, []).extend(rings)
    if not 2 <= len(groups) <= 45:
        return []
    out = [{'name': n, 'box': rnd(bbox(rs))} for n, rs in groups.items()]
    return sorted(out, key=lambda r: r['name'])


def main():
    adm0 = json.loads((NE / 'ne_10m_admin_0_countries.geojson').read_text(encoding='utf-8'))['features']
    adm1 = json.loads((NE / 'ne_10m_admin_1_states_provinces.geojson').read_text(encoding='utf-8'))['features']
    by_admin = {}
    for f in adm1:
        by_admin.setdefault(f['properties']['admin'], []).append(f)
    country = {f['properties']['NAME']: f for f in adm0}
    admin_of = {f['properties']['NAME']: f['properties']['ADMIN'] for f in adm0}
    out = []

    # the UK and Ireland: the four nations (Natural Earth's geonunit) and Ireland, with their regions
    uk = by_admin.get('United Kingdom', [])
    ukie_box = AREAS['ukie'][1]
    items = []
    for nation in ('England', 'Scotland', 'Wales', 'Northern Ireland'):
        fs = [f for f in uk if f['properties'].get('geonunit') == nation]
        rings = [r for f in fs for r in polys(f['geometry'])]
        items.append({'name': nation, 'box': rnd(bbox(rings)), 'regions': regions_of(fs, ukie_box, 'region')})   # every county: a nation is contiguous
    ie = by_admin.get('Ireland', [])
    items.append({'name': 'Ireland', 'box': rnd(main_box(polys(country['Ireland']['geometry']))), 'regions': regions_of(ie, ukie_box, 'region')})
    for small in ('Isle of Man', 'Jersey', 'Guernsey'):
        if small in country:
            items.append({'name': small, 'box': rnd(bbox(polys(country[small]['geometry'])), 0.3), 'regions': []})
    out.append({'id': 'ukie', 'name': AREAS['ukie'][0], 'box': list(ukie_box), 'items': items})

    def countries(names, area, with_regions):
        area_box = AREAS[area][1]
        items = []
        for nm in sorted(names):
            f = country.get(nm)
            if f is None:
                continue
            cap = 60.0 if nm == 'Russia' else None             # European Russia, to the Urals
            rings = polys(f['geometry'])
            b = main_box(rings, cap, area_box)
            if b is None:
                continue
            label = 'Russia (west)' if nm == 'Russia' else NAMES.get(nm, nm)
            regs = []
            if with_regions(nm):
                fs = by_admin.get(admin_of.get(nm, nm), [])
                within = [b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2]
                regs = regions_of(fs, within, None if nm in NAMERICA_REGIONS else 'region')   # Canada's provinces, not its three broad parts
                if nm == 'Russia':
                    regs = [r for r in regs if r['box'][0] < 60]
            items.append({'name': label, 'box': rnd(b), 'regions': regs})
        return sorted(items, key=lambda i: i['name'])

    eu_names = {f['properties']['NAME'] for f in adm0 if f['properties']['CONTINENT'] == 'Europe'} - EUROPE_SKIP | EUROPE_ADD
    out.append({'id': 'europe', 'name': AREAS['europe'][0], 'box': list(AREAS['europe'][1]), 'items': countries(eu_names, 'europe', lambda n: True)})
    out.append({'id': 'nafrica', 'name': AREAS['nafrica'][0], 'box': list(AREAS['nafrica'][1]), 'items': countries(NAFRICA, 'nafrica', lambda n: False)})
    na_names = {f['properties']['NAME'] for f in adm0 if f['properties']['CONTINENT'] == 'North America'} - NAMERICA_SKIP
    out.append({'id': 'namerica', 'name': AREAS['namerica'][0], 'box': list(AREAS['namerica'][1]),
                'items': countries(na_names, 'namerica', lambda n: n in NAMERICA_REGIONS)})
    doc = {'source': 'Natural Earth (public domain): countries and first-level regions, as lon/lat boxes [west, south, east, north]',
           'built': '2026-11-15', 'areas': out}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    n_items = sum(len(a['items']) for a in out)
    n_regions = sum(len(i['regions']) for a in out for i in a['items'])
    print(f'{OUT}: {len(out)} areas, {n_items} countries and nations, {n_regions} regions, {OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
