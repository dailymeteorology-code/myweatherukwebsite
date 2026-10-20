/* The Met Office 1 km rain radar for the graphic studios, the same radar the Model Data page
   shows: the newest composite from this server (mdata/live.py, from the Met Office's AWS
   bucket — no RainViewer), drawn in the MyWeatherUK motion-graphics palette onto any lon/lat
   Mercator box, smoothed the way the Model Data page smooths it.

   The radar sits on the display grid at 1 km (Lambert azimuthal equal-area on WGS84, centre
   54.9N 2.5W). Each output pixel is taken back to lon/lat and forward through the ELLIPSOIDAL
   projection: the spherical shortcut would misplace the UK by up to ~14 km. */
import React, { useEffect, useState } from 'react';
import { API, colourAt, loadLive, scaleFor } from '@/lib/modelViewer';

const D = Math.PI / 180;
const A = 6378137, FL = 1 / 298.257223563, E2 = FL * (2 - FL), E = Math.sqrt(E2);
const qf = (s) => (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
const QP = qf(1), RQ = A * Math.sqrt(QP / 2);
const PHI1 = 54.9 * D, LAM0 = -2.5 * D;
const B1 = Math.asin(qf(Math.sin(PHI1)) / QP);
const DD = (A * Math.cos(PHI1) / Math.sqrt(1 - E2 * Math.sin(PHI1) ** 2)) / (RQ * Math.cos(B1));

/** lon/lat (degrees) -> display-grid metres (x east, y north), as pyproj on the grid's PROJ string. */
export function laea(lon, lat) {
  const b = Math.asin(qf(Math.sin(lat * D)) / QP);
  const dl = lon * D - LAM0;
  const bb = RQ * Math.sqrt(2 / (1 + Math.sin(B1) * Math.sin(b) + Math.cos(B1) * Math.cos(b) * Math.cos(dl)));
  return [bb * DD * Math.cos(b) * Math.sin(dl), (bb / DD) * (Math.cos(B1) * Math.sin(b) - Math.sin(B1) * Math.cos(b) * Math.cos(dl))];
}

/* the studios' rain bands, in the motion graphics' colours (mm/h; dBZ by Marshall-Palmer).
   Ids are kept from the old RainViewer key so saved graphics still resolve. */
const dbz = (r) => Math.round(10 * Math.log10(200 * r ** 1.6));
export const RADAR_BANDS = [
  ['TraceRain', 'DRIZZLE', 0.05, 0.2, '#B4F0FA'],
  ['LightRain', 'V.LIGHT', 0.2, 0.6, '#78B9FA'],
  ['ModRain', 'LIGHT', 0.6, 1.2, '#1E6EEB'],
  ['HeavyRain', 'MODERATE', 1.2, 2.5, '#46CE3F'],
  ['VHeavyRain', 'HEAVY', 2.5, 4, '#95F391'],
  ['IntenseRain', 'V.HEAVY', 4, 8, '#FFBA00'],
  ['TorrRain', 'INTENSE', 8, 16, '#DE0000'],
  ['ExtremeRain', 'TORRENTIAL', 16, 30, '#DEA1A1'],
  ['HailCore', 'EXTREME', 30, null, '#9B7EB9'],
].map(([id, short, lo, hi, color]) => ({
  id, short, color, range: hi ? `${lo}-${hi} mm/h` : `${lo}+ mm/h`, dbz: hi ? `${dbz(lo)}-${dbz(hi)} dBZ` : `${dbz(lo)}+ dBZ`,
  fill: `${color}66`, border: color,
}));

export async function latestRadar(signal) {
  const c = await fetch(`${API}/live/catalog`, { signal }).then((r) => r.json());
  const p = c?.products?.radar;
  if (!p?.times?.length) return null;
  return loadLive('radar', p.times[p.times.length - 1], 'bin', signal);
}

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2));

/** The radar frame drawn into a lon/lat Mercator box: a PNG data URL W x H. */
export function radarImage(frame, bbox, W, H, smooth = true) {
  const sc = scaleFor('radar');
  const lut = new Uint32Array(256);
  for (let v = 0; v < 255; v++) {
    const c = colourAt(sc, frame.table[v]);
    if (c) lut[v] = (c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
  }
  const { nx, ny, q } = frame;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = new Uint32Array(img.data.buffer);
  const yt = mercY(bbox.latMax), yb = mercY(bbox.latMin);
  const qv = (i, j) => { const v = q[j * nx + i]; return v === 255 ? 0 : v; };
  for (let py = 0; py < H; py++) {
    const lat = Math.atan(Math.sinh(yt - ((py + 0.5) / H) * (yt - yb))) / D;
    for (let px = 0; px < W; px++) {
      const lon = bbox.lonMin + ((px + 0.5) / W) * (bbox.lonMax - bbox.lonMin);
      const [x, y] = laea(lon, lat);
      const fx = (x + 1159000) / 1000 - 0.5, fy = (903000 - y) / 1000 - 0.5;   // 1 km cell centres
      const i = Math.floor(fx), j = Math.floor(fy);
      if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) continue;
      let v;
      if (smooth) {
        const tx = fx - i, ty = fy - j;
        v = Math.round((qv(i, j) * (1 - tx) + qv(i + 1, j) * tx) * (1 - ty) + (qv(i, j + 1) * (1 - tx) + qv(i + 1, j + 1) * tx) * ty);
      } else v = q[Math.round(fy) * nx + Math.round(fx)];
      d[py * W + px] = lut[v] || 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

/** Drop-in for the studios' old RainViewer layer: the newest radar, placed with the studio's
    own projectPt over `bbox`, in an SVG of the studio's view size. */
export function UKRadarLayer({ opacity = 0.88, bbox, projectPt, viewW, viewH, smooth = true }) {
  const [img, setImg] = useState(null);
  const key = `${bbox.lonMin}-${bbox.lonMax}-${bbox.latMin}-${bbox.latMax}-${smooth}`;
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const f = await latestRadar(ac.signal);
        if (!f) return;
        const [x0, y0] = projectPt(bbox.lonMin, bbox.latMax), [x1, y1] = projectPt(bbox.lonMax, bbox.latMin);
        const km = (bbox.lonMax - bbox.lonMin) * 111.3 * Math.cos(((bbox.latMin + bbox.latMax) / 2) * D);
        const W = Math.max(300, Math.min(1600, Math.round(km * 1.6)));
        const H = Math.round(W * (y1 - y0) / Math.max(1e-6, x1 - x0));
        setImg({ url: radarImage(f, bbox, W, H, smooth), x: x0, y: y0, w: x1 - x0, h: y1 - y0, valid: f.head.valid });
      } catch { /* radar unavailable: no overlay */ }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!img) return null;
  return (
    <svg viewBox={`0 0 ${viewW} ${viewH}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <image href={img.url} x={img.x} y={img.y} width={img.w} height={img.h} opacity={opacity} preserveAspectRatio="none" />
    </svg>
  );
}
