/* ════════════════════════════════════════════════════════════════════════════
   Thunderstorms — isolated, scattered and widespread.

   COVERAGE, NOT SEVERITY. These three answer "how much of the area", which is
   what the forecast terms mean, so the difference is the NUMBER OF CELLS and
   how much clear sky is left between them:

     isolated    one cell, sun well clear beside it
     scattered   two cells, sky between them
     widespread  one dark sheet across the box, no sky, two bolts

   Adding bolts under one cloud would have said "stronger", which is a different
   claim and usually the wrong one.

   THE BOLT sits at the cloud base and hangs below it, so it reads as coming out
   of the cloud. The previous version drew it from y31 to y47 through the middle
   of the precipitation band, crossing the drops and looking like a stray line;
   it is now a compact symmetric zigzag centred under the cloud it belongs to.

   Bolts END LIT — the flash animation finishes at full opacity, so once the
   motion stops the symbol is complete rather than half-faded.
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { WxSvg, SunDisc, CloudShape, CLOUD_OFFSET } from './PrecipBase';
import { Bolt } from './RainIcons';

/** One cell, with the sun clear of it — a storm you could drive around. */
export function IsolatedThunderstormsIcon({ size = 40, className, style, animate = true }) {
  return (
    <WxSvg size={size} className={className} style={style}>
      <SunDisc cx={13} cy={12} r={7.5} animate={animate} />
      <g transform={CLOUD_OFFSET}>
        <CloudShape tone="heavy" animate={animate} />
      </g>
      <Bolt x={25} y={41} scale={1} animate={animate} />
    </WxSvg>
  );
}

/** Two cells with sky between them. */
export function ScatteredThunderstormsIcon({ size = 40, className, style, animate = true }) {
  return (
    <WxSvg size={size} className={className} style={style}>
      {/* Far cell, smaller and paler so it reads as further away. */}
      <g transform="translate(21 1) scale(0.52)" opacity="0.9">
        <CloudShape tone="mid" animate={animate} />
      </g>
      <g transform="translate(-1 8) scale(0.8)">
        <CloudShape tone="heavy" animate={animate} />
      </g>
      <Bolt x={16} y={41} scale={0.9} animate={animate} />
      <Bolt x={35} y={31.5} scale={0.6} animate={animate} delay="wx-d3" />
    </WxSvg>
  );
}

/** Widespread: one dark sheet, no sky, two bolts. */
export function ThunderstormsIcon({ size = 40, className, style, animate = true }) {
  return (
    <WxSvg size={size} className={className} style={style}>
      <g transform="translate(-1 -3) scale(1.06)" opacity="0.95">
        <CloudShape tone="heavy" animate={animate} rim={false} />
      </g>
      <g transform="translate(1 5) scale(1.02)">
        <CloudShape tone="storm" animate={animate} />
      </g>
      <Bolt x={17} y={42} scale={0.95} animate={animate} />
      <Bolt x={31} y={42} scale={0.78} animate={animate} delay="wx-d3" />
    </WxSvg>
  );
}
