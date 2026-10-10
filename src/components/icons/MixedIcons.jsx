/* ════════════════════════════════════════════════════════════════════════════
   Sleet and hail — the mixed-phase icons.

   SLEET ALTERNATES A DROP AND A FLAKE, in separate lanes so they never touch.
   That pairing is the whole idea: sleet is rain and snow falling together, and
   showing both is the only way to say so without a label. The usual shortcut —
   one hybrid glyph — just reads as a badly drawn raindrop.

   HAIL IS ROUND AND HARD-EDGED, and it BOUNCES at the end of its fall where
   rain settles softly. That difference in motion is doing real work: at 16px
   the difference between a white circle and a white flake is marginal, but the
   rebound is not.

   As elsewhere, the three variants are coverage — sun visible means showery and
   intermittent, cloud-only means continuous — not time of day.
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { PrecipBase } from './PrecipBase';
import { LIGHT_SLEET, SLEET, HEAVY_SLEET, LIGHT_HAIL, HAIL, HEAVY_HAIL } from './precipLayout';

export function LightSleetIcon(p) { return <PrecipBase marks={LIGHT_SLEET} {...p} />; }
export function LightSleetNightIcon(p) { return <PrecipBase night marks={LIGHT_SLEET} {...p} />; }
export function LightSleetCloudIcon(p) { return <PrecipBase cloudOnly marks={LIGHT_SLEET} {...p} />; }

export function SleetIcon(p) { return <PrecipBase marks={SLEET} {...p} />; }
export function SleetNightIcon(p) { return <PrecipBase night marks={SLEET} {...p} />; }
export function SleetCloudIcon(p) { return <PrecipBase cloudOnly marks={SLEET} {...p} />; }

export function HeavySleetIcon(p) { return <PrecipBase dark marks={HEAVY_SLEET} {...p} />; }
export function HeavySleetNightIcon(p) { return <PrecipBase night dark marks={HEAVY_SLEET} {...p} />; }
export function HeavySleetCloudIcon(p) { return <PrecipBase cloudOnly tone="heavy" marks={HEAVY_SLEET} {...p} />; }

export function LightHailIcon(p) { return <PrecipBase marks={LIGHT_HAIL} {...p} />; }
export function LightHailNightIcon(p) { return <PrecipBase night marks={LIGHT_HAIL} {...p} />; }
export function LightHailCloudIcon(p) { return <PrecipBase cloudOnly marks={LIGHT_HAIL} {...p} />; }

export function HailIcon(p) { return <PrecipBase marks={HAIL} {...p} />; }
export function HailNightIcon(p) { return <PrecipBase night marks={HAIL} {...p} />; }
export function HailCloudIcon(p) { return <PrecipBase cloudOnly marks={HAIL} {...p} />; }

export function HeavyHailIcon(p) { return <PrecipBase dark marks={HEAVY_HAIL} {...p} />; }
export function HeavyHailNightIcon(p) { return <PrecipBase night dark marks={HEAVY_HAIL} {...p} />; }
export function HeavyHailCloudIcon(p) { return <PrecipBase cloudOnly tone="heavy" marks={HEAVY_HAIL} {...p} />; }
