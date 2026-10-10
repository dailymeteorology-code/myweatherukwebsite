/* ════════════════════════════════════════════════════════════════════════════
   TCMCalibrationLab — Admin Settings → TCM

   "Trains" (calibrates) the TCM risk engine against historical data pulled from
   the SELF-HOSTED Open-Meteo /v1/archive node. It runs the UNCHANGED engine over
   every hour of a chosen year across a UK & Ireland grid, compares each hour's
   thunderstorm score against an outcome field from the same archive, and reports
   the best occurrence cut-off + a re-fitted probability logistic. Nothing here
   mutates the engine — you review the numbers, then they get baked in as v3.00.

   Runs one year at a time; each saved year accumulates (up to 5) and combines
   exactly via the stored score→outcome histogram.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FlaskConical, Play, Square, Save, Trash2, Radar, Loader2, CheckCircle2,
  XCircle, AlertTriangle, TrendingUp, Layers, Gauge,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { getOmBaseUrl } from '@/lib/openMeteoTCM';
import {
  UK_IE_GRID, GRID_PRESETS, OUTCOME_PRESETS, ENGINE_DEFAULTS,
  probeArchive, runCalibrationYear, metricsFromHist, combineHists,
} from '@/lib/tcmCalibration';

const C = {
  text: '#f1f5f9', mid: '#94a3b8', faint: '#64748b',
  surface: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.09)', border2: 'rgba(255,255,255,0.16)',
  sky: '#38bdf8', green: '#22c55e', red: '#ef4444', amber: '#f59e0b', violet: '#a78bfa',
};
const FONT = "'DM Sans', system-ui, sans-serif";
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 };
const inp = { boxSizing: 'border-box', padding: '8px 11px', background: 'rgba(2,6,15,0.6)', border: `1px solid ${C.border2}`, borderRadius: 9, color: C.text, fontSize: 13, fontFamily: FONT, outline: 'none' };
const btn = (accent) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, border: `1px solid ${accent ? accent : C.border2}`, background: accent ? `${accent}1f` : 'rgba(255,255,255,0.05)', color: accent || C.text, whiteSpace: 'nowrap' });
const lbl = { fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 };
const tag = (col) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: col, background: `${col}1a`, border: `1px solid ${col}33` });

const fmt = (v, d = 3) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d));
const pct = (v) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(2) + '%');

function Metric({ label, value, sub, color }) {
  return (
    <div style={{ ...card, padding: 12, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.text, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.mid, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// Reliability diagram — forecast probability (x) vs observed frequency (bars).
function ReliabilityDiagram({ diagram }) {
  if (!diagram) return null;
  const rows = diagram.filter((d) => d.n > 0);
  if (!rows.length) return <div style={{ fontSize: 12, color: C.faint }}>No populated bins.</div>;
  const maxN = Math.max(...rows.map((r) => r.n));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((r, i) => {
        const gap = r.observed - r.forecast;
        const col = Math.abs(gap) < 0.05 ? C.green : Math.abs(gap) < 0.12 ? C.amber : C.red;
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '78px 1fr 118px', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: C.mid, fontFamily: 'monospace' }}>{Math.round(r.binLo * 100)}–{Math.round(r.binHi * 100)}%</span>
            <div style={{ position: 'relative', height: 16, background: 'rgba(255,255,255,0.05)', borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${(r.n / maxN) * 100}%`, background: 'rgba(56,189,248,0.18)' }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${clampPct(r.observed)}%`, width: 2, background: col }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${clampPct(r.forecast)}%`, width: 2, background: C.faint }} />
            </div>
            <span style={{ fontSize: 11, color: col, fontFamily: 'monospace', textAlign: 'right' }}>
              obs {pct(r.observed)}
            </span>
          </div>
        );
      })}
      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4 }}>
        Grey tick = forecast prob · coloured tick = observed freq · bar width = sample size. Aligned ticks = well-calibrated.
      </div>
    </div>
  );
}
const clampPct = (v) => Math.max(0, Math.min(100, (v || 0) * 100));

function RecoTable({ metrics }) {
  if (!metrics?.recommend) return null;
  const r = metrics.recommend;
  const rows = [
    { k: 'THUNDER_OCCUR_SCORE', was: ENGINE_DEFAULTS.thunderOccurScore, now: r.thunderOccurScore, note: 'occurrence cut-off (max CSI)' },
    { k: 'thunderProb centre C', was: ENGINE_DEFAULTS.probCenter, now: r.probCenter, note: 'logistic midpoint' },
    { k: 'thunderProb slope S', was: ENGINE_DEFAULTS.probSlope, now: r.probSlope, note: 'logistic steepness' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((row) => {
        const changed = row.now != null && Number(row.now) !== Number(row.was);
        return (
          <div key={row.k} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(2,6,15,0.4)', border: `1px solid ${C.border}`, borderRadius: 8 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>{row.k}</div>
              <div style={{ fontSize: 10.5, color: C.faint }}>{row.note}</div>
            </div>
            <span style={{ fontSize: 13, color: C.faint, fontFamily: 'monospace' }}>{row.was}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: changed ? C.sky : C.mid, fontFamily: 'monospace' }}>→ {row.now ?? '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function TCMCalibrationLab() {
  const base = getOmBaseUrl();
  const thisYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(thisYear - 2);
  const [outcomeId, setOutcomeId] = useState('wxcode');
  const [threshold, setThreshold] = useState('');
  const [gridId, setGridId] = useState('standard');
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState([]);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef(null);

  const outcome = useMemo(() => {
    const preset = OUTCOME_PRESETS.find((o) => o.id === outcomeId) || OUTCOME_PRESETS[0];
    const thr = threshold === '' ? preset.defaultThr : Number(threshold);
    return { ...preset, threshold: thr };
  }, [outcomeId, threshold]);

  const loadSaved = async () => {
    try {
      const rows = await base44.entities.TCMCalibrationRun.list('-year');
      setSaved(rows || []);
    } catch { /* ignore */ }
  };
  useEffect(() => { loadSaved(); }, []);

  const doProbe = async () => {
    setError(''); setProbe(null); setProbing(true);
    try {
      const extraVars = OUTCOME_PRESETS.flatMap((o) => o.vars);
      const res = await probeArchive({ base, point: UK_IE_GRID[0], date: `${year}-06-15`, extraVars });
      setProbe(res);
    } catch (e) {
      setError(String(e.message || e));
    } finally { setProbing(false); }
  };

  const doRun = async () => {
    setError(''); setResult(null); setRunning(true); setProgress({ done: 0, total: grid.length * 12, label: 'starting…', hoursScored: 0 });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const supportedVars = probe?.supported || null;
      const res = await runCalibrationYear({
        base, year, grid, supportedVars, outcome,
        signal: ctrl.signal,
        onProgress: (p) => setProgress(p),
      });
      setResult(res);
    } catch (e) {
      setError(String(e.message || e));
    } finally { setRunning(false); abortRef.current = null; }
  };
  const cancelRun = () => abortRef.current?.abort();

  const saveResult = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const m = result.metrics;
      // one row per (year, outcome) — replace an existing match
      const dup = saved.find((r) => r.year === result.year && r.outcome_id === result.outcomeId);
      if (dup) await base44.entities.TCMCalibrationRun.delete(dup.id);
      await base44.entities.TCMCalibrationRun.create({
        year: result.year, region: result.region, outcome_id: result.outcomeId,
        outcome_threshold: result.outcomeThreshold ?? null,
        grid_points: result.gridPoints, hours_scored: result.hoursScored,
        n: m.n, hits: m.hits, base_rate: m.baseRate,
        brier: m.brier, brier_skill_score: m.brierSkillScore,
        reliability: m.reliability, resolution: m.resolution,
        recommend_thunder_occur_score: m.recommend.thunderOccurScore ?? null,
        recommend_prob_center: m.recommend.probCenter ?? null,
        recommend_prob_slope: m.recommend.probSlope ?? null,
        hist_tot: result.hist.tot, hist_hit: result.hist.hit,
      });
      await loadSaved();
    } catch (e) {
      setError('Save failed: ' + String(e.message || e));
    } finally { setSaving(false); }
  };

  const deleteSaved = async (id) => {
    try { await base44.entities.TCMCalibrationRun.delete(id); await loadSaved(); } catch { /* ignore */ }
  };

  // Combined recommendation across all saved years (matching outcome).
  const combined = useMemo(() => {
    if (!saved.length) return null;
    const groupId = saved[0].outcome_id;
    const rows = saved.filter((r) => r.outcome_id === groupId && Array.isArray(r.hist_tot) && Array.isArray(r.hist_hit));
    if (!rows.length) return null;
    const hist = combineHists(rows.map((r) => ({ tot: r.hist_tot, hit: r.hist_hit })));
    const metrics = metricsFromHist(hist);
    return { metrics, years: rows.map((r) => r.year).sort(), outcomeId: groupId };
  }, [saved]);

  const grid = useMemo(() => (GRID_PRESETS.find((g) => g.id === gridId) || GRID_PRESETS[0]).grid, [gridId]);

  const numeric = outcome.kind === 'numeric';
  const outcomeVar = outcome.vars[0];
  const outcomeAvail = probe ? probe.details?.[outcomeVar] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: FONT, color: C.text }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: `${C.violet}1f`, border: `1px solid ${C.violet}44` }}>
          <FlaskConical size={20} color={C.violet} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>TCM Calibration Lab <span style={{ ...tag(C.violet), marginLeft: 6 }}>v3.00 tuning</span></div>
          <div style={{ fontSize: 12, color: C.mid }}>Calibrate the engine against your self-hosted historical archive. Physics unchanged — only the occurrence cut-off & probability curve are tuned.</div>
        </div>
      </div>

      {/* Base URL guard */}
      {!base && (
        <div style={{ ...card, borderColor: `${C.amber}55`, background: `${C.amber}12`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: C.text }}>
            No self-host URL set. Set your Open-Meteo Docker URL in the <b>Data Source</b> panel above first — the archive is fetched from <code>{'{base}'}/v1/archive</code>.
          </div>
        </div>
      )}

      {/* Config */}
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div>
            <div style={lbl}>Year</div>
            <input type="number" value={year} min={1979} max={thisYear} onChange={(e) => setYear(Number(e.target.value))} style={{ ...inp, width: '100%' }} />
          </div>
          <div>
            <div style={lbl}>Truth source</div>
            <select value={outcomeId} onChange={(e) => { setOutcomeId(e.target.value); setThreshold(''); }} style={{ ...inp, width: '100%' }}>
              {OUTCOME_PRESETS.map((o) => <option key={o.id} value={o.id} style={{ background: '#0b1322' }}>{o.label}</option>)}
            </select>
          </div>
          {numeric && (
            <div>
              <div style={lbl}>Threshold ({outcome.unit})</div>
              <input type="number" value={threshold === '' ? outcome.defaultThr : threshold} onChange={(e) => setThreshold(e.target.value)} style={{ ...inp, width: '100%' }} />
            </div>
          )}
          <div>
            <div style={lbl}>Sampling density</div>
            <select value={gridId} onChange={(e) => setGridId(e.target.value)} style={{ ...inp, width: '100%' }}>
              {GRID_PRESETS.map((g) => <option key={g.id} value={g.id} style={{ background: '#0b1322' }}>{g.label} · {g.grid.length} pts</option>)}
            </select>
            <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Layers size={11} /> UK & Ireland · tunes global constants, not map resolution
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={doProbe} disabled={!base || probing || running} style={{ ...btn(C.sky), opacity: (!base || probing || running) ? 0.5 : 1 }}>
            {probing ? <Loader2 size={14} className="spin" /> : <Radar size={14} />} Probe archive
          </button>
          {!running ? (
            <button onClick={doRun} disabled={!base || running} style={{ ...btn(C.green), opacity: (!base) ? 0.5 : 1 }}>
              <Play size={14} /> Run {year} calibration
            </button>
          ) : (
            <button onClick={cancelRun} style={btn(C.red)}><Square size={13} /> Cancel</button>
          )}
        </div>

        {/* Probe result */}
        {probe && (
          <div style={{ marginTop: 12, padding: 11, background: 'rgba(2,6,15,0.4)', border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={tag(C.green)}><CheckCircle2 size={12} /> {probe.supported.length} vars served</span>
              {probe.unsupported.length > 0 && <span style={tag(C.amber)}><XCircle size={12} /> {probe.unsupported.length} missing</span>}
              <span style={tag(outcomeAvail?.hasData ? C.green : outcomeAvail?.ok ? C.amber : C.red)}>
                truth “{outcomeVar}”: {outcomeAvail?.hasData ? 'has data' : outcomeAvail?.ok ? 'served, no data in sample' : 'not served'}
              </span>
            </div>
            {probe.unsupported.length > 0 && (
              <div style={{ marginTop: 7, color: C.faint, fontSize: 11 }}>
                Missing (engine falls back to proxies): {probe.unsupported.join(', ')}
              </div>
            )}
          </div>
        )}

        {/* Progress */}
        {running && progress && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.mid, marginBottom: 5 }}>
              <span>{progress.label} {progress.error ? <span style={{ color: C.amber }}>· {progress.error}</span> : ''}</span>
              <span>{progress.done}/{progress.total} · {progress.hoursScored?.toLocaleString?.() || 0} hrs</span>
            </div>
            <div style={{ height: 7, borderRadius: 99, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
              <motion.div animate={{ width: `${(progress.done / progress.total) * 100}%` }} transition={{ duration: 0.2 }}
                style={{ height: '100%', background: `linear-gradient(90deg, ${C.sky}, ${C.violet})`, borderRadius: 99 }} />
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: 11, background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 9, fontSize: 12.5, color: '#fecaca' }}>
            {error}
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div style={{ ...card, borderColor: `${C.green}44` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Gauge size={16} color={C.green} /> {result.year} result · {result.hoursScored.toLocaleString()} hours
            </div>
            <button onClick={saveResult} disabled={saving} style={btn(C.violet)}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save this year
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Metric label="Base rate" value={pct(result.metrics.baseRate)} sub="observed occurrence" />
            <Metric label="Brier skill" value={fmt(result.metrics.brierSkillScore, 3)} sub=">0 beats climatology" color={result.metrics.brierSkillScore > 0 ? C.green : C.red} />
            <Metric label="Reliability" value={fmt(result.metrics.reliability, 4)} sub="lower = better" />
            <Metric label="Resolution" value={fmt(result.metrics.resolution, 4)} sub="higher = better" />
          </div>

          <div style={{ ...lbl, marginTop: 4 }}>Recommended v3.00 tuning</div>
          <RecoTable metrics={result.metrics} />

          <div style={{ ...lbl, marginTop: 14 }}>Reliability (current probability curve)</div>
          <ReliabilityDiagram diagram={result.metrics.diagram} />
        </div>
      )}

      {/* Saved years + combined recommendation */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <TrendingUp size={15} color={C.sky} />
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>Saved years ({saved.length})</div>
          <span style={{ fontSize: 11, color: C.faint }}>· one row per year, up to 5 · they combine below</span>
        </div>

        {saved.length === 0 && <div style={{ fontSize: 12.5, color: C.faint }}>No saved calibration years yet. Run a year and press “Save this year”.</div>}

        {saved.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {saved.map((r) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '54px 1fr auto auto auto 30px', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'rgba(2,6,15,0.4)', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}>
                <b style={{ fontFamily: 'monospace' }}>{r.year}</b>
                <span style={{ color: C.faint }}>{r.outcome_id}{r.outcome_threshold != null ? ` ≥${r.outcome_threshold}` : ''}</span>
                <span style={{ color: C.mid }}>base {pct(r.base_rate)}</span>
                <span style={{ color: r.brier_skill_score > 0 ? C.green : C.red }}>BSS {fmt(r.brier_skill_score, 3)}</span>
                <span style={{ color: C.sky, fontFamily: 'monospace' }}>occ {r.recommend_thunder_occur_score ?? '—'} · C{r.recommend_prob_center ?? '—'} · S{r.recommend_prob_slope ?? '—'}</span>
                <button onClick={() => deleteSaved(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, padding: 2 }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}

        {combined && (
          <div style={{ marginTop: 14, padding: 13, background: `${C.violet}10`, border: `1px solid ${C.violet}44`, borderRadius: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.violet, marginBottom: 4 }}>
              Combined recommendation · {combined.years.length} yr{combined.years.length > 1 ? 's' : ''} ({combined.years.join(', ')})
            </div>
            <div style={{ fontSize: 11.5, color: C.mid, marginBottom: 10 }}>
              {combined.metrics.n.toLocaleString()} hours · base rate {pct(combined.metrics.baseRate)} · Brier skill {fmt(combined.metrics.brierSkillScore, 3)}. These are the numbers to bake into the engine as v3.00.
            </div>
            <RecoTable metrics={combined.metrics} />
            <div style={{ marginTop: 10, padding: 10, background: 'rgba(2,6,15,0.5)', border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: 'monospace', fontSize: 12, color: C.text }}>
              THUNDER_OCCUR_SCORE = {combined.metrics.recommend.thunderOccurScore ?? '—'}<br />
              thunderProb: center = {combined.metrics.recommend.probCenter ?? '—'}, slope = {combined.metrics.recommend.probSlope ?? '—'}
            </div>
            <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>
              Tell me “bake in v3.00” and I’ll apply exactly these numbers to the engine (logic untouched).
            </div>
          </div>
        )}
      </div>

      <style>{`.spin{animation:tcmcalspin 0.9s linear infinite}@keyframes tcmcalspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
