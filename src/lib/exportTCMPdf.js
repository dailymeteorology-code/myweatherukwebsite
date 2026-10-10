// TCM PDF export — extracted from pages/WeatherPatterns to keep that file under
// the size limit. Pure function: takes the report params plus the page-local
// helpers/constants it needs (RISK_TYPES, RISK_META, RISK_INDEX, getPalette,
// scoreToLevel, fmtRun, fmtRange, generateDayDescription, REGIONS,
// RISK_DESCRIPTIONS_PER_RISK, INLINE_LOGO) as a `deps` object. Behaviour is
// identical to the original inline implementation.
export async function exportToPDF(
  { region, riskType, dayIdx, run, data, summary, mapDataUrl = '', impactedLocations = [] },
  deps,
) {
  const {
    RISK_TYPES, RISK_META, RISK_INDEX, getPalette, scoreToLevel,
    fmtRun, fmtRange, generateDayDescription, REGIONS,
    RISK_DESCRIPTIONS_PER_RISK, INLINE_LOGO,
  } = deps;

  const mwukB64 = (() => { try { return localStorage.getItem('tcm_logo_local_dataurl') || INLINE_LOGO; } catch { return INLINE_LOGO; } })();
  const mwHeroB64 = mwukB64;
  const tcmB64 = '';
  const riskLabel = RISK_TYPES.find((t) => t.id === riskType)?.label ?? riskType;
  const date = new Date(run);date.setDate(date.getDate() + dayIdx);
  const dateStr = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const level = scoreToLevel(summary?.[riskType] ?? 0);
  const score = summary?.[riskType] ?? 0;
  const pal = getPalette(riskType, level);
  const descriptions = generateDayDescription(summary, riskType, dayIdx, (REGIONS[region] ?? {}).label ?? region, run, impactedLocations);
  const sub   = summary?.sub ?? {};
const cov   = summary?.totalCells ? Math.round((summary.stormyCells / summary.totalCells) * 100) : 0;
const r     = summary?.ranges ?? { cape:{min:0,max:0}, shear:{min:0,max:0}, gust:{min:0,max:0}, precip:{min:0,max:0}, hailMm:{min:0,max:0} };
const hazards = [
  sub.tornado    > 20 && { label:'Tornado Risk',      color:'#e65100' },
  sub.hail       > 20 && { label:'Large Hail',        color:'#2e7d32' },
  sub.flashFlood > 25 && { label:'Flash Flooding',    color:'#0ea5e9' },
  sub.strongWinds> 20 && { label:'Damaging Winds',    color:'#6a1b9a' },
  sub.supercell  > 20 && { label:'Supercell Threat',  color:'#c62828' },
  true               && { label:'Lightning',          color:'#f59e0b' },
].filter(Boolean);

const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>TCM Outlook — ${dateStr}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&family=DM+Mono:wght@500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;background:#080d1a;color:#f1f5f9;padding:36px 40px;min-height:100vh}
@media print{body{background:#080d1a!important;color:#f1f5f9!important;padding:28px}}
.logo-row{display:flex;align-items:center;gap:18px;margin-bottom:18px}
.logo-mwuk{width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid rgba(56,189,248,0.4);box-shadow:0 0 18px rgba(56,189,248,0.25)}
.logo-tcm{width:48px;height:48px;object-fit:contain;filter:drop-shadow(0 0 8px rgba(167,139,250,0.4))}
.dual-logo{display:flex;align-items:center;gap:10px}
.header-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.risk-badge-large{display:inline-flex;align-items:center;gap:10px;padding:10px 20px;border-radius:99px;font-size:1rem;font-weight:800;border-width:2px;border-style:solid}
.section-divider{height:1px;background:rgba(255,255,255,0.08);margin:20px 0}
.param-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.param-box{background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px;padding:14px 12px;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.param-label{font-size:0.58rem;text-transform:uppercase;letter-spacing:0.12em;color:#475569;margin-bottom:6px;font-family:'DM Mono',monospace;font-weight:800}
.param-value{font-size:1.3rem;font-weight:900;font-family:'DM Mono',monospace}
.hazard-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.hazard-chip{padding:5px 12px;border-radius:99px;font-size:0.72rem;font-weight:700;border-style:solid;border-width:1px}
.synopsis-box{background:rgba(241,245,249,0.95);border:1px solid rgba(167,139,250,0.40);border-radius:12px;padding:16px 18px;margin-bottom:20px}
.synopsis-box p{font-size:0.88rem;line-height:1.72;color:#0f172a;margin:0 0 10px}
.synopsis-box p:last-child{margin:0}
.level-strip{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.level-chip{padding:5px 13px;border-radius:99px;font-size:0.72rem;font-weight:800;border-width:2px;border-style:solid;display:flex;align-items:center;gap:6px}
.section-title{font-size:0.7rem;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.section-title::before{content:'';display:inline-block;width:3px;height:14px;background:#a78bfa;border-radius:2px}
.meta-chip{font-family:'DM Mono',monospace;font-size:0.68rem;color:#64748b;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);padding:3px 9px;border-radius:6px}
.footer-bar{margin-top:36px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.watermark{position:fixed;bottom:24px;right:28px;opacity:0.04;font-size:6rem;font-weight:900;color:white;pointer-events:none;transform:rotate(-12deg);letter-spacing:-0.05em}
@media print{body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
</style></head><body>

<div class="watermark">TCM</div>

<!-- HEADER -->
<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;padding-bottom:20px;border-bottom:2px solid rgba(167,139,250,0.25);flex-wrap:wrap;gap:14px">
  
  <!-- Left: both logos + title -->
  <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    
    <!-- MyWeather logo (hero/settings logo) -->
    ${mwHeroB64 ? `
    <div style="position:relative">
      <img src="${mwHeroB64}" style="height:64px;width:auto;object-fit:contain;filter:drop-shadow(0 0 12px rgba(56,189,248,0.35))" alt="MyWeatherUK"/>
    </div>` : ''}
    
    <!-- Divider -->
    ${mwHeroB64 && tcmB64 ? `<div style="width:1px;height:52px;background:rgba(255,255,255,0.12)"></div>` : ''}
    
    <!-- TCM logo + wordmark -->
    <div style="display:flex;align-items:center;gap:10px">
      ${tcmB64 ? `<img src="${tcmB64}" style="height:52px;width:auto;object-fit:contain;filter:drop-shadow(0 0 10px rgba(167,139,250,0.4))" alt="TCM"/>` : ''}
      <div style="display:flex;flex-direction:column;gap:2px">
        <span style="font-family:'Orbitron','DM Sans',sans-serif;font-weight:900;font-size:1.6rem;letter-spacing:0.22em;background:linear-gradient(135deg,#a78bfa 0%,#818cf8 25%,#38bdf8 60%,#34d399 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1">TCM</span>
        <span style="font-family:'DM Mono',monospace;font-size:0.58rem;font-weight:700;color:#64748b;letter-spacing:0.18em;text-transform:uppercase">Thunderstorm Convection Model</span>
        <span style="font-family:'Orbitron','DM Sans',sans-serif;font-size:0.48rem;font-weight:800;letter-spacing:0.18em;background:linear-gradient(135deg,#a78bfa,#38bdf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">V2.0</span>
      </div>
    </div>
    
  </div>
  
  <!-- Right: risk badge + meta -->
  <div class="header-right">
    <span class="risk-badge-large" style="background:${pal.fill};border-color:${pal.border};color:${pal.border}">
      <span style="width:10px;height:10px;border-radius:50%;background:${pal.border};box-shadow:0 0 10px ${pal.border}"></span>
      ${level}
    </span>
    <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;margin-top:4px">
      <span class="meta-chip">Score: ${score}/100</span>
      <span class="meta-chip">Run: ${fmtRun(run)}</span>
      <span class="meta-chip">${(REGIONS[region] ?? {}).label ?? region}</span>
      <span class="meta-chip">Coverage: ~${cov}%</span>
      <span class="meta-chip">Day ${dayIdx + 1} — ${dateStr}</span>
    </div>
  </div>
</div>

<!-- SUBHEADER -->
<div style="margin-bottom:22px">
  <h1 style="margin:0 0 4px;font-size:1.5rem;font-weight:800;color:#f1f5f9;letter-spacing:-0.02em">${riskLabel} Risk Outlook</h1>
  <p style="margin:0;font-size:0.9rem;color:#94a3b8;font-weight:500">${dateStr} · ${(REGIONS[region] ?? {}).label ?? region}</p>
</div>


<!-- PARAMETERS -->
<div class="param-grid">
  <div class="param-box">
    <div class="param-label">Peak CAPE</div>
    <div class="param-value" style="color:#ef4444">${r.cape?.max ?? 0}</div>
    <div style="font-size:0.6rem;color:#64748b;margin-top:3px;font-family:'DM Mono',monospace">J/kg</div>
  </div>
  <div class="param-box">
    <div class="param-label">Hail Size</div>
    <div class="param-value" style="color:#38bdf8">${r.hailMm?.max ?? 0}</div>
    <div style="font-size:0.6rem;color:#64748b;margin-top:3px;font-family:'DM Mono',monospace">mm</div>
  </div>
  <div class="param-box">
    <div class="param-label">Rain Rate</div>
    <div class="param-value" style="color:#0ea5e9">${r.precip?.max ?? 0}</div>
    <div style="font-size:0.6rem;color:#64748b;margin-top:3px;font-family:'DM Mono',monospace">mm/h</div>
  </div>
  <div class="param-box">
    <div class="param-label">Risk Score</div>
    <div class="param-value" style="color:${pal.border}">${score}/100</div>
    <div style="font-size:0.6rem;color:#64748b;margin-top:3px;font-family:'DM Mono',monospace">${level}</div>
  </div>
</div>

<!-- HAZARDS -->
<div style="margin-bottom:20px">
  <div class="section-title">Active Hazards</div>
  <div class="hazard-row">
    ${hazards.map(h => `<span class="hazard-chip" style="color:${h.color};border-color:${h.color}40;background:${h.color}12">${h.label}</span>`).join('')}
  </div>
</div>

<div class="section-divider"></div>

<!-- SYNOPSIS -->
<div class="synopsis-box">
  <div class="section-title" style="margin-bottom:10px;color:#6d28d9">Outlook Synopsis</div>
  ${descriptions.map(d => `<p>${d.replace(/\*\*(.*?)\*\*/g,'<strong style="color:${pal.border}">$1</strong>')}</p>`).join('')}
</div>

<!-- THUNDERSTORM RISK BREAKDOWN — full sub-hazard details -->
<div style="margin-bottom:24px">
  <div class="section-title">Thunderstorm Risk Breakdown</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
    ${[
      { label: 'Tornado',       value: Math.round(sub.tornado ?? 0),     color: '#e65100', unit: '%' },
      { label: 'Large Hail',    value: Math.round(sub.hail ?? 0),        color: '#2e7d32', unit: '%' },
      { label: 'Flash Flood',   value: Math.round(sub.flashFlood ?? 0),  color: '#0ea5e9', unit: '%' },
      { label: 'Strong Winds',  value: Math.round(sub.strongWinds ?? 0), color: '#6a1b9a', unit: '%' },
      { label: 'Supercell',     value: Math.round(sub.supercell ?? 0),   color: '#c62828', unit: '%' },
      { label: 'Lightning',     value: Math.round(sub.lightning ?? summary?.lightning ?? 0), color: '#f59e0b', unit: '%' },
    ].map(h => `
      <div style="background:rgba(255,255,255,0.05);border:1px solid ${h.color}40;border-left:3px solid ${h.color};border-radius:10px;padding:10px 12px">
        <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.12em;color:#94a3b8;margin-bottom:4px;font-family:'DM Mono',monospace">${h.label}</div>
        <div style="display:flex;align-items:baseline;gap:4px">
          <span style="font-size:1.4rem;font-weight:800;font-family:'DM Mono',monospace;color:${h.color}">${h.value}</span>
          <span style="font-size:0.7rem;color:#64748b">${h.unit}</span>
        </div>
        <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:99px;margin-top:6px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100, h.value)}%;background:${h.color};border-radius:99px"></div>
        </div>
      </div>
    `).join('')}
  </div>

  <!-- Full environmental ranges — always-visible light box for print -->
  <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact">
    <div style="font-size:0.62rem;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;font-family:'DM Mono',monospace">Environmental Ranges</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
      ${[
        { label: 'CAPE Range',    min: r.cape?.min ?? 0,   max: r.cape?.max ?? 0,   unit: 'J/kg', color: '#ef4444' },
        { label: 'Shear Range',   min: r.shear?.min ?? 0,  max: r.shear?.max ?? 0,  unit: 'kt',   color: '#38bdf8' },
        { label: 'Gust Range',    min: r.gust?.min ?? 0,   max: r.gust?.max ?? 0,   unit: 'mph',  color: '#a78bfa' },
        { label: 'Precip Range',  min: r.precip?.min ?? 0, max: r.precip?.max ?? 0, unit: 'mm/h', color: '#0ea5e9' },
        { label: 'Hail Range',    min: r.hailMm?.min ?? 0, max: r.hailMm?.max ?? 0, unit: 'mm',   color: '#7dd3fc' },
        { label: 'Coverage',      min: cov,                max: cov,                unit: '% area', color: '#22c55e' },
      ].map(e => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#ffffff;border:1px solid #e2e8f0;border-left:3px solid ${e.color};border-radius:6px">
          <span style="font-size:0.66rem;font-weight:800;color:#334155;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:0.08em">${e.label}</span>
          <span style="font-size:0.82rem;font-weight:800;color:#0f172a;font-family:'DM Mono',monospace">${e.min === e.max ? e.min : `${e.min}–${e.max}`} <span style="color:#64748b;font-size:0.62rem;margin-left:2px">${e.unit}</span></span>
        </div>
      `).join('')}
    </div>
  </div>
</div>

<!-- MAP -->
${mapDataUrl ? `
<div style="margin-bottom:24px">
  <div class="section-title">Convective Outlook Map — ${(REGIONS[region] ?? {}).label ?? region} · ${riskLabel} Risk · Day ${dayIdx + 1}</div>
  <div style="border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);box-shadow:0 4px 32px rgba(0,0,0,0.45);position:relative">
    <img src="${mapDataUrl}" alt="Outlook Map" style="width:100%;display:block;max-height:520px;object-fit:cover;object-position:center"/>
  </div>
  <div style="margin-top:6px;padding:4px 6px;font-family:'DM Mono',monospace;font-size:0.62rem;color:#94a3b8;display:flex;justify-content:space-between">
    <span>${RISK_TYPES.find(tt=>tt.id===riskType)?.label} Risk · ${(REGIONS[region] ?? {}).label ?? region}</span>
    <span>Run: ${fmtRun(run)} · Day ${dayIdx + 1}</span>
  </div>
</div>
` : ''}

<!-- RISK SCALE — with per-hazard descriptions -->
<div style="margin-bottom:24px">
  <div class="section-title">${riskLabel} Risk Scale Reference</div>
  <div class="level-strip">
    ${RISK_META.filter(r2 => r2.level !== 'No Risk').map(r2 => {
      const p2        = getPalette(riskType, r2.level);
      const isCurrent = r2.level === level;
      const isActive  = RISK_INDEX[r2.level] <= RISK_INDEX[level] && level !== 'No Risk';
      return `<span class="level-chip" style="
        background:${p2.fill};
        border-color:${p2.border};
        color:${p2.border};
        ${isCurrent ? `box-shadow:0 0 18px ${p2.border}70;transform:scale(1.08);border-width:3px;` : ''}
        ${isActive && !isCurrent ? 'opacity:0.85;' : ''}
        ${!isActive ? 'opacity:0.35;filter:grayscale(0.5);' : ''}
        position:relative;
      ">
        ${isActive ? `<span style="font-size:0.75rem">✓</span>` : `<span style="font-size:0.7rem;opacity:0.5">○</span>`}
        <span style="width:8px;height:8px;border-radius:50%;background:${p2.border}"></span>
        ${r2.level}
        <span style="font-size:0.6rem;opacity:0.7;font-family:'DM Mono',monospace">${fmtRange(r2.level)}</span>
        ${isCurrent ? `<span style="font-size:0.65rem;font-weight:900;background:${p2.border};color:#fff;padding:1px 5px;border-radius:4px;margin-left:2px">ACTIVE</span>` : ''}
      </span>`;
    }).join('')}
  </div>

  <!-- Per-hazard level descriptions table -->
  <div style="margin-top:14px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact">
    <div style="font-size:0.62rem;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;font-family:'DM Mono',monospace">${riskLabel} Risk Level Descriptions</div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${RISK_META.filter(r2 => r2.level !== 'No Risk').map(r2 => {
        const p3 = getPalette(riskType, r2.level);
        const desc = (RISK_DESCRIPTIONS_PER_RISK[riskType] && RISK_DESCRIPTIONS_PER_RISK[riskType][r2.level]) || '';
        const isCurrent = r2.level === level;
        return `<div style="display:flex;gap:10px;padding:8px 10px;background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid ${p3.border};border-radius:6px;${isCurrent ? `box-shadow:0 0 0 2px ${p3.border}40;` : ''}">
          <div style="flex-shrink:0;min-width:78px">
            <div style="font-size:0.72rem;font-weight:800;color:${p3.border};font-family:'DM Mono',monospace">${r2.level}</div>
            <div style="font-size:0.56rem;color:#64748b;font-family:'DM Mono',monospace;margin-top:1px">${fmtRange(r2.level)}</div>
          </div>
          <div style="flex:1;font-size:0.7rem;color:#334155;line-height:1.5">${desc}</div>
        </div>`;
      }).join('')}
    </div>
  </div>
</div>

<!-- FOOTER -->
<div class="footer-bar">
  <div style="display:flex;align-items:center;gap:10px">
    ${mwukB64 ? `<img src="${mwukB64}" style="width:24px;height:24px;border-radius:50%;opacity:0.7" alt=""/>` : ''}
    <span style="font-family:'DM Mono',monospace;font-size:0.62rem;color:#475569">TCM v3 · MyWeatherUK · ${new Date().toLocaleString('en-GB')} UTC</span>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <span class="meta-chip">Run: ${fmtRun(run)}</span>
    <span class="meta-chip">Source: ${data?.source ?? 'deno-api'}</span>
  </div>
</div>

</body></html>`;
  const win = window.open('', '_blank');
  if (win) {win.document.write(html);win.document.close();setTimeout(() => {win.focus();win.print();}, 800);}
}