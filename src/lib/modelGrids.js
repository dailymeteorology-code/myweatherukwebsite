/* The Model Data display grids (tools/modeldata/mdata/common.py GRIDS), and the projection between
   lon/lat and each grid, for the Model Data page and the Graphic Studio's model imports.

     uk  the Met Office UKV grid: Lambert azimuthal equal-area on WGS84, centred 54.9 N 2.5 W,
         1042 x 970 cells of 2 km (UKV, the live radar and satellite, the observed days)
     eu  the global models' grid: centred 50 N 12 W, 1083 x 708 cells of 8 km, from the US east
         coast to the Volga and from Svalbard into the Sahara (Met Office Global, ECMWF, GFS)

   Grid units: gx east and gy south, in cells from the grid's outer north-west corner (cell i spans
   [i, i+1]). The projection is the ellipsoidal one (Snyder), as pyproj makes the frames with: the
   spherical shortcut is several km out at the wide grid's edges. */

export const GRIDS = {
  uk: { name: 'uk', lat0: 54.9, lon0: -2.5, nx: 1042, ny: 970, dx: 2000, x0: -1158000, yTop: 902000 },
  eu: { name: 'eu', lat0: 50, lon0: -12, nx: 1083, ny: 708, dx: 8000, x0: -4428000, yTop: 2924000 },
};
/** The grid a model's frames are on (mdata/common.py MODEL_GRID). */
export const gridOfModel = (id) => (id === 'ukv' || !id ? 'uk' : 'eu');

const D = Math.PI / 180;
const A = 6378137, FL = 1 / 298.257223563, E2 = FL * (2 - FL), E = Math.sqrt(E2);
const E4 = E2 * E2, E6 = E4 * E2;
const qf = (s) => (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
const QP = qf(1), RQ = A * Math.sqrt(QP / 2);

const PROJ = {};
/** The projection of a grid (by name or object): { fwd, inv, toGrid, fromGrid }. */
export function projection(grid) {
  const g = typeof grid === 'string' ? GRIDS[grid] : grid;
  if (PROJ[g.name]) return PROJ[g.name];
  const PHI1 = g.lat0 * D, LAM0 = g.lon0 * D;
  const B1 = Math.asin(qf(Math.sin(PHI1)) / QP);
  const DD = (A * Math.cos(PHI1) / Math.sqrt(1 - E2 * Math.sin(PHI1) ** 2)) / (RQ * Math.cos(B1));
  const left = g.x0 - g.dx / 2, top = g.yTop + g.dx / 2;
  /** lon/lat (degrees) -> grid metres (x east, y north) */
  const fwd = (lon, lat) => {
    const b = Math.asin(qf(Math.sin(lat * D)) / QP);
    const dl = lon * D - LAM0;
    const bb = RQ * Math.sqrt(2 / (1 + Math.sin(B1) * Math.sin(b) + Math.cos(B1) * Math.cos(b) * Math.cos(dl)));
    return [bb * DD * Math.cos(b) * Math.sin(dl), (bb / DD) * (Math.cos(B1) * Math.sin(b) - Math.sin(B1) * Math.cos(b) * Math.cos(dl))];
  };
  /** grid metres -> [lon, lat] (degrees) */
  const inv = (x, y) => {
    const rho = Math.hypot(x / DD, DD * y);
    if (rho < 1e-9) return [LAM0 / D, PHI1 / D];
    const ce = 2 * Math.asin(Math.min(1, rho / (2 * RQ)));
    const b = Math.asin(Math.cos(ce) * Math.sin(B1) + (DD * y * Math.sin(ce) * Math.cos(B1)) / rho);
    const lam = LAM0 + Math.atan2(x * Math.sin(ce), DD * rho * Math.cos(B1) * Math.cos(ce) - DD * DD * y * Math.sin(B1) * Math.sin(ce));
    const phi = b + (E2 / 3 + (31 * E4) / 180 + (517 * E6) / 5040) * Math.sin(2 * b)
      + ((23 * E4) / 360 + (251 * E6) / 3780) * Math.sin(4 * b) + ((761 * E6) / 45360) * Math.sin(6 * b);
    return [lam / D, phi / D];
  };
  const p = {
    grid: g, fwd, inv,
    toGrid: (lon, lat) => { const [x, y] = fwd(lon, lat); return [(x - left) / g.dx, (top - y) / g.dx]; },
    fromGrid: (gx, gy) => inv(left + gx * g.dx, top - gy * g.dx),
  };
  PROJ[g.name] = p;
  return p;
}
