/* ════════════════════════════════════════════════════════════════════════════
   Shared parts for every weather icon.

   ONE CLOUD, ONE SUN, ONE MOON, shared by the whole set, so a cloud is the same
   cloud whether it is raining, snowing or just sitting there. The previous set
   redrew the silhouette per family and they drifted apart; a forecast row then
   read as a jumble rather than a series.

   THE SUN AND MOON SIT PROUD OF THE CLOUD. They are placed up and to the LEFT
   at full size, and the cloud is pushed down-right and scaled to 86%, so only
   the lower-right shoulder of the disc is covered. Burying most of the sun
   behind the cloud — which is what happens if you draw both at full size on the
   same centre — throws away the one element that distinguishes a shower from
   steady rain, and at 16px the icon collapses into "some cloud".

   GRADIENT IDS ARE PER-INSTANCE, via useId(). SVG ids are document-global, so a
   hardcoded id on twenty icons means all twenty resolve to whichever rendered
   first. Harmless only while every copy is identical; the moment a storm cloud
   and a fair-weather cloud share an id, one silently wears the other's colours.

   THE BOX:
     y 4-21   celestial body, clear of the cloud except at its shoulder
     y 15-36  cloud
     y 37-47  precipitation (coordinates live in precipLayout.js)
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useId } from 'react';
import './wxIcons.css';

/* One smooth outline rather than overlapping circles: overlapping shapes each
   map a gradient across their own box, leaving seams where they cross. */
export const CLOUD_PATH =
  'M13.5,33.6 C8.8,33.6 5,29.9 5,25.4 C5,21.3 8.1,17.9 12.1,17.4 ' +
  'C13.4,12.9 17.6,9.6 22.6,9.6 C27.6,9.6 31.9,13 33.1,17.6 ' +
  'C33.7,17.5 34.2,17.4 34.8,17.4 C39.3,17.4 43,21.1 43,25.5 ' +
  'C43,30 39.3,33.6 34.8,33.6 Z';

/** How the cloud is placed when a sun or moon is behind it. */
export const CLOUD_OFFSET = 'translate(5 7) scale(0.86)';

/* Top and bottom of each cloud's gradient.
   THE RANGE IS WIDE ON PURPOSE. These render at 36px in a city card, where
   inner detail is lost and the only things that survive are the outline and
   the difference between the lit top and the shaded base. The previous tones
   spanned about two shades each, which at that size flattened into one — a
   grey sticker. Pushing the bottom stop down turns the same outline into a
   lump with weight in it. */
export const CLOUD_TONES = {
  light: ['#FFFFFF', '#9FB6CE'],
  mid:   ['#F2F7FD', '#8098B4'],
  heavy: ['#D6E2EF', '#5E748E'],
  storm: ['#8496AC', '#2C3849'],
};

/* ── Sun ─────────────────────────────────────────────────────────────────── */

export function SunDisc({ cx = 14, cy = 12.5, r = 8, animate = true }) {
  const id = useId();
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 + Math.PI / 8;   // offset so no ray points straight down into the cloud
    const inner = r + 2.2, outer = r + 6.2;
    return (
      <line key={i}
        x1={+(cx + Math.cos(a) * inner).toFixed(2)} y1={+(cy + Math.sin(a) * inner).toFixed(2)}
        x2={+(cx + Math.cos(a) * outer).toFixed(2)} y2={+(cy + Math.sin(a) * outer).toFixed(2)}
        stroke={`url(#${id}ray)`} strokeWidth="2.9" strokeLinecap="round" />
    );
  });
  return (
    <g>
      <defs>
        <radialGradient id={`${id}core`} cx="34%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#FFF3B0" />
          <stop offset="55%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#EF7C0E" />
        </radialGradient>
        <linearGradient id={`${id}ray`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFD35B" />
          <stop offset="100%" stopColor="#F59120" />
        </linearGradient>
        {/* The sun did not glow. A disc and eight spokes read as a diagram of
            the sun; what makes it read as a light source is the air around it
            being lit too. Drawn first so the rays and the disc sit inside it. */}
        <radialGradient id={`${id}glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFC83D" stopOpacity="0.55" />
          <stop offset="52%" stopColor="#FFB020" stopOpacity="0.17" />
          <stop offset="100%" stopColor="#FF9800" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r * 2.1} fill={`url(#${id}glow)`} />
      <g className={animate ? 'wx wx-anim wx-rays' : 'wx'}>{rays}</g>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}core)`}
              className={animate ? 'wx wx-anim wx-breathe' : 'wx'} />
      <ellipse cx={cx - r * 0.33} cy={cy - r * 0.36} rx={r * 0.3} ry={r * 0.22}
               fill="#FFFBE6" opacity="0.5" />
    </g>
  );
}

/* ── Moon ────────────────────────────────────────────────────────────────── */

export function MoonDisc({ cx = 14, cy = 12.5, r = 8.4, animate = true, stars = true }) {
  const id = useId();
  return (
    <g>
      <defs>
        <linearGradient id={`${id}m`} x1="15%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#EDF4FF" />
          <stop offset="100%" stopColor="#B9CEE8" />
        </linearGradient>
        {/* Cutout opens the crescent to the upper right, away from the cloud, so
            the lit limb stays the part that is visible. */}
        <mask id={`${id}cut`}>
          <rect width="48" height="48" fill="white" />
          <circle cx={cx + r * 0.66} cy={cy - r * 0.46} r={r * 0.93} fill="black" />
        </mask>
        {/* Moonlight, for the same reason the sun got a corona — and it matters
            more here, because a night icon has no other light in it. Cool
            rather than warm, and weaker: a moon that glows like the sun stops
            reading as night. Still, at 0.34 over a near-black card this was
            doing nothing, and a night icon with no light in it is just a grey
            shape — so it is roughly doubled and reaches further. */}
        <radialGradient id={`${id}glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#CFE3FF" stopOpacity="0.6" />
          <stop offset="48%" stopColor="#9FC2F0" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#7FA8E0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r * 2.1} fill={`url(#${id}glow)`} />
      <g mask={`url(#${id}cut)`} className={animate ? 'wx wx-anim wx-breathe' : 'wx'}>
        <circle cx={cx} cy={cy} r={r} fill={`url(#${id}m)`} />
        {/* Maria. Three of them, large and low-contrast — at 36px they are not
            read as craters, they are read as "that is the moon and not a
            circle", which is the entire job. */}
        <g fill="#A8BFDB" opacity="0.45">
          <circle cx={cx - r * 0.34} cy={cy - r * 0.18} r={r * 0.27} />
          <circle cx={cx - r * 0.02} cy={cy + r * 0.38} r={r * 0.19} />
          <circle cx={cx - r * 0.5} cy={cy + r * 0.44} r={r * 0.14} />
        </g>
      </g>
      {stars && (
        <g fill="#E6EFFC">
          <circle cx={cx + 12} cy={cy - 8} r="1.4"
                  className={animate ? 'wx wx-anim wx-twinkle wx-d2' : 'wx'} />
          <circle cx={cx + 16} cy={cy - 1.5} r="1"
                  className={animate ? 'wx wx-anim wx-twinkle wx-d4' : 'wx'} />
        </g>
      )}
    </g>
  );
}

/* ── Cloud ───────────────────────────────────────────────────────────────── */

export function CloudShape({ tone = 'light', animate = true, opacity = 1, rim = true }) {
  const id = useId();
  const [from, to] = CLOUD_TONES[tone] || CLOUD_TONES.light;
  return (
    <g className={animate ? 'wx wx-anim wx-drift' : 'wx'} opacity={opacity}>
      <defs>
        <linearGradient id={`${id}c`} x1="22%" y1="0%" x2="55%" y2="100%">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        {/* Cloud has an underside. The single diagonal gradient lit the whole
            shape evenly and left a flat silhouette; a shadow gathering along
            the base is what gives it depth, and it is also the thing that
            makes the lobes at the top read as separate billows.

            This ran at 0.22 and was invisible at icon size. Cloud base really
            is much darker than cloud top — look at any cumulus — so it can
            afford to be heavy, and it needs to be to survive the downscale. */}
        <linearGradient id={`${id}u`} x1="0%" y1="34%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0B1220" stopOpacity="0" />
          <stop offset="100%" stopColor="#0B1220" stopOpacity="0.42" />
        </linearGradient>
        {/* And a top, catching the light from wherever the sun is. Paired with
            the heavier base it gives the shape a direction instead of a wash. */}
        <linearGradient id={`${id}t`} x1="18%" y1="0%" x2="62%" y2="62%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={CLOUD_PATH} fill={`url(#${id}c)`} />
      <path d={CLOUD_PATH} fill={`url(#${id}u)`} />
      <path d={CLOUD_PATH} fill={`url(#${id}t)`} />
      {rim && (
        <path d={CLOUD_PATH} fill="none" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="1.1" />
      )}
    </g>
  );
}

/* ── Precipitation ───────────────────────────────────────────────────────── */

/* Lifted a step each. Rain is drawn under a cloud that is now considerably
   darker at its base, and the old mid-blues sank into that shadow. */
const RAIN = '#5CB8FF';
const RAIN_DEEP = '#2E86E8';
const SNOW = '#F0F8FF';
const STONE_EDGE = '#7BA5C9';

/**
 * Render a payload from precipLayout.js.
 *
 * Kept here rather than in each family file so a drop drawn under a snow icon
 * is the same drop as under a rain icon — sleet needs both in one row and any
 * difference in weight would show.
 */
export function Precip({ marks = [], animate = true }) {
  const cls = (base, delay) => (animate ? `wx wx-anim ${base} ${delay ? `wx-d${delay}` : ''}` : 'wx');
  return (
    <g>
      {marks.map((m, i) => {
        if (m.kind === 'drop') {
          return (
            <line key={i} x1={m.x} y1={m.y} x2={m.x - 1.1} y2={m.y + m.len}
                  stroke={m.hard ? RAIN_DEEP : RAIN} strokeWidth={m.w} strokeLinecap="round"
                  className={cls(m.hard ? 'wx-fall-hard' : 'wx-fall', m.delay)} />
          );
        }
        if (m.kind === 'dot') {
          return <circle key={i} cx={m.x} cy={m.y} r={m.r} fill={RAIN} className={cls('wx-fall', m.delay)} />;
        }
        if (m.kind === 'stone') {
          return (
            <g key={i} className={cls('wx-bounce', m.delay)}>
              <circle cx={m.x} cy={m.y} r={m.r} fill="#FFFFFF" stroke={STONE_EDGE} strokeWidth="0.9" />
              <circle cx={m.x - m.r * 0.3} cy={m.y - m.r * 0.32} r={m.r * 0.28} fill="#FFFFFF" />
            </g>
          );
        }
        // Flake: six points from three crossed strokes. The animation lives on
        // the outer group so the inner translate that places it is untouched —
        // animating a transform on an element that already has one replaces it.
        const h = m.r * 0.866;
        return (
          <g key={i} className={cls('wx-flake', m.delay)}>
            <g transform={`translate(${m.x} ${m.y})`} stroke={SNOW} strokeWidth={m.w} strokeLinecap="round">
              <line x1={-m.r} y1="0" x2={m.r} y2="0" />
              <line x1={-m.r / 2} y1={-h} x2={m.r / 2} y2={h} />
              <line x1={-m.r / 2} y1={h} x2={m.r / 2} y2={-h} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

/* ── Frame ───────────────────────────────────────────────────────────────── */

export function WxSvg({ size = 40, className, style, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none"
         className={className} role="img" aria-hidden="true"
         /* SEPARATION, because these symbols are never drawn on a plain
            background. They sit on a sky — over cloud, over a lit horizon,
            over stars — and a white cloud on a pale sky or a pale moon on a
            grey one loses its edge entirely. A tight dark shadow under the
            whole symbol pins it in front of whatever it lands on, at any size
            and on any of the sixty-six scenes, which no amount of tuning the
            fills can do. Callers can still override it. */
         style={{ filter: 'drop-shadow(0 1.5px 2.5px rgba(2,6,23,0.5))', ...style }}>
      {children}
    </svg>
  );
}

/**
 * Body + cloud + precipitation.
 *
 * `marks` is a payload from precipLayout.js. `cloudOnly` drops the sun/moon and
 * lets the cloud sit at full size and centred, since it no longer has to leave
 * room for anything behind it.
 */
export function PrecipBase({
  night = false, dark = false, cloudOnly = false, marks = [],
  size = 40, className, style, animate = true, tone, children,
}) {
  const cloudTone = tone || (dark ? 'heavy' : cloudOnly ? 'mid' : 'light');
  return (
    <WxSvg size={size} className={className} style={style}>
      {!cloudOnly && (night
        ? <MoonDisc animate={animate} />
        : <SunDisc animate={animate} />)}
      <g transform={cloudOnly ? undefined : CLOUD_OFFSET}>
        <CloudShape tone={cloudTone} animate={animate} />
      </g>
      <Precip marks={marks} animate={animate} />
      {children}
    </WxSvg>
  );
}
