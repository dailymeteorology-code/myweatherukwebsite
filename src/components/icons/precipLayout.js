/* ════════════════════════════════════════════════════════════════════════════
   Where every drop, flake and hailstone sits.

   PLAIN DATA, NOT JSX, ON PURPOSE. Spacing is the thing that goes wrong in an
   icon set — two flakes drawn 5px apart with a 3px radius overlap into a blob
   that reads as neither — and eyeballing it across 75 icons does not scale.
   Keeping the coordinates as data means the spacing can be CHECKED: every
   payload here is asserted collision-free by a script, and the icon components
   just render what they are given.

   THE BOX. Precipitation lives in y 37..47, below the cloud (which now ends at
   y ~36). Anything above 37 collides with the cloud; anything below 47 is
   clipped by the 48-unit viewBox.

   RADII used by the collision check:
     drop   treated as a 1.6-wide capsule down its length
     flake  its outer radius
     stone  its circle radius
   Two items clash if their shapes come within MIN_GAP of each other.
   ════════════════════════════════════════════════════════════════════════════ */

/** Minimum clear space between any two precipitation marks, in view units. */
export const MIN_GAP = 1.2;

/* Lane sets. Wider spacing for fewer, larger marks; tighter for many small
   ones. Derived once here so every payload lines up on the same grid rather
   than each family inventing its own and drifting. */
export const LANES = {
  2: [18, 30],
  3: [14, 24, 34],
  4: [12.5, 20.5, 28.5, 36.5],
  5: [11, 18.5, 26, 33.5, 41],
  6: [10, 16.5, 23, 29.5, 36, 42.5],
};

/* Two rows, far enough apart that a full-size flake in one cannot touch a
   flake in the other even when their lanes are adjacent.

   The exact values are set by what has to fit BETWEEN the cloud and the bottom
   edge: the cloud now ends at y 35.9, and the viewBox at 48. A 3.1-radius flake
   centred on 39.8 clears the cloud by 0.6, and one centred on 44.2 clears the
   bottom by 0.7. Moving either row half a unit further out starts clipping. */
export const ROW = { top: 39.8, bottom: 44.2 };

const drop = (x, y, len, w = 2.7, delay = 0, hard = false) => ({ kind: 'drop', x, y, len, w, delay, hard });
const dot = (x, y, r = 1.9, delay = 0) => ({ kind: 'dot', x, y, r, delay });
const flake = (x, y, r = 3, w = 1.5, delay = 0) => ({ kind: 'flake', x, y, r, w, delay });
const stone = (x, y, r = 2.6, delay = 0) => ({ kind: 'stone', x, y, r, delay });

/* ── Rain ────────────────────────────────────────────────────────────────── */

export const DRIZZLE = [
  dot(LANES[3][0], 39.5, 1.9, 1), dot(LANES[3][1], 43, 1.9, 3), dot(LANES[3][2], 39.5, 1.9, 2),
];

export const LIGHT_RAIN = [
  drop(LANES[3][0], 37.5, 5.5, 2.6, 1), drop(LANES[3][1], 37.5, 5.5, 2.6, 3), drop(LANES[3][2], 37.5, 5.5, 2.6, 2),
];

export const MODERATE_RAIN = [
  drop(LANES[4][0], 37.5, 6.5, 2.7, 1), drop(LANES[4][1], 37.5, 6.5, 2.7, 3),
  drop(LANES[4][2], 37.5, 6.5, 2.7, 2), drop(LANES[4][3], 37.5, 6.5, 2.7, 4),
];

export const HEAVY_RAIN = [
  drop(LANES[5][0], 37, 8, 2.9, 1, true), drop(LANES[5][1], 37, 8, 2.9, 3, true),
  drop(LANES[5][2], 37, 8, 2.9, 2, true), drop(LANES[5][3], 37, 8, 2.9, 4, true),
  drop(LANES[5][4], 37, 8, 2.9, 1, true),
];

export const TORRENTIAL_RAIN = [
  drop(LANES[6][0], 37, 9, 3, 1, true), drop(LANES[6][1], 37, 9, 3, 3, true),
  drop(LANES[6][2], 37, 9, 3, 5, true), drop(LANES[6][3], 37, 9, 3, 2, true),
  drop(LANES[6][4], 37, 9, 3, 4, true), drop(LANES[6][5], 37, 9, 3, 1, true),
];

/* Showers: fewer marks, wider gaps — the empty space is the message. */
export const RAIN_SHOWER = [drop(LANES[2][0], 37.5, 6, 2.7, 1), drop(LANES[2][1], 37.5, 6, 2.7, 3)];
export const MODERATE_SHOWER = LIGHT_RAIN.map(d => ({ ...d, len: 6.5 }));
export const HEAVY_SHOWER = [
  drop(LANES[4][0], 37, 7.5, 2.9, 1, true), drop(LANES[4][1], 37, 7.5, 2.9, 3, true),
  drop(LANES[4][2], 37, 7.5, 2.9, 2, true), drop(LANES[4][3], 37, 7.5, 2.9, 4, true),
];

/* Thundery shower: the bolt owns the middle, so the drops keep to the edges. */
export const THUNDERY_SHOWER = [drop(11, 38, 6, 2.7, 2), drop(40, 38, 6, 2.7, 4)];

/* ── Snow ────────────────────────────────────────────────────────────────── */

export const FLURRY = [
  dot(LANES[3][0], 39.5, 1.9, 1), dot(LANES[3][1], 44, 1.9, 3), dot(LANES[3][2], 39.5, 1.9, 2),
];

export const LIGHT_SNOW = [
  flake(LANES[3][0], ROW.top, 3, 1.5, 1), flake(LANES[3][1], ROW.bottom, 2.7, 1.4, 3), flake(LANES[3][2], ROW.top, 3, 1.5, 2),
];

export const SNOW = [
  flake(LANES[4][0], ROW.top, 3, 1.5, 1), flake(LANES[4][1], ROW.bottom, 2.8, 1.4, 3),
  flake(LANES[4][2], ROW.top, 3, 1.5, 2), flake(LANES[4][3], ROW.bottom, 2.8, 1.4, 4),
];

export const HEAVY_SNOW = [
  flake(LANES[5][0], ROW.top, 3.1, 1.6, 1), flake(LANES[5][1], ROW.bottom, 3.1, 1.6, 3),
  flake(LANES[5][2], ROW.top, 3.1, 1.6, 2), flake(LANES[5][3], ROW.bottom, 3.1, 1.6, 4),
  flake(LANES[5][4], ROW.top, 3.1, 1.6, 1),
];

/* Blizzard: two flakes only, kept right, because the wind streaks on the left
   are carrying the meaning and a full row of flakes would bury them. */
export const BLIZZARD = [flake(31, ROW.top, 3, 1.5, 1), flake(40, ROW.bottom, 2.7, 1.4, 3)];

/* ── Sleet and hail ──────────────────────────────────────────────────────── */

export const LIGHT_SLEET = [drop(LANES[2][0], 37.5, 5.5, 2.6, 1), flake(LANES[2][1], 40.5, 2.8, 1.4, 3)];

export const SLEET = [
  drop(LANES[3][0], 37.5, 6, 2.7, 1), flake(LANES[3][1], 40.5, 3, 1.5, 3), drop(LANES[3][2], 37.5, 6, 2.7, 2),
];

export const HEAVY_SLEET = [
  drop(LANES[4][0], 37.5, 6.5, 2.8, 1), flake(LANES[4][1], 40.5, 3, 1.5, 3),
  drop(LANES[4][2], 37.5, 6.5, 2.8, 2), flake(LANES[4][3], 40.5, 3, 1.5, 4),
];

export const LIGHT_HAIL = [stone(LANES[2][0], 40, 2.5, 1), stone(LANES[2][1], 44, 2.5, 3)];

export const HAIL = [
  stone(LANES[3][0], 39.5, 2.6, 1), stone(LANES[3][1], 44.5, 2.6, 3), stone(LANES[3][2], 39.5, 2.6, 2),
];

export const HEAVY_HAIL = [
  stone(LANES[4][0], 39.5, 2.7, 1), stone(LANES[4][1], 44.5, 2.7, 3),
  stone(LANES[4][2], 39.5, 2.7, 2), stone(LANES[4][3], 44.5, 2.7, 4),
];

/* ── Collision check ─────────────────────────────────────────────────────── */

/** Bounding radius used when testing one mark against another. */
export function radiusOf(m) {
  if (m.kind === 'drop') return Math.max(m.w / 2, 0.8);
  if (m.kind === 'dot') return m.r;
  if (m.kind === 'flake') return m.r;
  return m.r;
}

/** Distance from a point to a mark's shape (drops are capsules, rest circles). */
function distanceTo(m, px, py) {
  if (m.kind !== 'drop') return Math.hypot(px - m.x, py - m.y) - radiusOf(m);
  // Closest point on the drop's segment.
  const ax = m.x, ay = m.y, bx = m.x - 1.1, by = m.y + m.len;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) - radiusOf(m);
}

/**
 * Smallest clear gap between any two marks in a payload.
 * Negative means they overlap. Sampled along drops so a capsule is compared
 * properly rather than by its start point alone.
 */
export function minGap(marks) {
  let worst = Infinity;
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      const a = marks[i], b = marks[j];
      const pts = b.kind === 'drop'
        ? Array.from({ length: 9 }, (_, k) => [b.x - 1.1 * (k / 8), b.y + b.len * (k / 8)])
        : [[b.x, b.y]];
      for (const [px, py] of pts) worst = Math.min(worst, distanceTo(a, px, py) - radiusOf(b));
    }
  }
  return worst === Infinity ? Infinity : worst;
}

/** Every payload, for the spacing check. */
export const ALL_PAYLOADS = {
  DRIZZLE, LIGHT_RAIN, MODERATE_RAIN, HEAVY_RAIN, TORRENTIAL_RAIN,
  RAIN_SHOWER, MODERATE_SHOWER, HEAVY_SHOWER, THUNDERY_SHOWER,
  FLURRY, LIGHT_SNOW, SNOW, HEAVY_SNOW, BLIZZARD,
  LIGHT_SLEET, SLEET, HEAVY_SLEET, LIGHT_HAIL, HAIL, HEAVY_HAIL,
};
