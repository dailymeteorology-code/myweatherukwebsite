/* Weather Model Data — UKMO 10 km output as a map of the whole UK.

   The model is sampled on a grid across the country and one variable at a time
   is shaded over the landmass, with an hour slider to step through the run. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Database, ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react';
import { fetchModelGrid, MODELS, variablesFor } from '@/lib/modelGrid';
import ModelMap from '@/components/model/ModelMap';
import ModelMapLegend from '@/components/model/ModelMapLegend';

export default function ModelData() {
  const [model, setModel] = useState(MODELS[0]);
  const variables = useMemo(() => variablesFor(model), [model]);
  const [variable, setVariable] = useState(variablesFor(MODELS[0])[0]);
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hourIdx, setHourIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showValues, setShowValues] = useState(false);

  /* Usable height. The app layout reserves 56px at the bottom for the tab bar
     below md, so a flat 100dvh would push the controls under it — the map has to
     fit the space that is actually free. */
  const shellRef = useRef(null);
  const [shellH, setShellH] = useState('calc(100dvh - 56px)');
  useEffect(() => {
    /* Whatever is left after the app chrome: the layout reserves 56px for the
       tab bar as an INLINE style (so it applies at every width) and the mobile
       header sits above this page. The page's own distance from the top of the
       document measures the header without hardcoding its height. */
    const measure = () => {
      const top = shellRef.current?.getBoundingClientRect().top ?? 0;
      setShellH(`calc(100dvh - 56px - ${Math.max(0, Math.round(top + window.scrollY))}px)`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetchModelGrid({ variableKey: variable.key, modelId: model.id, days: model.days })
      .then(g => { if (!cancelled) { setGrid(g); setHourIdx(0); } })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [variable, model]);

  // Simple loop through the run while playing.
  useEffect(() => {
    if (!playing || !grid?.times?.length) return;
    const id = setInterval(() => setHourIdx(i => (i + 1) % grid.times.length), 550);
    return () => clearInterval(id);
  }, [playing, grid]);

  const frame = useMemo(
    () => (grid ? grid.values.map(series => series?.[hourIdx] ?? null) : []),
    [grid, hourIdx],
  );

  const timeLabel = grid?.times?.[hourIdx]
    ? new Date(grid.times[hourIdx]).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

  const card = {
    background: 'rgba(11,19,36,0.72)', border: '1px solid rgba(148,163,184,0.16)',
    borderRadius: 18, padding: 'clamp(14px, 3vw, 20px)', backdropFilter: 'blur(14px)',
  };
  const chip = (on) => ({
    padding: '6px 12px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12, fontWeight: 700,
    background: on ? 'rgba(56,189,248,0.16)' : 'rgba(148,163,184,0.07)',
    border: `1px solid ${on ? '#38bdf8' : 'rgba(148,163,184,0.2)'}`,
    color: on ? '#7dd3fc' : '#94a3b8',
  });

  return (
    /* Height-bounded, not min-height: the whole chart has to be readable at a
       glance, so the page fills the screen exactly and the MAP absorbs whatever
       space the header and controls leave rather than pushing itself off the
       bottom. The bottom tab bar's inset is reserved so the controls clear it. */
    <div ref={shellRef} style={{ height: shellH, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'radial-gradient(ellipse 90% 60% at 50% 0%, #101c33 0%, #0b1322 55%, #060b18 100%)', color: '#e2e8f0' }}>
      <div style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: 1100, margin: '0 auto', padding: 'clamp(10px, 2vw, 18px) clamp(10px, 2.5vw, 22px) 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Database style={{ width: 18, height: 18, color: '#38bdf8' }} />
            <h1 style={{ margin: 0, fontSize: 'clamp(17px, 3vw, 22px)', fontWeight: 800, letterSpacing: '-0.02em' }}>
              Weather Model Data
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: '#94a3b8' }}>
            {model.label} · UK · {model.days} days ahead · local time
            {grid?.runKey ? ` · run ${grid.runKey}${grid.source === 'saved' ? ' (saved)' : ''}` : ''}
          </p>
        </motion.div>

        {/* Model picker. Switching model keeps the current field where that model
            also offers it, so you can compare the same variable run to run. */}
        <div style={{ ...card, padding: '9px 11px', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
          {MODELS.map(m => (
            <button key={m.id} onClick={() => {
              setModel(m);
              const next = variablesFor(m);
              if (!next.some(v => v.key === variable.key)) setVariable(next[0]);
            }} style={{ ...chip(m.id === model.id), fontSize: 12.5 }}>{m.short}</button>
          ))}
        </div>

        {/* Variable picker */}
        <div style={{ ...card, padding: '9px 11px', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
          {variables.map(v => (
            <button key={v.key} onClick={() => setVariable(v)} style={chip(v.key === variable.key)}>{v.label}</button>
          ))}
          <button onClick={() => setShowValues(s => !s)} style={{ ...chip(showValues), marginLeft: 'auto' }}>
            {showValues ? 'Values on' : 'Values off'}
          </button>
        </div>

        {loading && (
          <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60, color: '#94a3b8' }}>
            <Loader2 className="animate-spin" style={{ width: 18, height: 18 }} />
            Sampling the model across the UK…
          </div>
        )}

        {!loading && error && (
          <div style={{ ...card, borderColor: 'rgba(248,113,113,0.4)', color: '#fca5a5', fontSize: 13.5 }}>
            Could not load model data: {error}
          </div>
        )}

        {!loading && !error && grid && (
          <div style={{ ...card, padding: 'clamp(9px, 1.6vw, 14px)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ModelMap variable={variable} values={frame} timeLabel={timeLabel} showValues={showValues} />

            {/* Hour controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
              <button onClick={() => setHourIdx(i => Math.max(0, i - 1))} style={{ ...chip(false), padding: 7, lineHeight: 0 }} aria-label="Previous hour">
                <ChevronLeft style={{ width: 15, height: 15 }} />
              </button>
              <button onClick={() => setPlaying(p => !p)} style={{ ...chip(playing), padding: 7, lineHeight: 0 }} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause style={{ width: 15, height: 15 }} /> : <Play style={{ width: 15, height: 15 }} />}
              </button>
              <button onClick={() => setHourIdx(i => Math.min(grid.times.length - 1, i + 1))} style={{ ...chip(false), padding: 7, lineHeight: 0 }} aria-label="Next hour">
                <ChevronRight style={{ width: 15, height: 15 }} />
              </button>
              <input
                type="range" min={0} max={grid.times.length - 1} value={hourIdx}
                onChange={e => { setPlaying(false); setHourIdx(Number(e.target.value)); }}
                style={{ flex: 1, minWidth: 160, accentColor: '#38bdf8' }}
                aria-label="Forecast hour"
              />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#7dd3fc', fontVariantNumeric: 'tabular-nums' }}>
                +{hourIdx}h
              </span>
            </div>

            <ModelMapLegend variable={variable} />
          </div>
        )}

      </div>
    </div>
  );
}