/* ════════════════════════════════════════════════════════════════════════════
   Cloud, overcast, fog, mist and wind.

   CLOUDY IS ONE CLOUD. OVERCAST IS THE FULL SHEET. Cloudy means cloud is the
   dominant feature; overcast means the sky is completely covered, so it gets
   two layers filling the frame corner to corner with no gap left. Drawing both
   as multi-cloud arrangements and separating them by grey alone did not work —
   on a dark page the tone difference vanished and they were the same picture.

   FOG vs MIST is density, not shape: fog gets thick, near-full-width bands,
   mist gets thin short translucent ones. Both sweep sideways rather than
   falling, which is the motion that reads as "hanging in the air".
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { WxSvg, CloudShape } from './PrecipBase';

/** Cloudy: a single cloud, centred and full size. Nothing else. */
export function CloudyIcon({ size = 40, className, style, animate = true }) {
  return (
    <WxSvg size={size} className={className} style={style}>
      <g transform="translate(0 5)">
        <CloudShape tone="light" animate={animate} />
      </g>
    </WxSvg>
  );
}

/** Overcast: layered cloud filling the box, no sky showing through. */
export function OvercastIcon({ size = 40, className, style, animate = true }) {
  return (
    <WxSvg size={size} className={className} style={style}>
      {/* Upper sheet, wide and flat, closing off the top corners. */}
      <g transform="translate(-1 -4) scale(1.06)" opacity="0.95">
        <CloudShape tone="mid" animate={animate} rim={false} />
      </g>
      {/* Lower sheet, darker and offset, so the two read as depth of cover
          rather than as two separate clouds with sky between them. */}
      <g transform="translate(1 6) scale(1.02)">
        <CloudShape tone="heavy" animate={animate} />
      </g>
    </WxSvg>
  );
}

/** Fog: thick bands lying across and below the cloud. */
export function FogIcon({ size = 40, className, style, animate = true }) {
  const cls = (d) => (animate ? `wx wx-anim wx-sweep ${d}` : 'wx');
  return (
    <WxSvg size={size} className={className} style={style}>
      <g transform="translate(0 -1) scale(0.96)">
        <CloudShape tone="mid" animate={animate} />
      </g>
      <g stroke="#CFE0EF" strokeWidth="3" strokeLinecap="round">
        <line x1="7" y1="36.5" x2="41" y2="36.5" className={cls('')} />
        <line x1="11" y1="42" x2="37" y2="42" className={cls('wx-d2')} />
        <line x1="8" y1="46.5" x2="32" y2="46.5" className={cls('wx-d4')} />
      </g>
    </WxSvg>
  );
}

/** Mist: same idea, thinner and more transparent. */
export function MistIcon({ size = 40, className, style, animate = true }) {
  const cls = (d) => (animate ? `wx wx-anim wx-sweep ${d}` : 'wx');
  return (
    <WxSvg size={size} className={className} style={style}>
      <g transform="translate(0 -1) scale(0.96)" opacity="0.85">
        <CloudShape tone="light" animate={animate} />
      </g>
      <g stroke="#DCEAF6" strokeWidth="2" strokeLinecap="round" opacity="0.8">
        <line x1="11" y1="37" x2="30" y2="37" className={cls('')} />
        <line x1="16" y1="42" x2="39" y2="42" className={cls('wx-d2')} />
        <line x1="12" y1="46.5" x2="28" y2="46.5" className={cls('wx-d4')} />
      </g>
    </WxSvg>
  );
}

/**
 * Wind: three streamlines, each hooking over at its right-hand end.
 *
 * No cloud — wind is not a state of the sky, and adding one made it read as
 * "cloudy and a bit breezy".
 *
 * THE HOOKS ARE WHY THIS WAS BROKEN, and the cause was the CHORD, not the
 * large-arc flag. Sweep angle is 2*asin(chord / 2r), so how far an arc turns
 * depends on how close its endpoints sit to a full diameter apart:
 *
 *     old: chord 5.94, r 4.2  -> 71% of the diameter -> ~270deg
 *     new: chord 7.35, r 4    -> 92% of the diameter -> ~204deg
 *
 * At 71% the "long way round" is most of a circle, so each hook curled back on
 * itself into a closed loop — a line with a balloon tied to it. Pushing the
 * endpoints out to ~92% of the diameter leaves the long arc just past a half
 * turn, which is the shepherd's-crook shape a wind streamline wants.
 *
 * Proportions are the conventional three-streamline figure scaled into the
 * 48-unit box. Every chord is shorter than its diameter, so no radius has to be
 * silently enlarged by the renderer.
 */
export function WindyIcon({ size = 40, className, style, animate = true }) {
  const cls = (d) => (animate ? `wx wx-anim wx-sweep ${d}` : 'wx');
  const id = 'wind';
  return (
    <WxSvg size={size} className={className} style={style}>
      <defs>
        <linearGradient id={`${id}g`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#C3DCF3" />
          <stop offset="100%" stopColor="#7FB0DA" />
        </linearGradient>
      </defs>
      {/* Drawn CROOK FIRST, then the straight run leftward, so the arc's start
          point is free to sit where the geometry needs it rather than being
          pinned to the end of a horizontal line. */}
      <g stroke={`url(#${id}g)`} strokeWidth="3.4" strokeLinecap="round" fill="none">
        {/* Top: crook over the top, then back across. */}
        <path d="M19.2,9.2 A4,4 0 1,1 22,16 H4" className={cls('')} />
        {/* Middle: longest run, largest crook — the icon's spine. */}
        <path d="M35.4,15.4 A5,5 0 1,1 39,24 H4" className={cls('wx-d2')} />
        {/* Bottom: crook under, mirroring the top so the three read as flow. */}
        <path d="M25.2,38.8 A4,4 0 1,0 28,32 H4" className={cls('wx-d4')} />
      </g>
    </WxSvg>
  );
}
