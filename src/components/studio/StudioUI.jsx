/* The Graphic Studio's controls, in liquid glass that follows the site's light and dark theme.

   The outlook graphics (thunderstorm, snow, wind) put their controls in titled glass sections,
   flowing into two columns on a desktop, and the graphic below them at the full width (it is
   drawn on, so it stays as large as the page allows), with a toolbar that stays in view over it
   while drawing. The colours are the admin page's tokens (--ad-*), so the studio re-colours with the rest of Admin
   Settings; outside it they fall back to the dark set. Only the controls follow the theme: the
   graphic itself is the same image in both. */
import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

const CSS = `
.sg { --sg-text: var(--ad-text, #f2f6fc); --sg-mid: var(--ad-text-mid, #9fb0c6); --sg-dim: var(--ad-text-dim, rgba(159,176,198,.7));
  --sg-faint: var(--ad-text-faint, rgba(159,176,198,.48)); --sg-surface: var(--ad-surface, rgba(255,255,255,.055));
  --sg-surface2: var(--ad-surface2, rgba(255,255,255,.075)); --sg-field: var(--ad-surface3, rgba(0,0,0,.24));
  --sg-border: var(--ad-border, rgba(255,255,255,.08)); --sg-border2: var(--ad-border2, rgba(255,255,255,.12)); --sg-border3: var(--ad-border3, rgba(255,255,255,.18));
  --sg-hl: var(--ad-highlight, rgba(255,255,255,.14)); --sg-shadow: var(--ad-shadow, 0 1px 2px rgba(0,0,0,.3), 0 16px 40px -12px rgba(0,0,0,.6));
  --sg-accent: var(--ad-sky, #56b6f5); --sg-red: var(--ad-red, #f87171); --sg-green: var(--ad-green, #4ade80); --sg-amber: var(--ad-amber, #fbbf24);
  color: var(--sg-text); font-size: 13px; container-type: inline-size; }
.sg *, .sg *::before, .sg *::after { box-sizing: border-box; }
.sg-cols { display: flex; flex-direction: column; gap: 16px; }
/* the sections flow into as many ~380 px columns as fit (two on a desktop), the graphic below at
   full width, as large as the column allows */
.sg-controls { columns: 3 380px; column-gap: 12px; min-width: 0; }
.sg-controls > .sg-sec { break-inside: avoid; margin-bottom: 12px; }
.sg-preview { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.sg-preview > .sg-toolbar { position: sticky; top: 10px; z-index: 6; }
.ad-root .sg-preview > .sg-toolbar { top: 84px; }   /* clear of Admin Settings' sticky top bar */
/* the tools that draw a fixed-size picture: the sections beside it, the picture held in view */
.sg-split { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
.sg-split > .sg-side { flex: 1 1 340px; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.sg-split > .sg-shot { flex: 0 1 auto; min-width: 0; max-width: 100%; position: sticky; top: 12px; display: flex; flex-direction: column; gap: 10px; }
.ad-root .sg-split > .sg-shot { top: 86px; }
@media (max-width: 760px) { .sg-split > .sg-shot { position: static; } }
.sg-canvas { display: block; max-width: 100%; height: auto; border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
.sg-sec { position: relative; background: var(--sg-surface); border: 1px solid var(--sg-border); border-radius: 20px;
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%); box-shadow: var(--sg-shadow), inset 0 1px 0 var(--sg-hl); }
.sg-sec-bar { display: flex; align-items: center; gap: 8px; padding-right: 14px; }
.sg-sec-head { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 12px 0 12px 14px; background: none; border: 0; cursor: pointer;
  font: inherit; color: var(--sg-text); text-align: left; border-radius: 20px; }
.sg-sec-head:only-child { padding-right: 0; }
.sg-sec-head:focus-visible { outline: 2px solid var(--sg-accent); outline-offset: -2px; }
.sg-sec-icon { display: grid; place-items: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: 10px;
  color: var(--c, var(--sg-accent)); background: color-mix(in srgb, var(--c, var(--sg-accent)) 14%, transparent); }
.sg-sec-icon svg { width: 15px; height: 15px; }
.sg-sec-title { flex: 1; min-width: 0; }
.sg-sec-title b { display: block; font-size: 13.5px; font-weight: 700; letter-spacing: -.01em; }
.sg-sec-title small { display: block; margin-top: 1px; font-size: 11.5px; color: var(--sg-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sg-sec-chev { width: 16px; height: 16px; color: var(--sg-faint); transition: transform .2s; flex-shrink: 0; }
.sg-sec.is-closed .sg-sec-chev { transform: rotate(-90deg); }
.sg-sec-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 12px; }
.sg-label { display: block; margin: 0 0 6px; font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--sg-dim); }
.sg-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sg-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.sg-input { width: 100%; min-height: 36px; padding: 7px 10px; border-radius: 11px; font: inherit; font-size: 13px; color: var(--sg-text);
  background: var(--sg-field); border: 1px solid var(--sg-border2); outline: none; transition: border-color .15s, box-shadow .15s; }
.sg-input:focus { border-color: var(--sg-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sg-accent) 18%, transparent); }
.sg-input::placeholder { color: var(--sg-faint); }
textarea.sg-input { resize: vertical; line-height: 1.45; }
.sg-input[type=number] { padding-right: 4px; }
.sg-btn { --c: var(--sg-accent); display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 0 12px;
  border-radius: 11px; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 650; white-space: nowrap; color: var(--sg-mid);
  background: var(--sg-surface2); border: 1px solid var(--sg-border2); transition: background .15s, border-color .15s, color .15s; }
.sg-btn svg { width: 14px; height: 14px; flex-shrink: 0; }
.sg-btn:hover:not(:disabled) { border-color: var(--sg-border3); color: var(--sg-text); }
.sg-btn:disabled { opacity: .45; cursor: not-allowed; }
.sg-btn.is-on { color: color-mix(in srgb, var(--c) 72%, var(--sg-text)); background: color-mix(in srgb, var(--c) 15%, transparent);
  border-color: color-mix(in srgb, var(--c) 50%, transparent); }
.sg-btn.is-primary { color: #fff; border: 0; background: linear-gradient(135deg, color-mix(in srgb, var(--c) 92%, #fff), color-mix(in srgb, var(--c) 80%, #000));
  box-shadow: 0 6px 18px -6px color-mix(in srgb, var(--c) 70%, transparent); }
.sg-btn.is-primary:hover:not(:disabled) { color: #fff; filter: brightness(1.06); }
.sg-btn.is-danger { color: var(--sg-red); }
.sg-btn.is-danger:hover:not(:disabled) { border-color: color-mix(in srgb, var(--sg-red) 50%, transparent); color: var(--sg-red); }
.sg-btn.is-sm { min-height: 28px; padding: 0 9px; font-size: 11.5px; border-radius: 9px; }
.sg-btn.is-icon { width: 34px; padding: 0; }
.sg-seg { display: inline-flex; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 13px; background: var(--sg-field); border: 1px solid var(--sg-border); }
.sg-seg button { --c: var(--sg-accent); display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 11px; border-radius: 10px; border: 0;
  cursor: pointer; font: inherit; font-size: 12px; font-weight: 650; color: var(--sg-mid); background: transparent; }
.sg-seg button svg { width: 13px; height: 13px; }
.sg-seg button:hover { color: var(--sg-text); }
.sg-seg button[aria-pressed='true'] { color: var(--sg-text); background: var(--sg-surface2);
  box-shadow: 0 1px 2px rgba(0,0,0,.12), inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent); }
.sg-level { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 11px; border-radius: 11px; cursor: pointer; font: inherit;
  font-size: 12px; font-weight: 800; letter-spacing: .02em; color: var(--sg-mid); background: var(--sg-surface2); border: 1.5px solid var(--sg-border2); }
.sg-level i { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; background: var(--c); box-shadow: 0 0 0 1px rgba(0,0,0,.25); }
.sg-level small { font-size: 10px; font-weight: 600; opacity: .7; font-family: ui-monospace, monospace; }
.sg-level[aria-pressed='true'] { color: var(--sg-text); border-color: var(--c); background: color-mix(in srgb, var(--c) 18%, transparent); }
.sg-panel { padding: 11px 12px; border-radius: 14px; background: var(--sg-field); border: 1px solid var(--sg-border); display: flex; flex-direction: column; gap: 9px; }
.sg-note { margin: 0; font-size: 11.5px; line-height: 1.45; color: var(--sg-dim); }
.sg-note b { color: var(--sg-mid); }
.sg-link { padding: 0; border: 0; background: none; cursor: pointer; font: inherit; font-weight: 700; color: var(--sg-accent); text-decoration: underline; text-underline-offset: 2px; }
.sg-swatch { width: 20px; height: 20px; border-radius: 50%; cursor: pointer; padding: 0; border: 2px solid var(--sg-border3); box-shadow: inset 0 0 0 1px rgba(0,0,0,.2); }
.sg-swatch[aria-pressed='true'] { border-color: var(--sg-text); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sg-accent) 40%, transparent); }
.sg-color { width: 26px; height: 24px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.sg-range { accent-color: var(--sg-accent); cursor: pointer; }
.sg-status { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; font-size: 11.5px; font-weight: 600;
  color: var(--sg-mid); background: var(--sg-surface2); border: 1px solid var(--sg-border2); }
.sg-status i { width: 7px; height: 7px; border-radius: 50%; background: var(--c, var(--sg-accent)); box-shadow: 0 0 6px var(--c, var(--sg-accent)); }
.sg-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
.sg-item { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 11px; background: var(--sg-surface2); border: 1px solid var(--sg-border); }
.sg-item > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-chipx { display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 9px; border-radius: 9px; font-size: 11.5px; font-weight: 650;
  color: var(--sg-text); background: color-mix(in srgb, var(--c) 18%, transparent); border: 1.5px solid var(--c); }
.sg-chipx button { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 6px;
  border: 0; background: transparent; cursor: pointer; color: inherit; font: inherit; font-size: 10px; font-weight: 800; }
.sg-chipx button:hover { background: color-mix(in srgb, var(--sg-text) 12%, transparent); }
.sg-chipx svg { width: 11px; height: 11px; }
.sg-toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px; border-radius: 18px; background: var(--sg-surface);
  border: 1px solid var(--sg-border); -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%); box-shadow: var(--sg-shadow), inset 0 1px 0 var(--sg-hl); }
.sg-toolbar .sg-sep { width: 1px; align-self: stretch; margin: 2px 2px; background: var(--sg-border2); }
.sg-toolbar { position: relative; }   /* the saved list hangs from it (the preview's own toolbar is sticky, above) */
.sg-pop { position: absolute; right: 8px; top: calc(100% + 8px); z-index: 30; width: min(320px, 86vw); padding: 8px; border-radius: 16px;
  background: color-mix(in srgb, var(--ad-bg, #0b1220) 94%, transparent); border: 1px solid var(--sg-border2);
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%); box-shadow: var(--sg-shadow); }
.sg-pop .sg-list { max-height: 340px; }
.sg-grow { flex: 1; }
@keyframes spin { to { transform: rotate(360deg); } }
.sg-spin { animation: spin 1s linear infinite; }
.sg-btn svg[class*="lucide-loader"] { animation: spin 1s linear infinite; }   /* a busy button spins its loader */
`;
export function StudioStyles() { return <style>{CSS}</style>; }

const SEC_KEY = 'mwuk_studio_sections';
const readOpen = () => { try { return JSON.parse(localStorage.getItem(SEC_KEY) || '{}'); } catch { return {}; } };

/** A titled glass section; collapsible, and it remembers whether it was open. */
export function Section({ id, icon: Icon, title, sub, color, defaultOpen = true, right = null, children }) {
  const [open, setOpen] = useState(() => { const o = readOpen()[id]; return o == null ? defaultOpen : o; });
  useEffect(() => { try { localStorage.setItem(SEC_KEY, JSON.stringify({ ...readOpen(), [id]: open })); } catch { /* storage blocked */ } }, [id, open]);
  return (
    <section className={`sg-sec${open ? '' : ' is-closed'}`} style={color ? { '--c': color } : undefined}>
      <div className="sg-sec-bar">
        <button type="button" className="sg-sec-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {Icon && <span className="sg-sec-icon"><Icon /></span>}
          <span className="sg-sec-title"><b>{title}</b>{sub && <small>{sub}</small>}</span>
          {!right && <ChevronDown className="sg-sec-chev" />}
        </button>
        {right && <span className="sg-row" style={{ flexWrap: 'nowrap' }}>{right}<ChevronDown className="sg-sec-chev" onClick={() => setOpen((v) => !v)} style={{ cursor: 'pointer' }} /></span>}
      </div>
      {open && <div className="sg-sec-body">{children}</div>}
    </section>
  );
}

/** A button, or a toggle when `on` is given (tinted with `color` while on). */
export function Btn({ on, color, primary, danger, sm, icon: Icon, children, className = '', style, ...rest }) {
  const cls = ['sg-btn', on ? 'is-on' : '', primary ? 'is-primary' : '', danger ? 'is-danger' : '', sm ? 'is-sm' : '', !children ? 'is-icon' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} aria-pressed={on == null ? undefined : !!on} style={{ ...(color ? { '--c': color } : {}), ...style }} {...rest}>
      {Icon && <Icon />}{children}
    </button>
  );
}

/** A segmented choice: options [[value, label, Icon?]]. */
export function Seg({ value, onChange, options, color }) {
  return (
    <div className="sg-seg" role="group">
      {options.map(([v, label, Icon]) => (
        <button key={v} type="button" aria-pressed={value === v} style={color ? { '--c': color } : undefined} onClick={() => onChange(v)}>
          {Icon && <Icon />}{label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, style }) {
  return <label style={{ display: 'block', minWidth: 0, ...style }}><span className="sg-label">{label}</span>{children}</label>;
}

export function Swatches({ colors, value, onChange, custom = false }) {
  return (
    <span className="sg-row" style={{ gap: 5 }}>
      {colors.map((c) => <button key={c} type="button" className="sg-swatch" aria-pressed={value === c} aria-label={c} style={{ background: c }} onClick={() => onChange(c)} />)}
      {custom && <input type="color" className="sg-color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />}
    </span>
  );
}

/** The other tools' frame: the sections on the left, the picture (kept at its size) on the right. */
export function StudioSplit({ controls, preview }) {
  return (
    <div className="sg">
      <StudioStyles />
      <div className="sg-split">
        <div className="sg-side">{controls}</div>
        <div className="sg-shot">{preview}</div>
      </div>
    </div>
  );
}

/** The studio frame: the control sections, then the toolbar and the graphic. */
export function StudioLayout({ controls, preview, toolbar }) {
  return (
    <div className="sg">
      <StudioStyles />
      <div className="sg-cols">
        <div className="sg-controls">{controls}</div>
        <div className="sg-preview">{toolbar}{preview}</div>
      </div>
    </div>
  );
}
