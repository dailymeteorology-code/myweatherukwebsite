import React, { useState, useEffect } from 'react';
import { Download, Loader2, FileCode, Archive, Check, AlertCircle } from 'lucide-react';

// Every source file that makes up the Graphic Studio and the graphics the site
// displays — the public Thunderstorm Studio, the admin Graphic Studio tools,
// the Graphics hub page (and how each graphic is rendered/edited), the shared
// helpers those tools build on, and the entity schemas that back the saved
// graphics. Grouped so a long list stays navigable; "Download All" bundles the
// lot into one text file in this order.
const TARGETS = [
  // ── Thunderstorm Studio (public) ──────────────────────────────────────────
  { group: 'Thunderstorm Studio', path: 'src/pages/ThunderstormStudio.jsx',                note: 'Public studio page' },
  { group: 'Thunderstorm Studio', path: 'src/components/tcm/StormStudioGraphicTool.jsx',    note: 'Studio graphic tool — draw, style, save' },
  { group: 'Thunderstorm Studio', path: 'src/components/tcm/stormGeo.jsx',                  note: 'Shared UK/Ireland geo, projection, counties' },

  // ── Graphics hub — how graphics are displayed & managed ───────────────────
  { group: 'Graphics Hub', path: 'src/pages/Graphics.jsx',                              note: 'Graphics library page' },
  { group: 'Graphics Hub', path: 'src/components/GraphicCard.jsx',                       note: 'How a graphic card is displayed' },
  { group: 'Graphics Hub', path: 'src/components/GraphicForm.jsx',                       note: 'Create / edit graphic form' },
  { group: 'Graphics Hub', path: 'src/components/ArchivedGraphicsModal.jsx',             note: 'Archive browser modal' },
  { group: 'Graphics Hub', path: 'src/components/ImpactDrawingMap.jsx',                  note: 'Map drawing used by the form' },
  { group: 'Graphics Hub', path: 'src/components/MyWeatherLightningVerification.jsx',    note: 'Lightning verification map on Graphics' },

  // ── Graphic tools (admin Graphic Studio + Graphics page) ────────────────
  { group: 'Graphic Tools', path: 'src/components/StormOutlookGraphicTool.jsx',          note: 'Thunderstorm outlook tool (admin)' },
  { group: 'Graphic Tools', path: 'src/components/SolarEclipseGraphicTool.jsx',           note: 'Solar eclipse coverage map tool' },
  { group: 'Graphic Tools', path: 'src/components/TrafficLightGraphicTool.jsx',           note: 'Traffic-light likelihood card' },
  { group: 'Graphic Tools', path: 'src/components/TemperatureMapTool.jsx',                note: 'Temperature map tool' },
  { group: 'Graphic Tools', path: 'src/components/ClimateAnomalyGraphicTool.jsx',        note: 'Climate anomaly vs 1991–2020' },
  { group: 'Graphic Tools', path: 'src/components/scenario/ScenarioForecastTool.jsx',    note: '3-way scenario forecast board' },
  { group: 'Graphic Tools', path: 'src/components/scenario/scenarioCards.jsx',           note: 'Scenario story cards (1080×1920)' },
  { group: 'Graphic Tools', path: 'src/components/synoptic/SynopticChartTool.jsx',        note: 'Synoptic chart drawing' },
  { group: 'Graphic Tools', path: 'src/components/synoptic/WeatherTypeMapTool.jsx',       note: 'Weather-type area drawing' },
  { group: 'Graphic Tools', path: 'src/components/synoptic/synopticDraw.jsx',             note: 'Synoptic drawing primitives' },
  { group: 'Graphic Tools', path: 'src/lib/synopticGeo.js',                               note: 'Synoptic geo helpers' },

  // ── Shared helpers (outlook layers, geometry, export) ────────────────────
  { group: 'Shared Helpers', path: 'src/components/tcm/stormOutlookHelpers.jsx',         note: 'Map layers + useStormLightning hook' },
  { group: 'Shared Helpers', path: 'src/components/tcm/UKVRainLayer.jsx',                 note: 'UKV rain raster overlay' },
  { group: 'Shared Helpers', path: 'src/components/tcm/riskConfig.jsx',                   note: 'Canonical risk scale' },
  { group: 'Shared Helpers', path: 'src/components/tcm/StormOutlookTimelinePill.jsx',     note: 'Timeline pill UI' },
  { group: 'Shared Helpers', path: 'src/components/tcm/riskDescriptions.jsx',             note: 'Risk / hazard descriptions' },
  { group: 'Shared Helpers', path: 'src/components/tcm/smoothBlobPath.jsx',               note: 'Polygon smoothing' },
  { group: 'Shared Helpers', path: 'src/components/tcm/geometryEngine.jsx',               note: 'Fine grid + contour field builder' },
  { group: 'Shared Helpers', path: 'src/components/tcm/PngExportModal.jsx',              note: 'PNG export modal' },
  { group: 'Shared Helpers', path: 'src/lib/tcmOutlookLayers.js',                         note: 'Outlook polygon builder' },
  { group: 'Shared Helpers', path: 'src/lib/tcmForecastCache.js',                         note: 'Latest-run loader' },
  { group: 'Shared Helpers', path: 'src/lib/exportGraphicPDF.js',                         note: 'Graphic PDF export' },

  // ── Data entities (the code behind saved graphics) ───────────────────────
  { group: 'Data Entities', path: 'base44/entities/WeatherGraphic.jsonc',                 note: 'WeatherGraphic schema' },
  { group: 'Data Entities', path: 'base44/entities/StudioGraphic.jsonc',                 note: 'StudioGraphic schema (per-user saves)' },
];

const bytes = (n) => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const fileNameOnly = (p) => p.split('/').pop();

function triggerDownload(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Fetch the raw source of one file via Vite's `?raw` query (dev + preview).
// In environments where the server ignores ?raw it gracefully degrades to the
// served content, which is still human-readable source for un-transformed files.
async function fetchRaw(path) {
  const url = '/' + path + '?raw';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// Ordered list of distinct groups as they appear in TARGETS.
const GROUP_ORDER = TARGETS.reduce((acc, t) => {
  if (!acc.includes(t.group)) acc.push(t.group);
  return acc;
}, []);

export default function SourceFilesDownloader() {
  const [sizes, setSizes] = useState({});     // path -> byte count
  const [errors, setErrors] = useState({});   // path -> message
  const [busyAll, setBusyAll] = useState(false);
  const [doneAll, setDoneAll] = useState(false);
  const [busyOne, setBusyOne] = useState(null);

  // Pre-fetch sizes so the list shows file sizes up front.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const f of TARGETS) {
        try {
          const txt = await fetchRaw(f.path);
          if (cancelled) return;
          setSizes((s) => ({ ...s, [f.path]: txt.length }));
        } catch (e) {
          if (cancelled) return;
          setErrors((e0) => ({ ...e0, [f.path]: String(e.message || e) }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totalBytes = Object.values(sizes).reduce((a, b) => a + (b || 0), 0);

  const downloadOne = async (f) => {
    setBusyOne(f.path);
    try {
      const txt = await fetchRaw(f.path);
      triggerDownload(fileNameOnly(f.path), txt);
    } catch (e) {
      setErrors((x) => ({ ...x, [f.path]: String(e.message || e) }));
    } finally {
      setBusyOne(null);
    }
  };

  const downloadAll = async () => {
    setBusyAll(true);
    setDoneAll(false);
    try {
      const sep = '\n\n' + '='.repeat(78) + '\n';
      let out =
        `Graphic Studio & Graphics — source bundle\n` +
        `Generated: ${new Date().toISOString()}\n` +
        `Files: ${TARGETS.length}\n` + sep;
      const fetched = [];
      for (const f of TARGETS) {
        let content = '';
        try { content = await fetchRaw(f.path); } catch (e) {
          content = `[FETCH FAILED: ${e.message || e}]`;
        }
        fetched.push({ ...f, content });
        out += `FILE ${fetched.length}/${TARGETS.length}: ${f.path}\n[${f.group}] ${f.note}\n` +
               '-'.repeat(78) + '\n' + content + sep;
      }
      triggerDownload('graphic-studio-source.txt', out);
      // Refresh sizes in case any were unknown.
      setSizes((s) => {
        const next = { ...s };
        for (const f of fetched) if (next[f.path] == null) next[f.path] = f.content.length;
        return next;
      });
      setDoneAll(true);
      setTimeout(() => setDoneAll(false), 2500);
    } finally {
      setBusyAll(false);
    }
  };

  const anyErr = Object.keys(errors).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header / actions */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap', padding: '20px 22px', borderRadius: 16,
        background: 'linear-gradient(155deg, rgba(56,189,248,0.06) 0%, rgba(167,139,250,0.04) 100%)',
        border: '1px solid rgba(148,163,184,0.12)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11,
            background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <FileCode style={{ width: 18, height: 18, color: '#38bdf8' }} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>
              Graphic Studio & Graphics — Source Files
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5 }}>
              {TARGETS.length} files across {GROUP_ORDER.length} groups · {bytes(totalBytes)} · download individually or as one bundled text file.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={downloadAll}
          disabled={busyAll}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 9,
            padding: '11px 22px', borderRadius: 11, fontSize: 13, fontWeight: 700,
            cursor: busyAll ? 'wait' : 'pointer', fontFamily: 'inherit',
            background: doneAll
              ? 'linear-gradient(135deg, #16a34a, #15803d)'
              : busyAll ? 'rgba(148,163,184,0.10)' : 'linear-gradient(135deg, #0ea5e9, #0284c7)',
            border: '1px solid transparent', color: '#fff',
            boxShadow: (busyAll || doneAll) ? 'none' : '0 4px 18px rgba(56,189,248,0.25)',
            transition: 'all 0.2s',
          }}
        >
          {busyAll
            ? <><Loader2 style={{ width: 15, height: 15, animation: 'sofspin 0.8s linear infinite' }} /> Bundling…</>
            : doneAll
            ? <><Check style={{ width: 15, height: 15 }} /> Downloaded</>
            : <><Archive style={{ width: 15, height: 15 }} /> Download All</>}
        </button>
        <style>{`@keyframes sofspin{to{transform:rotate(360deg)}}`}</style>
      </div>

      {anyErr && (
        <div style={{
          display: 'flex', gap: 10, padding: '12px 16px', borderRadius: 10,
          background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
          color: '#fbbf24', fontSize: 12, lineHeight: 1.5,
        }}>
          <AlertCircle style={{ width: 15, height: 15, flexShrink: 0, marginTop: 1 }} />
          <span>
            Source fetch isn't available in this environment. Downloaded files will be empty if the
            dev server stripped the <code>?raw</code> query. Run this tab in the builder/preview to get the full files.
          </span>
        </div>
      )}

      {/* Grouped file list */}
      <div style={{
        borderRadius: 16, overflow: 'hidden',
        border: '1px solid rgba(148,163,184,0.10)',
        background: '#0c1422',
      }}>
        {GROUP_ORDER.map((group, gi) => (
          <div key={group}>
            {/* Group header */}
            <div style={{
              padding: '11px 18px',
              background: 'rgba(148,163,184,0.05)',
              borderBottom: '1px solid rgba(148,163,184,0.07)',
              borderTop: gi === 0 ? 'none' : '1px solid rgba(148,163,184,0.07)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: '0.16em',
                textTransform: 'uppercase', color: '#94a3b8', fontFamily: "'DM Sans', sans-serif",
              }}>
                {group}
              </span>
              <span style={{ fontSize: 10.5, color: 'rgba(148,163,184,0.4)', fontFamily: 'monospace' }}>
                {TARGETS.filter(t => t.group === group).length} files
              </span>
            </div>
            {/* Group files */}
            {TARGETS.filter(t => t.group === group).map((f, i, arr) => {
              const size = sizes[f.path];
              const err = errors[f.path];
              const last = i === arr.length - 1;
              const isBusy = busyOne === f.path;
              return (
                <div key={f.path} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 18px',
                  borderBottom: last ? 'none' : '1px solid rgba(148,163,184,0.07)',
                }}>
                  <FileCode style={{ width: 17, height: 17, color: err ? '#f87171' : '#94a3b8', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#f1f5f9',
                      fontFamily: "'DM Sans', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.path}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#94a3b8' }}>
                      {f.note}{err ? ` · ⚠ ${err}` : ''}
                    </p>
                  </div>
                  <span style={{ fontSize: 11.5, color: '#64748b', fontFamily: 'monospace', flexShrink: 0 }}>
                    {size == null && !err ? <Loader2 style={{ width: 12, height: 12, animation: 'sofspin 0.8s linear infinite' }} /> : bytes(size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadOne(f)}
                    disabled={isBusy}
                    title={`Download ${fileNameOnly(f.path)}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                      padding: '8px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700,
                      cursor: isBusy ? 'wait' : 'pointer', fontFamily: 'inherit', flexShrink: 0,
                      background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.22)',
                      color: '#38bdf8', transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => { if (!isBusy) e.currentTarget.style.background = 'rgba(56,189,248,0.16)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(56,189,248,0.08)'; }}
                  >
                    {isBusy
                      ? <><Loader2 style={{ width: 13, height: 13, animation: 'sofspin 0.8s linear infinite' }} /></>
                      : <><Download style={{ width: 13, height: 13 }} /> File</>}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p style={{ margin: 0, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.6 }}>
        “Download All” produces a single <code style={{ color: '#cbd5e1' }}>graphic-studio-source.txt</code> with every
        file separated by a header block — keep it as a snapshot. These are the files that make up the Graphic Studio,
        the public Thunderstorm Studio, and every graphic the site displays.
      </p>
    </div>
  );
}