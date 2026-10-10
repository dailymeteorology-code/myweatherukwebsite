/* ════════════════════════════════════════════════════════════════════════════
   Rain, showers and thundery showers.

   THE THREE VARIANTS ARE NOT DAY / NIGHT / DARK — they are how much of the
   period the weather covers:

     <name>Icon        the sun is out between bursts  -> showery, intermittent
     <name>NightIcon   the same, at night
     <name>CloudIcon   no break in the cloud          -> continuous, all period

   So "Heavy Rain" with a sun is heavy rain THAT COMES AND GOES, and the Cloud
   variant is heavy rain that does not stop. The names are historical and read
   as a clock; they are really a coverage scale, which is why the sun and moon
   are drawn well clear of the cloud — that gap is the information.

   INTENSITY is carried by drop count, drop length and cloud tone together.
   Any one alone fails somewhere: count is unreadable at 16px, length looks like
   a glitch, tone disappears on a dark background. Coordinates live in
   precipLayout.js, where the spacing is machine-checked for collisions.
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { PrecipBase, WxSvg, SunDisc, MoonDisc, CloudShape, Precip, CLOUD_OFFSET } from './PrecipBase';
import {
  DRIZZLE, LIGHT_RAIN, MODERATE_RAIN, HEAVY_RAIN, TORRENTIAL_RAIN,
  RAIN_SHOWER, MODERATE_SHOWER, HEAVY_SHOWER, THUNDERY_SHOWER,
} from './precipLayout';

export function DrizzleIcon(p) { return <PrecipBase marks={DRIZZLE} {...p} />; }
export function DrizzleNightIcon(p) { return <PrecipBase night marks={DRIZZLE} {...p} />; }
export function DrizzleCloudIcon(p) { return <PrecipBase cloudOnly marks={DRIZZLE} {...p} />; }

export function LightRainIcon(p) { return <PrecipBase marks={LIGHT_RAIN} {...p} />; }
export function LightRainNightIcon(p) { return <PrecipBase night marks={LIGHT_RAIN} {...p} />; }
export function LightRainCloudIcon(p) { return <PrecipBase cloudOnly marks={LIGHT_RAIN} {...p} />; }

export function ModerateRainIcon(p) { return <PrecipBase marks={MODERATE_RAIN} {...p} />; }
export function ModerateRainNightIcon(p) { return <PrecipBase night marks={MODERATE_RAIN} {...p} />; }
export function ModerateRainCloudIcon(p) { return <PrecipBase cloudOnly marks={MODERATE_RAIN} {...p} />; }

export function HeavyRainIcon(p) { return <PrecipBase dark marks={HEAVY_RAIN} {...p} />; }
export function HeavyRainNightIcon(p) { return <PrecipBase night dark marks={HEAVY_RAIN} {...p} />; }
export function HeavyRainCloudIcon(p) { return <PrecipBase cloudOnly tone="heavy" marks={HEAVY_RAIN} {...p} />; }

export function TorrentialRainIcon(p) { return <PrecipBase dark marks={TORRENTIAL_RAIN} {...p} />; }
export function TorrentialRainNightIcon(p) { return <PrecipBase night dark marks={TORRENTIAL_RAIN} {...p} />; }
export function TorrentialRainCloudIcon(p) { return <PrecipBase cloudOnly tone="storm" marks={TORRENTIAL_RAIN} {...p} />; }

export function RainShowerIcon(p) { return <PrecipBase marks={RAIN_SHOWER} {...p} />; }
export function RainShowerNightIcon(p) { return <PrecipBase night marks={RAIN_SHOWER} {...p} />; }
export function RainShowerCloudIcon(p) { return <PrecipBase cloudOnly marks={RAIN_SHOWER} {...p} />; }

export function ModerateShowerIcon(p) { return <PrecipBase marks={MODERATE_SHOWER} {...p} />; }
export function ModerateShowerNightIcon(p) { return <PrecipBase night marks={MODERATE_SHOWER} {...p} />; }
export function ModerateShowerCloudIcon(p) { return <PrecipBase cloudOnly marks={MODERATE_SHOWER} {...p} />; }

export function HeavyShowersIcon(p) { return <PrecipBase dark marks={HEAVY_SHOWER} {...p} />; }
export function HeavyShowersNightIcon(p) { return <PrecipBase night dark marks={HEAVY_SHOWER} {...p} />; }
export function HeavyShowersCloudIcon(p) { return <PrecipBase cloudOnly tone="heavy" marks={HEAVY_SHOWER} {...p} />; }

/* Thundery shower gets its own body rather than going through PrecipBase: the
   bolt has to be drawn BETWEEN the cloud and the drops so it appears to come
   out of the cloud base, and PrecipBase puts children after everything. */
function ThunderyBody({ night, cloudOnly, animate = true, tone }) {
  return (
    <>
      {!cloudOnly && (night ? <MoonDisc animate={animate} /> : <SunDisc animate={animate} />)}
      <g transform={cloudOnly ? undefined : CLOUD_OFFSET}>
        <CloudShape tone={tone || (cloudOnly ? 'storm' : 'heavy')} animate={animate} />
      </g>
      <Bolt x={24} y={41.5} scale={1} animate={animate} />
      <Precip marks={THUNDERY_SHOWER} animate={animate} />
    </>
  );
}

/** Lightning bolt, centred on (x, y). Symmetric zigzag, amber over a dark edge. */
export function Bolt({ x = 24, y = 41, scale = 1, animate = true, delay = '' }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M2,-8 L-6,2 L-1,2 L-3,8 L6,-2 L1,-2 Z"
            fill="#FFC53D" stroke="#D97706" strokeWidth="0.9" strokeLinejoin="round"
            className={animate ? `wx wx-anim wx-flash ${delay}` : 'wx'} />
    </g>
  );
}

export function ThunderyShowerIcon(p) {
  return <WxSvg {...p}><ThunderyBody animate={p?.animate} /></WxSvg>;
}
export function ThunderyShowerNightIcon(p) {
  return <WxSvg {...p}><ThunderyBody night animate={p?.animate} /></WxSvg>;
}
export function ThunderyShowerCloudIcon(p) {
  return <WxSvg {...p}><ThunderyBody cloudOnly animate={p?.animate} /></WxSvg>;
}
