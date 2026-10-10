/* ════════════════════════════════════════════════════════════════════════════
   Clear, sunny intervals and partly cloudy.

   THE SUN SHRINKS AS THE CLOUD GROWS. Across sunny -> sunny intervals -> partly
   cloudy the disc steps down and the cloud steps up, so the states form an
   obvious series rather than three unrelated pictures. Someone scanning a week
   should see the trend without reading the labels.

   A clear icon is drawn CENTRED AND LARGE because it has the box to itself. The
   moment a cloud joins, the body moves up-left and the cloud goes down-right
   (CLOUD_OFFSET) so the disc stays mostly visible — the amount of sun showing
   is the whole difference between these three states, and hiding it behind the
   cloud collapses them into one.
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { WxSvg, SunDisc, MoonDisc, CloudShape, CLOUD_OFFSET } from './PrecipBase';

/** Full sun, centred. */
export function SunnyIcon({ size = 40, className, style, animate = true }) {
  return (
    <WxSvg size={size} className={className} style={style}>
      <SunDisc cx={24} cy={24} r={10.5} animate={animate} />
    </WxSvg>
  );
}

/** Clear night: crescent, centred, with a small constellation for legibility. */
export function ClearNightIcon({ size = 40, className, style, animate = true }) {
  return (
    <WxSvg size={size} className={className} style={style}>
      <MoonDisc cx={21} cy={24} r={12} animate={animate} stars={false} />
      <g fill="#E6EFFC">
        <circle cx="39" cy="13" r="1.7" className={animate ? 'wx wx-anim wx-twinkle wx-d1' : 'wx'} />
        <circle cx="43" cy="22" r="1.2" className={animate ? 'wx wx-anim wx-twinkle wx-d3' : 'wx'} />
        <circle cx="36" cy="30" r="1" className={animate ? 'wx wx-anim wx-twinkle wx-d5' : 'wx'} />
      </g>
    </WxSvg>
  );
}

/* Sunny intervals: the body is still the subject, so the cloud is smaller than
   the partly-cloudy one and tucked low and right, leaving most of the disc
   clear. Same cloud shape as everywhere else, just scaled — a different
   silhouette here would break the set. */
function Intervals({ night, animate }) {
  return (
    <>
      {night
        ? <MoonDisc cx={19} cy={17} r={10} animate={animate} stars={false} />
        : <SunDisc cx={19} cy={17} r={9.5} animate={animate} />}
      <g transform="translate(14 17) scale(0.62)">
        <CloudShape tone="light" animate={animate} />
      </g>
    </>
  );
}

export function SunnyIntervalsIcon({ size = 40, className, style, animate = true }) {
  return <WxSvg size={size} className={className} style={style}><Intervals animate={animate} /></WxSvg>;
}

export function SunnyIntervalsNightIcon({ size = 40, className, style, animate = true }) {
  return <WxSvg size={size} className={className} style={style}><Intervals night animate={animate} /></WxSvg>;
}

/** A broken-sky treatment: sun with two smaller clouds either side. */
export function SunnyIntervalsV2Icon({ size = 40, className, style, animate = true }) {
  return (
    <WxSvg size={size} className={className} style={style}>
      <SunDisc cx={23} cy={17} r={9} animate={animate} />
      <g transform="translate(0 22) scale(0.44)" opacity="0.9">
        <CloudShape tone="mid" animate={animate} />
      </g>
      <g transform="translate(19 20) scale(0.58)">
        <CloudShape tone="light" animate={animate} />
      </g>
    </WxSvg>
  );
}

/* Partly cloudy: cloud leads, body sits proud at the top left. This is the
   standard framing the precipitation icons use, without the precipitation. */
export function PartlyCloudyIcon({ size = 40, className, style, animate = true }) {
  return (
    <WxSvg size={size} className={className} style={style}>
      <SunDisc animate={animate} />
      <g transform={CLOUD_OFFSET}><CloudShape tone="light" animate={animate} /></g>
    </WxSvg>
  );
}

export function PartlyCloudyNightIcon({ size = 40, className, style, animate = true }) {
  return (
    <WxSvg size={size} className={className} style={style}>
      <MoonDisc animate={animate} />
      <g transform={CLOUD_OFFSET}><CloudShape tone="light" animate={animate} /></g>
    </WxSvg>
  );
}
