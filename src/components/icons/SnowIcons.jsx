/* ════════════════════════════════════════════════════════════════════════════
   Snow, from flurries to blizzard.

   AS WITH RAIN, THE THREE VARIANTS ARE COVERAGE, NOT TIME OF DAY:
     <name>Icon       sun visible between bursts -> scattered / short-lived
     <name>NightIcon  the same, at night
     <name>CloudIcon  unbroken cloud             -> continuous through the period

   FLAKES ARE SIX-POINT STARS, NOT DETAILED CRYSTALS. A real dendrite turns to
   mush below about 24px and most of these render in a 16px hourly row. Three
   crossed strokes keep the six-fold symmetry that reads as snow at any size and
   survive the rotation the fall animation applies.

   Flake positions come from precipLayout.js, where every payload is checked for
   collisions — two flakes 5px apart with a 3px radius merge into a blob that
   reads as neither, and that is not something to judge by eye across 75 icons.
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { PrecipBase, WxSvg, SunDisc, MoonDisc, CloudShape, Precip, CLOUD_OFFSET } from './PrecipBase';
import { FLURRY, LIGHT_SNOW, SNOW, HEAVY_SNOW, BLIZZARD } from './precipLayout';

export function FlurryIcon(p) { return <PrecipBase marks={FLURRY} {...p} />; }
export function FlurryNightIcon(p) { return <PrecipBase night marks={FLURRY} {...p} />; }
export function FlurryCloudIcon(p) { return <PrecipBase cloudOnly marks={FLURRY} {...p} />; }

export function LightSnowIcon(p) { return <PrecipBase marks={LIGHT_SNOW} {...p} />; }
export function LightSnowNightIcon(p) { return <PrecipBase night marks={LIGHT_SNOW} {...p} />; }
export function LightSnowCloudIcon(p) { return <PrecipBase cloudOnly marks={LIGHT_SNOW} {...p} />; }

export function SnowIcon(p) { return <PrecipBase marks={SNOW} {...p} />; }
export function SnowNightIcon(p) { return <PrecipBase night marks={SNOW} {...p} />; }
export function SnowCloudIcon(p) { return <PrecipBase cloudOnly marks={SNOW} {...p} />; }

export function HeavySnowIcon(p) { return <PrecipBase dark marks={HEAVY_SNOW} {...p} />; }
export function HeavySnowNightIcon(p) { return <PrecipBase night dark marks={HEAVY_SNOW} {...p} />; }
export function HeavySnowCloudIcon(p) { return <PrecipBase cloudOnly tone="heavy" marks={HEAVY_SNOW} {...p} />; }

/* Blizzard is the one snow icon that is not just "more flakes". At this grade
   the WIND is the story — driving snow, not deep snow — so it gets streaks on
   the left and only two flakes on the right. Adding a full row of flakes as
   well made it indistinguishable from heavy snow. */
function BlizzardBody({ night, cloudOnly, animate = true }) {
  const cls = (d) => (animate ? `wx wx-anim wx-sweep ${d}` : 'wx');
  return (
    <>
      {!cloudOnly && (night ? <MoonDisc animate={animate} /> : <SunDisc animate={animate} />)}
      <g transform={cloudOnly ? undefined : CLOUD_OFFSET}>
        <CloudShape tone={cloudOnly ? 'storm' : 'heavy'} animate={animate} />
      </g>
      <g stroke="#DCEBFA" strokeWidth="2.1" strokeLinecap="round" opacity="0.9">
        <line x1="6" y1="38.5" x2="21" y2="38.5" className={cls('')} />
        <line x1="9" y1="43" x2="26" y2="43" className={cls('wx-d2')} />
        <line x1="6" y1="47" x2="18" y2="47" className={cls('wx-d4')} />
      </g>
      <Precip marks={BLIZZARD} animate={animate} />
    </>
  );
}

export function BlizzardIcon(p) { return <WxSvg {...p}><BlizzardBody animate={p?.animate} /></WxSvg>; }
export function BlizzardNightIcon(p) { return <WxSvg {...p}><BlizzardBody night animate={p?.animate} /></WxSvg>; }
export function BlizzardCloudIcon(p) { return <WxSvg {...p}><BlizzardBody cloudOnly animate={p?.animate} /></WxSvg>; }
