/* The outlook graphics' liquid glass and their footer (Thunderstorm, Snow, Wind, and the timeline
   pill they share).

   The glass is clear rather than frosted: a light blur with a saturation lift, a slight indigo
   tint, bright rims (a specular top edge and left edge, a softer refracted rim along the bottom)
   and light pooling inside the top lip and the lower edge, the way a curved pane gathers it.

   EXPORT. `backdrop-filter` cannot survive the JPG export: the graphic is drawn from an SVG
   <foreignObject>, where nothing is "behind" a panel. So the export first renders the graphic
   WITHOUT its glass (each panel carries `--glass` in its style for the filter), blurs that the way
   the glass does, and hands it round through GlassBackdropContext. Each panel's GlassSheen then
   lays that picture in, lined up with where the panel sits on the graphic, and draws the tint and
   rims over it. The exported panels show the real map and storm photo through them, as on screen.
   Without a backdrop (the WebM frames) the panels fall back to a
   flat fill of the colour the glass comes to over the dark graphic.

   glass(extra, mode): mode false (on screen), 'backdrop' (export with the blurred picture) or
   true (flat fallback). */
import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { toCanvas } from 'html-to-image';

export const GlassBackdropContext = createContext(null);

const TINT = 'linear-gradient(160deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 40%, rgba(255,255,255,0.02) 62%, rgba(255,255,255,0.07) 100%), linear-gradient(180deg, rgba(38,50,98,0.36) 0%, rgba(24,32,70,0.42) 100%)';
const FLAT = 'linear-gradient(160deg, rgba(58,68,104,0.94) 0%, rgba(32,40,72,0.95) 45%, rgba(22,28,56,0.96) 100%)';
const RIMS = [
  'inset 0 1px 0 rgba(255,255,255,0.58)',
  'inset 1px 0 0 rgba(255,255,255,0.20)',
  'inset -1px 0 0 rgba(255,255,255,0.08)',
  'inset 0 -1px 0 rgba(255,255,255,0.16)',
  'inset 0 12px 20px -16px rgba(255,255,255,0.40)',
  'inset 0 -16px 24px -18px rgba(150,178,255,0.34)',
].join(', ');
const LIFT = '0 14px 34px rgba(0,0,0,0.40), 0 2px 8px rgba(0,0,0,0.24)';
const BLUR = 'blur(12px) saturate(175%) brightness(1.06)';

export const glass = (extra = {}, mode = false) => ({
  '--glass': '1',
  background: mode === 'backdrop' ? 'none' : mode ? FLAT : TINT,
  border: '1px solid rgba(255,255,255,0.24)',
  boxShadow: mode === 'backdrop' ? LIFT : `${LIFT}, ${RIMS}`,
  ...(mode ? {} : { backdropFilter: BLUR, WebkitBackdropFilter: BLUR }),
  // `extra` wins every collision, `position` included: pass a panel's layout in here.
  borderRadius: 14, position: 'relative', overflow: 'hidden', ...extra,
});

/** The panel's mode from the tool's exportMode and whether a backdrop is on offer. */
export function useGlassMode(exportMode) {
  const backdrop = useContext(GlassBackdropContext);
  return exportMode ? (backdrop ? 'backdrop' : true) : false;
}

/* the blurred picture, placed so it lines up with the graphic behind this panel */
function Backdrop({ src }) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current, panel = el?.parentElement, root = el?.closest('[data-graphic-root]');
    if (!panel || !root) return;
    const rr = root.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const k = rr.width / root.offsetWidth || 1;                 // the preview's scale
    const s = pr.width / k / (panel.offsetWidth || 1) || 1;     // the panel's own (a scaled header)
    const cs = getComputedStyle(panel);
    const next = {
      left: -((pr.left - rr.left) / k) / s - parseFloat(cs.borderLeftWidth || 0),
      top: -((pr.top - rr.top) / k) / s - parseFloat(cs.borderTopWidth || 0),
      width: root.offsetWidth / s, height: root.offsetHeight / s,
    };
    if (!box || Object.keys(next).some((key) => Math.abs(next[key] - box[key]) > 0.25)) setBox(next);
  });
  return (
    <>
      <img ref={ref} src={src} alt="" style={{ position: 'absolute', zIndex: 0, pointerEvents: 'none', maxWidth: 'none', ...(box || { visibility: 'hidden' }) }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: TINT }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', borderRadius: 'inherit', boxShadow: RIMS }} />
    </>
  );
}

/** The highlights every glass panel carries (and, in an export, the picture behind it). */
export function GlassSheen() {
  const backdrop = useContext(GlassBackdropContext);
  return (
    <>
      {backdrop && <Backdrop src={backdrop} />}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: 'radial-gradient(130% 85% at 0% 0%, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.06) 36%, transparent 62%)' }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: 'radial-gradient(70% 60% at 100% 100%, rgba(165,190,255,0.16) 0%, transparent 70%)' }} />
      <div style={{ position: 'absolute', top: 1, left: '10%', right: '10%', height: 1, zIndex: 0, pointerEvents: 'none', background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.70) 50%, transparent 100%)' }} />
    </>
  );
}

/** The graphic drawn without its glass and blurred the way the glass blurs, as a data URL. */
export async function captureBackdrop(node, { width, height, backgroundColor }) {
  const c = await toCanvas(node, {
    width, height, pixelRatio: 2, backgroundColor, cacheBust: true,
    style: { transform: 'none', transformOrigin: 'top left', margin: '0' },
    filter: (n) => !(n?.style?.getPropertyValue && n.style.getPropertyValue('--glass')),
  });
  const out = document.createElement('canvas');
  out.width = c.width; out.height = c.height;
  const g = out.getContext('2d');
  g.fillStyle = backgroundColor; g.fillRect(0, 0, out.width, out.height);
  g.filter = 'blur(24px) saturate(175%) brightness(1.06)';   // 12 px at the 2x it was drawn at
  g.drawImage(c, 0, 0);
  return out.toDataURL('image/jpeg', 0.92);
}

/** The bottom of the graphic: the logo and handle in the bottom-left corner, and in the
    bottom-right, straight on the graphic (no glass round it), the caption, one compact issue /
    valid / issued line and the notice (or, on the radar, the live status). */
export function GraphicFooter({
  logoUrl, FallbackIcon, handle, version, radar = false, caption, forecastLabel, update = false,
  validDate, validUntil, tzAbbr, regionLabel, madeWith = false,
}) {
  const seg ={ padding: '0 7px', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' };
  const bar = <span style={{ width: 1, alignSelf: 'stretch', margin: '2px 0', background: 'rgba(255,255,255,0.20)' }} />;
  const fmt = (d, o) => d.toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, ...o });
  const until = validUntil ? new Date(validUntil) : null;
  const expired = until && !Number.isNaN(until.getTime()) && until.getTime() < Date.now();
  const dot = (c) => <span style={{ width: 5, height: 5, borderRadius: '50%', background: c, boxShadow: `0 0 6px ${c}` }} />;
  return (
    <>
      <div style={{ position: 'absolute', left: 12, bottom: 10, zIndex: 6, display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
        {logoUrl
          ? <img src={logoUrl} alt="MyWeatherUK" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.18)' }} />
          : <div style={{ width: 32, height: 32, borderRadius: '50%', background: radar ? '#0ea5e9' : '#5b6ee8', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.18)' }}>
              {FallbackIcon && <FallbackIcon style={{ width: 16, height: 16, color: '#fff' }} />}
            </div>}
        <div style={{ display: 'flex', flexDirection: 'column', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.01em' }}>{handle}</span>
          {/* the public Graphic Studio's graphics say where they were made, in place of the version */}
          {madeWith
            ? <span style={{ fontSize: 7.5, fontWeight: 700, color: 'rgba(186,200,220,0.92)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>Made with MyWeatherUK Graphic Studio</span>
            : version ? <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(148,163,184,0.9)', letterSpacing: '0.20em', textTransform: 'uppercase', marginTop: 1 }}>{version}</span> : null}
        </div>
      </div>

      <div style={{ position: 'absolute', right: 14, bottom: 11, zIndex: 6, maxWidth: 440, pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.75)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          {!radar && caption && (
            <span style={{ fontSize: 9.5, fontWeight: 650, color: 'rgba(226,232,240,0.92)', letterSpacing: '0.03em', lineHeight: 1.2, textAlign: 'right' }}>{caption}</span>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', minHeight: 17, borderRadius: 999, padding: '0 2px',
            background: 'rgba(8,12,28,0.45)', border: '1px solid rgba(255,255,255,0.16)',
            fontSize: 7.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'rgba(226,232,240,0.95)',
          }}>
            {radar ? (
              <>
                <span style={{ ...seg, color: '#fecaca' }}>{dot('#f87171')}Live</span>{bar}
                <span style={{ ...seg, color: 'rgba(186,230,253,0.95)' }}>{regionLabel}</span>{bar}
                <span style={seg}>Updated {fmt(new Date(), { hour: '2-digit', minute: '2-digit' })} {tzAbbr}</span>
              </>
            ) : (
              <>
                <span style={{ ...seg, color: update ? 'rgba(186,230,253,0.98)' : 'rgba(187,247,208,0.98)' }}>{dot(update ? '#38bdf8' : '#4ade80')}{forecastLabel}</span>{bar}
                <span style={seg}>Valid {new Date(`${validDate}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>{bar}
                <span style={{ ...seg, color: 'rgba(199,210,254,0.98)' }}>Issued {fmt(new Date(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} {tzAbbr}</span>
                {until && !Number.isNaN(until.getTime()) && (
                  <>{bar}<span style={{ ...seg, color: expired ? 'rgba(254,202,202,0.98)' : 'rgba(254,240,138,0.98)' }}>
                    {expired ? 'Expired' : 'Until'} {until.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} {tzAbbr}
                  </span></>
                )}
              </>
            )}
          </div>
          <span style={{ fontSize: 6.8, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1.3, textAlign: 'right', color: radar ? 'rgba(255,255,255,0.45)' : 'rgba(252,211,77,0.92)' }}>
            {radar ? 'Radar & lightning: Met Office' : 'Not official · Guidance only · Refer to Met Office warnings'}
          </span>
        </div>
      </div>
    </>
  );
}
