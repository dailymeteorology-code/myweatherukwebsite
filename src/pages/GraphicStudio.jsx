/* Graphic Studio: the public one (/GraphicStudio; the old /ThunderstormStudio comes here).

   The admin Graphic Studio's outlook graphics for everyone: thunderstorm, snow chance, snow
   accumulation, snow risk and wind, each the admin's own tool in its `basic` set. Everything for
   drawing a good outlook (areas, labels, arrows, conditional areas and their hours, levels, the
   timeline, hazards, the map's counties and towns, confidence, a discussion) and a JPG to
   download, without the admin's data tools (the TCM NOVA and model imports, the model layers, the
   lightning check, the live radar graphic, the film). Graphics are saved to the visitor's own
   account. The temperature map, areas of interest, map drawing, past & future and the eclipse
   stay in Admin Settings.

   Liquid glass in the site's light and dark themes: the page sets the admin glass colours
   (adminTheme's adTokens), which the tools' controls (studio/StudioUI) take. */
import React, { useEffect, useState } from 'react';
import { CloudLightning, Snowflake, Layers, CloudSnow, Wind, Sparkles, Download, Pen, Save } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { adTokens, ADMIN_FONT } from '@/components/admin/adminTheme';
import StormOutlookGraphicTool from '@/components/StormOutlookGraphicTool';
import SnowOutlookGraphicTool from '@/components/SnowOutlookGraphicTool';

const TOOLS = [
  { id: 'outlook',  label: 'Thunderstorm Outlook', icon: CloudLightning, color: '#eab308', desc: 'Thunderstorm risk areas, with a timeline and the hazards' },
  { id: 'snow',     label: 'Snow Chance',          icon: Snowflake,      color: '#38bdf8', desc: 'The chance of settling snow' },
  { id: 'snowacc',  label: 'Snow Accumulation',    icon: Layers,         color: '#60a5fa', desc: 'How much snow could settle, in cm' },
  { id: 'snowrisk', label: 'Snow Risk',            icon: CloudSnow,      color: '#a78bfa', desc: 'The risk of disruption from snow and ice' },
  { id: 'wind',     label: 'Wind Gusts',           icon: Wind,           color: '#fb923c', desc: 'Peak gusts, in mph' },
];
const TOOL_KEY = 'mwuk_public_studio_tool';
const STEPS = [
  [Pen, 'Draw', 'Pick a level and drag over the map to draw an area. Select an area to change it, move it or give it its hours.'],
  [Sparkles, 'Fill it in', 'Mark the timeline’s hours, tick the hazards and set the day, the confidence and your handle.'],
  [Download, 'Download', 'Download a sharp JPG, ready to post.'],
  [Save, 'Keep it', 'Log in to save your graphics to your account and open them again later.'],
];

const CSS = `
${adTokens('.gs-root', '.gs-root.is-light')}
.gs-root { position: relative; min-height: 100vh; min-height: 100dvh; background: var(--ad-bg); color: var(--ad-text); font-family: ${ADMIN_FONT};
  -webkit-font-smoothing: antialiased; transition: background .4s ease; overflow-x: clip; }
.gs-root *, .gs-root *::before, .gs-root *::after { box-sizing: border-box; }
.gs-root input[type='datetime-local'], .gs-root input[type='date'], .gs-root input[type='time'] { color-scheme: dark; }
.gs-root.is-light input[type='datetime-local'], .gs-root.is-light input[type='date'], .gs-root.is-light input[type='time'] { color-scheme: light; }
.gs-root select option { background: var(--ad-bg); color: var(--ad-text); }
.gs-ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.gs-ambient i { position: absolute; display: block; border-radius: 50%; }
.gs-ambient i:nth-child(1) { width: 70vw; height: 70vw; top: -26vw; left: -18vw; background: radial-gradient(circle, var(--ad-orb-a), transparent 62%); }
.gs-ambient i:nth-child(2) { width: 60vw; height: 60vw; top: 18vh; right: -24vw; background: radial-gradient(circle, var(--ad-orb-b), transparent 62%); }
.gs-ambient i:nth-child(3) { width: 56vw; height: 56vw; bottom: -24vw; left: 18vw; background: radial-gradient(circle, var(--ad-orb-c), transparent 62%); }
.gs-wrap { position: relative; z-index: 1; width: min(1380px, 100%); margin: 0 auto; padding: clamp(14px, 3vw, 28px) clamp(10px, 2.4vw, 24px) 48px; display: flex; flex-direction: column; gap: 16px; }
.gs-glass { position: relative; background: var(--ad-surface); border: 1px solid var(--ad-border); border-radius: 26px;
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%); box-shadow: var(--ad-shadow), inset 0 1px 0 var(--ad-highlight); }
.gs-hero { padding: clamp(18px, 3vw, 28px); overflow: hidden; }
.gs-hero::before { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, #ec4899 16%, transparent), transparent 55%), radial-gradient(90% 80% at 100% 0%, color-mix(in srgb, #38bdf8 14%, transparent), transparent 60%); }
.gs-hero > * { position: relative; }
.gs-eyebrow { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 8px; padding: 4px 10px; border-radius: 99px; font-size: 10.5px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
  color: #ec4899; background: color-mix(in srgb, #ec4899 12%, transparent); border: 1px solid color-mix(in srgb, #ec4899 30%, transparent); }
.gs-eyebrow svg { width: 12px; height: 12px; }
.gs-hero h1 { margin: 0; font-size: clamp(28px, 5vw, 44px); font-weight: 800; letter-spacing: -.035em; line-height: 1.02; }
.gs-hero h1 span { background: linear-gradient(90deg, #ec4899, #a78bfa 45%, #38bdf8); -webkit-background-clip: text; background-clip: text; color: transparent; }
.gs-lede { margin: 10px 0 0; max-width: 720px; font-size: 14.5px; line-height: 1.55; color: var(--ad-text-mid); }
.gs-tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 20px; }
.gs-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 9px; padding: 13px 13px 12px; border-radius: 18px; cursor: pointer; font: inherit; text-align: left;
  color: var(--ad-text-mid); background: var(--ad-surface); border: 1px solid var(--ad-border); transition: background .15s, border-color .15s, transform .15s, box-shadow .15s; }
.gs-tile:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--c) 40%, var(--ad-border)); }
.gs-tile.is-on { color: var(--ad-text); background: color-mix(in srgb, var(--c) 12%, var(--ad-surface2)); border-color: color-mix(in srgb, var(--c) 55%, transparent);
  box-shadow: 0 10px 26px -14px color-mix(in srgb, var(--c) 80%, transparent), inset 0 1px 0 var(--ad-highlight); }
.gs-tile > span { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; color: var(--c); background: color-mix(in srgb, var(--c) 15%, transparent); }
.gs-tile > span svg { width: 19px; height: 19px; }
.gs-tile b { font-size: 13px; font-weight: 750; letter-spacing: -.01em; color: var(--ad-text); }
.gs-tile small { font-size: 11.5px; line-height: 1.35; color: var(--ad-text-dim); }
.gs-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
.gs-step { display: flex; gap: 10px; align-items: flex-start; padding: 11px 12px; border-radius: 16px; background: var(--ad-surface3); border: 1px solid var(--ad-border); }
.gs-step > svg { flex: 0 0 auto; width: 16px; height: 16px; margin-top: 1px; color: var(--ad-sky); }
.gs-step b { display: block; font-size: 12.5px; font-weight: 750; }
.gs-step small { display: block; margin-top: 2px; font-size: 11.5px; line-height: 1.4; color: var(--ad-text-dim); }
.gs-tool { overflow: visible; }
.gs-tool-head { display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-bottom: 1px solid var(--ad-border); }
.gs-tool-head svg { width: 17px; height: 17px; flex-shrink: 0; color: var(--c); }
.gs-tool-head b { font-size: 14px; font-weight: 750; }
.gs-tool-head small { font-size: 12.5px; color: var(--ad-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gs-tool-body { padding: 16px 14px; }
/* the drawing toolbar stays in view under the site's own bar */
.gs-root .sg-preview > .sg-toolbar { top: 70px; }
@media (max-width: 1000px) { .gs-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); } .gs-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) {
  .gs-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .gs-tile small { display: none; }
  .gs-steps { grid-template-columns: minmax(0, 1fr); }
  .gs-tool-body { padding: 10px 6px; }
  .gs-tool-head small { display: none; }
}
@media (prefers-reduced-motion: reduce) { .gs-root * { transition: none !important; } }
`;

export default function GraphicStudio() {
  const { isDark } = useTheme();
  /* the tool last used is the one that opens */
  const [tool, setTool] = useState(() => { try { const s = localStorage.getItem(TOOL_KEY); return TOOLS.some((t) => t.id === s) ? s : 'outlook'; } catch { return 'outlook'; } });
  useEffect(() => { try { localStorage.setItem(TOOL_KEY, tool); } catch { /* storage blocked */ } }, [tool]);
  useEffect(() => { document.title = 'Graphic Studio · MyWeatherUK'; }, []);
  const cur = TOOLS.find((t) => t.id === tool) || TOOLS[0];
  const CurIcon = cur.icon;

  return (
    <div className={`gs-root${isDark ? '' : ' is-light'}`}>
      <style>{CSS}</style>
      <div className="gs-ambient" aria-hidden="true"><i /><i /><i /></div>
      <main className="gs-wrap">
        <header className="gs-glass gs-hero">
          <p className="gs-eyebrow"><Sparkles />MyWeatherUK</p>
          <h1><span>Graphic Studio</span></h1>
          <p className="gs-lede">
            Make your own weather outlook graphics: thunderstorms, snow and wind, on a map of the UK and Ireland or just the counties you choose.
            Draw the risk areas, mark the hours, then download a graphic ready to post.
          </p>
          <div className="gs-tiles" role="tablist" aria-label="Graphic">
            {TOOLS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tool === t.id} className={`gs-tile${tool === t.id ? ' is-on' : ''}`}
                style={{ '--c': t.color }} onClick={() => setTool(t.id)}>
                <span><t.icon /></span><b>{t.label}</b><small>{t.desc}</small>
              </button>
            ))}
          </div>
          <div className="gs-steps">
            {STEPS.map(([Icon, title, text]) => <div key={title} className="gs-step"><Icon /><div><b>{title}</b><small>{text}</small></div></div>)}
          </div>
        </header>

        <section className="gs-glass gs-tool" style={{ '--c': cur.color }} aria-label={cur.label}>
          <div className="gs-tool-head"><CurIcon /><b>{cur.label}</b><small>{cur.desc}</small></div>
          <div className="gs-tool-body">
            {tool === 'outlook'  && <StormOutlookGraphicTool basic />}
            {tool === 'snow'     && <SnowOutlookGraphicTool key="chance" variant="chance" basic />}
            {tool === 'snowacc'  && <SnowOutlookGraphicTool key="accumulation" variant="accumulation" basic />}
            {tool === 'snowrisk' && <SnowOutlookGraphicTool key="risk" variant="risk" basic />}
            {tool === 'wind'     && <SnowOutlookGraphicTool key="wind" variant="wind" basic />}
          </div>
        </section>
      </main>
    </div>
  );
}
