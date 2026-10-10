/**
 * Weather Scenarios — shared look. Colours are CSS custom properties on the
 * page root (.wsx), switched by the site's theme, so every component reads
 * the same tokens. No backdrop-filter: the site's lag work showed per-frame
 * blur was its biggest GPU cost, so panels use flat translucent fills.
 */
import React from 'react';
import {
  Globe2, Wind, Snowflake, Sprout, Sun, Leaf, CloudRain, Tornado, Zap, CloudFog, SunDim, Sparkles, AlertOctagon,
  CloudSnow, CloudSun, SunMedium, Flame, CloudLightning, ExternalLink,
} from 'lucide-react';

export const ICONS = { Globe2, Wind, Snowflake, Sprout, Sun, Leaf, CloudRain, Tornado, Zap, CloudFog, SunDim, Sparkles, AlertOctagon, CloudSnow, CloudSun, SunMedium, Flame, CloudLightning };
export const Icon = ({ name, ...p }) => { const C = ICONS[name] || Sparkles; return <C aria-hidden="true" {...p} />; };

export const WSX_CSS = `
.wsx{--bg:#070d1c;--bg2:#0c1529;--panel:rgba(22,33,58,.72);--panel2:rgba(30,44,74,.6);--line:rgba(148,170,210,.16);--line2:rgba(148,170,210,.28);
 --ink:#e9eef8;--ink2:#b4c0d6;--ink3:#8291ad;--accent:#7cb0ff;--accent2:#a98bff;--good:#3ecf8e;--warn:#f2b53a;--bad:#ff6b81;--focus:#ffd23f;
 --shadow:0 10px 30px rgba(0,0,0,.35);color:var(--ink);background:linear-gradient(175deg,var(--bg) 0%,var(--bg2) 60%,#0b1428 100%);min-height:100vh;
 font-family:'DM Sans','Archivo',system-ui,sans-serif;}
.wsx.light{--bg:#eef3fb;--bg2:#e3ebf7;--panel:rgba(255,255,255,.86);--panel2:rgba(243,247,253,.95);--line:rgba(40,60,100,.14);--line2:rgba(40,60,100,.26);
 --ink:#14203a;--ink2:#3c4b68;--ink3:#5f6e8c;--accent:#2f6fe0;--accent2:#6b4fd8;--good:#138a57;--warn:#a86b00;--bad:#c42a45;--focus:#b8860b;--shadow:0 8px 24px rgba(30,50,90,.12);}
.wsx *{box-sizing:border-box}
.wsx a{color:var(--accent)}
.wsx button,.wsx select,.wsx input,.wsx textarea{font:inherit;color:inherit}
.wsx :focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:6px}
.wsx .wrap{max-width:1240px;margin:0 auto;padding:0 16px}
.wsx .panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}
.wsx .muted{color:var(--ink2)} .wsx .faint{color:var(--ink3)}
.wsx .h2{font-family:'Archivo','DM Sans',sans-serif;font-weight:800;letter-spacing:-.015em;font-size:1.35rem;margin:0}
.wsx .h3{font-family:'Archivo','DM Sans',sans-serif;font-weight:800;font-size:1rem;margin:0}
.wsx .chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;border:1px solid var(--line2);background:transparent;cursor:pointer;font-size:.8rem;line-height:1.1;white-space:nowrap}
.wsx .chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#06101f;font-weight:700}
.wsx.light .chip[aria-pressed="true"]{color:#fff}
.wsx .btn{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:10px;border:1px solid var(--line2);background:var(--panel2);cursor:pointer;font-size:.85rem;font-weight:600}
.wsx .btn:hover{border-color:var(--accent)}
.wsx .btn.primary{background:var(--accent);border-color:var(--accent);color:#06101f}
.wsx.light .btn.primary{color:#fff}
.wsx .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;text-align:left;cursor:pointer;transition:border-color .15s,transform .15s;width:100%}
.wsx .card:hover{border-color:var(--accent);transform:translateY(-1px)}
.wsx .grid{display:grid;gap:12px}
.wsx .tag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:.7rem;font-weight:700;letter-spacing:.02em}
.wsx .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wsx .scroll-x{overflow-x:auto;-webkit-overflow-scrolling:touch}
.wsx input[type=search],.wsx select,.wsx textarea,.wsx input[type=text],.wsx input[type=number]{background:var(--panel2);border:1px solid var(--line2);border-radius:10px;padding:8px 10px}
.wsx .cv{content-visibility:auto;contain-intrinsic-size:auto 160px}
.wsx .prose p{margin:0 0 10px;line-height:1.6}
.wsx .note{font-size:.78rem;color:var(--ink3);line-height:1.5}
.wsx .tabs{display:flex;gap:4px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px;scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
.wsx .tabs::-webkit-scrollbar{height:4px}.wsx .tabs::-webkit-scrollbar-track{background:transparent}.wsx .tabs::-webkit-scrollbar-thumb{background:var(--line2);border-radius:4px}
.wsx .tab{padding:9px 14px;border-radius:10px;border:1px solid transparent;background:transparent;cursor:pointer;font-weight:700;font-size:.86rem;white-space:nowrap;color:var(--ink2);display:inline-flex;gap:7px;align-items:center}
.wsx .tab[aria-selected="true"]{background:var(--panel);border-color:var(--line2);color:var(--ink)}
@media (max-width:640px){.wsx .h2{font-size:1.15rem}}
@media (prefers-reduced-motion:reduce){.wsx *{transition:none!important;animation:none!important}}
`;

export const FREQ_STYLE = {
  C: { bg: 'rgba(62,207,142,.18)', fg: 'var(--good)', label: 'Seasonally common', short: 'Common', mark: '●' },
  P: { bg: 'rgba(90,169,255,.18)', fg: 'var(--accent)', label: 'Plausible', short: 'Plausible', mark: '◐' },
  U: { bg: 'rgba(242,181,58,.18)', fg: 'var(--warn)', label: 'Uncommon', short: 'Uncommon', mark: '○' },
  R: { bg: 'rgba(255,107,129,.18)', fg: 'var(--bad)', label: 'Rare or exceptional', short: 'Rare', mark: '◇' },
  '-': { bg: 'transparent', fg: 'var(--ink3)', label: 'Outside its season (not impossible)', short: 'Off-season', mark: '·' },
};
export const SEV_STYLE = {
  low: { fg: 'var(--good)', label: 'Low impact' }, moderate: { fg: 'var(--accent)', label: 'Moderate impact' },
  high: { fg: 'var(--warn)', label: 'High impact' }, 'very-high': { fg: 'var(--bad)', label: 'Very high impact' },
};

export function FreqBadge({ code, compact }) {
  const f = FREQ_STYLE[code] || FREQ_STYLE['-'];
  return (
    <span className="tag" style={{ background: f.bg, color: f.fg, border: `1px solid ${f.fg}` }} title={f.label}>
      <span aria-hidden="true">{f.mark}</span>{compact ? f.short : f.label}
    </span>
  );
}
export function SevBadge({ sev }) {
  const s = SEV_STYLE[sev] || SEV_STYLE.moderate;
  return <span className="tag" style={{ color: s.fg, border: `1px solid ${s.fg}` }}>{s.label}</span>;
}

export function SourceLink({ src, children }) {
  if (!src) return null;
  return (
    <a href={src.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {children || src.title}<ExternalLink size={12} aria-hidden="true" /><span className="sr"> (opens in a new tab)</span>
    </a>
  );
}

export function SectionHead({ icon: I, title, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '0 0 14px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {I && <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--panel2)', border: '1px solid var(--line2)', flexShrink: 0 }}><I size={18} aria-hidden="true" /></span>}
        <div>
          <h2 className="h2">{title}</h2>
          {sub && <p className="muted" style={{ margin: '3px 0 0', fontSize: '.86rem', maxWidth: 760 }}>{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function ScenarioCard({ s, cat, month, onOpen, extra }) {
  const code = month != null ? s.months[month] : null;
  return (
    <button type="button" className="card cv" onClick={() => onOpen(s.id)} aria-label={`${s.name}. Open details`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        {cat && <span className="tag" style={{ color: cat.colour, border: `1px solid ${cat.colour}55` }}><Icon name={cat.icon} size={12} />{cat.short}</span>}
        {code && <FreqBadge code={code} compact />}
        <SevBadge sev={s.sev} />
      </div>
      <div className="h3" style={{ marginBottom: 6 }}>{s.name}</div>
      <p className="muted" style={{ margin: 0, fontSize: '.82rem', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.summary}</p>
      {extra}
    </button>
  );
}

export function Empty({ children }) {
  return <div className="panel" style={{ padding: 24, textAlign: 'center' }}><p className="muted" style={{ margin: 0 }}>{children}</p></div>;
}

/** Twelve tiny cells showing a scenario's year at a glance. */
export function MonthStrip({ months, monthNames, onMonth, size = 14 }) {
  return (
    <div role="list" aria-label="Relevance by month" style={{ display: 'flex', gap: 2 }}>
      {[...months].map((c, i) => {
        const f = FREQ_STYLE[c];
        const Tag = onMonth ? 'button' : 'span';
        return (
          <Tag key={i} role="listitem" type={onMonth ? 'button' : undefined} onClick={onMonth ? () => onMonth(i) : undefined}
            title={`${monthNames[i]}: ${f.label}`} aria-label={`${monthNames[i]}: ${f.label}`}
            style={{ width: size, height: size, borderRadius: 3, border: `1px solid ${c === '-' ? 'var(--line)' : f.fg}`, background: c === '-' ? 'transparent' : f.fg, opacity: c === 'C' ? 1 : c === 'P' ? 0.7 : c === 'U' ? 0.45 : c === 'R' ? 0.3 : 1, padding: 0, cursor: onMonth ? 'pointer' : 'default' }} />
        );
      })}
    </div>
  );
}
