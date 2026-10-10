import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Zap, Layers, Eye, EyeOff, Map, Palette } from 'lucide-react';

// These are re-exported from the page's module scope — we need them here too.
// Since this is a sub-component of WeatherPatterns, we accept them as props
// to avoid circular imports.

const LIGHTNING_STORAGE_KEY = 'tcm_today_strikes';   // shared key with TCM.jsx main map
const LIGHTNING_STORAGE_KEY2 = 'tcm_lightning_strikes_today'; // synced WP key
// Show ALL of today's strikes — no artificial display cap.
// Max age = UTC midnight so we always show the full day.
const LIGHTNING_MAX_COUNT   = 100_000; // hard ceiling only to prevent OOM
const LIGHTNING_RIPPLE_MS   = 60_000;
const LIGHTNING_MAX_AGE_MS  = 24 * 3600_000; // used only for opacity fade + backend query range
const RENDER_WORKER_HTTP    = 'https://blitzortungworker-3.onrender.com';

const STRIKE_COLOUR_OPTIONS = [
  { id: 'age',    label: 'Age',    preview: 'linear-gradient(90deg,#fff,#facc15,#f97316,#ef4444,#7c3aed)' },
  { id: 'yellow', label: 'Yellow', hex: '#facc15' },
  { id: 'white',  label: 'White',  hex: '#ffffff' },
  { id: 'cyan',   label: 'Cyan',   hex: '#22d3ee' },
  { id: 'lime',   label: 'Lime',   hex: '#84cc16' },
  { id: 'pink',   label: 'Pink',   hex: '#f472b6' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'red',    label: 'Red',    hex: '#ef4444' },
  { id: 'purple', label: 'Purple', hex: '#a78bfa' },
];

// Overlay display modes — mirrors the MAP_MODE_* constants in TCMSection.jsx
const OVERLAY_NONE    = 'none';       // Strikes only, no risk heatmap
const OVERLAY_HEAT    = 'heatmap';    // Risk heatmap behind strikes (default)
const OVERLAY_STRIKES = 'strikes';    // Strikes only, full opacity

const OVERLAY_MODES = [
  { id: OVERLAY_HEAT,    label: 'Risk + Strikes', icon: Layers  },
  { id: OVERLAY_STRIKES, label: 'Strikes Only',   icon: Zap     },
  { id: OVERLAY_NONE,    label: 'Map Only',        icon: Map     },
];

const LightningCircle = React.memo(function LightningCircle({ x, y, age, color = '#fde047', colourId = 'age' }) {
  const resolvedColor = colourId !== 'age'
    ? (STRIKE_COLOUR_OPTIONS.find(o => o.id === colourId)?.hex || color)
    : color;
  const opacity = Math.max(0.18, 1 - age / LIGHTNING_MAX_AGE_MS);
  const showRipple = age < LIGHTNING_RIPPLE_MS;
  return (
    <g transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} opacity={opacity}>
      {showRipple && (
        <circle r={2} fill="none" stroke="#ffffff" strokeWidth={1.2}>
          <animate attributeName="r" from="2" to="22" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.85" to="0" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="stroke-width" from="1.6" to="0.2" dur="1.6s" repeatCount="indefinite" />
        </circle>
      )}
      <circle r={4.5} fill={resolvedColor} opacity={0.82} />
      <circle r={2} fill="#ffffff" opacity={0.55} />
    </g>
  );
});

// Canvas-based strike renderer — draws all strikes without any DOM element per strike.
// Handles 10,000+ strikes smoothly where SVG <circle> per strike would freeze the browser.
const StrikeCanvas = React.memo(function StrikeCanvas({ strikes, bbox, w, h, project, colourId, now }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !strikes.length) return;
    canvas.width  = w * 2; // retina
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, w, h);

    // Age colour helpers (identical to TCM paintStrikeOnMap)
    function ageColor(timeMs) {
      const age = (now - timeMs) / 60000; // minutes
      if (age < 2)   return '#ffffff';
      if (age < 5)   return '#fffde0';
      if (age < 10)  return '#facc15';
      if (age < 30)  return '#f97316';
      if (age < 60)  return '#ef4444';
      if (age < 360) return '#7f1d1d';
      if (age < 720) return '#7c3aed';
      return '#4c1d95';
    }
    const COLOUR_OPTIONS = [
      { id:'yellow', hex:'#facc15' }, { id:'white',  hex:'#ffffff' },
      { id:'cyan',   hex:'#22d3ee' }, { id:'lime',   hex:'#84cc16' },
      { id:'pink',   hex:'#f472b6' }, { id:'orange', hex:'#f97316' },
      { id:'red',    hex:'#ef4444' }, { id:'purple', hex:'#a78bfa' },
    ];

    // Group strikes by colour to minimise ctx.fillStyle changes
    const byColor = new Map();
    for (const s of strikes) {
      const [x, y] = project(s.lat, s.lon, bbox, w, h);
      if (x < -5 || x > w + 5 || y < -5 || y > h + 5) continue;
      const col = colourId === 'age'
        ? ageColor(s.time)
        : (COLOUR_OPTIONS.find(o => o.id === colourId)?.hex || ageColor(s.time));
      if (!byColor.has(col)) byColor.set(col, []);
      byColor.get(col).push([x, y]);
    }

    // Draw each colour group in a single path pass
    for (const [col, pts] of byColor) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (const [x, y] of pts) {
        ctx.moveTo(x + 2, y);
        ctx.arc(x, y, 2, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }, [strikes, w, h, colourId, now, bbox, project]);

  if (!w || !h) return null;
  return (
    <canvas
      ref={canvasRef}
      width={w * 2} height={h * 2}
      style={{
        position: 'absolute',
        top: 0, left: 0,
        width: w, height: h,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
});

export default function TCMLightningVerification({
  data, region, riskType, dayIdx,
  // Injected from parent (avoids re-importing large modules)
  useTCMTheme, REGIONS, regionAspectRatio, loadCountries, geoToSvgPath,
  buildRiskMatrix, HeatmapLayer, TitleCard, project, Section,
  useBlitzortung, LIGHTNING_BACKEND_PATH,
}) {
  const { t, lightMode } = useTCMTheme();
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 700, h: 600 });
  const [outline, setOutline] = useState('');
  const [status, setStatus] = useState('idle');
  const [enabled, setEnabled] = useState(true);
  // Overlay mode: which layers to show on the verification map
  const [overlayMode, setOverlayMode] = useState(OVERLAY_HEAT);
  const [strikeColour, setStrikeColour] = useState('age');
  const [strikes, setStrikes] = useState(() => {
    try {
      // UTC midnight — consistent with historicalLightning
      const cutoff = (() => { const d = new Date(); d.setUTCHours(0,0,0,0); return d.getTime(); })();
      const all = [];
      const seen = new Set();
      // Read both storage keys and merge
      for (const key of [LIGHTNING_STORAGE_KEY, LIGHTNING_STORAGE_KEY2]) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          const arr = Array.isArray(parsed) ? parsed
            : Array.isArray(parsed?.strikes) ? parsed.strikes : [];
          for (const s of arr) {
            if (!s || s.lat == null || s.lon == null || !s.time || s.time < cutoff) continue;
            const k = `${Math.round(s.time/1000)}_${Math.round(s.lat*1000)}_${Math.round(s.lon*1000)}`;
            if (!seen.has(k)) { seen.add(k); all.push(s); }
          }
        } catch {}
      }
      return all.sort((a,b) => a.time - b.time);
    } catch { return []; }
  });

  const bbox = REGIONS[region].bbox;

  useEffect(() => {
    if (!wrapRef.current) return;
    const compute = () => {
      if (!wrapRef.current) return;
      const containerW = wrapRef.current.clientWidth;
      const ratio = regionAspectRatio(REGIONS[region].bbox);
      const maxH = Math.max(360, Math.min(680, window.innerHeight * 0.62));
      let h = containerW * ratio, w = containerW;
      if (h > maxH) { h = maxH; w = h / ratio; }
      setSize({ w: Math.round(w), h: Math.round(h) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrapRef.current);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
  }, [region]);

  useEffect(() => {
    let alive = true;
    loadCountries().then((fc) => {
      if (!alive || !fc) return;
      setOutline(geoToSvgPath(fc, REGIONS[region].bbox, size.w, size.h));
    });
    return () => { alive = false; };
  }, [region, size.w, size.h]);

  // ── Cross-device sync: pull from Render worker on mount + every 60 s ────
  // The Render worker stores every strike it sees from ALL connected clients,
  // so any device/browser that opens the page gets the full picture even if
  // it was offline earlier.
  useEffect(() => {
    let cancelled = false;
    const mergeStrikes = (incoming) => {
      if (!Array.isArray(incoming) || !incoming.length) return;
      setStrikes((prev) => {
        const cutoff = (() => { const d = new Date(); d.setUTCHours(0,0,0,0); return d.getTime(); })();
        const seen = new Set(prev.map((s) => `${Math.round(s.time/1000)}_${Math.round(s.lat*1000)}_${Math.round(s.lon*1000)}`));
        const merged = [...prev];
        for (const s of incoming) {
          if (!s || s.lat == null || s.lon == null || !s.time || s.time < cutoff) continue;
          const k = `${Math.round(s.time/1000)}_${Math.round(s.lat*1000)}_${Math.round(s.lon*1000)}`;
          if (!seen.has(k)) { seen.add(k); merged.push(s); }
        }
        const next = merged.sort((a,b)=>a.time-b.time).slice(-LIGHTNING_MAX_COUNT);
        return next;
      });
    };

    const pull = async () => {
      if (cancelled) return;
      // 1. Render worker (fastest, always available)
      try {
        const r = await fetch(`${RENDER_WORKER_HTTP}/strikes/recent`);
        if (r.ok) mergeStrikes(await r.json());
      } catch {}
      // 2. Optional custom backend
      if (LIGHTNING_BACKEND_PATH) {
        const since = Date.now() - LIGHTNING_MAX_AGE_MS;
        fetch(`${LIGHTNING_BACKEND_PATH}?since=${since}`)
          .then((r) => r.ok ? r.json() : [])
          .then(mergeStrikes)
          .catch(() => {});
      }
    };

    pull();
    const iv = setInterval(pull, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') pull(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVisible); };
  }, []); // eslint-disable-line

  const addStrike = useCallback((strike) => {
    setStrikes((prev) => {
      const cutoff = (() => { const d = new Date(); d.setUTCHours(0,0,0,0); return d.getTime(); })();
      const next = [...prev.filter((s) => s.time >= cutoff), strike].slice(-LIGHTNING_MAX_COUNT);
      return next;
    });
    // Forward to optional custom backend
    if (LIGHTNING_BACKEND_PATH) {
      fetch(LIGHTNING_BACKEND_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(strike),
      }).catch(() => {});
    }
  }, []);

  useBlitzortung({ enabled, bbox, onStrike: addStrike, onStatus: setStatus });

  const matrixData = useMemo(
    () => data?.grid ? buildRiskMatrix(data.grid, region, riskType, { dayIdx }) : null,
    [data, region, riskType, dayIdx],
  );

  const now = Date.now();
  const visibleStrikes = useMemo(() => {
    // Show all of today's strikes from UTC midnight — no artificial cap
    const cutoff = (() => { const d = new Date(); d.setUTCHours(0,0,0,0); return d.getTime(); })();
    return strikes.filter((s) => s.time >= cutoff);
  }, [strikes]);

  const statusColor = { live:'#22c55e', connecting:'#eab308', reconnecting:'#eab308', error:'#dc2626', disabled:'#64748b', idle:'#64748b' }[status] || '#64748b';

  const showHeatmap  = overlayMode === OVERLAY_HEAT;
  const showStrikes  = overlayMode === OVERLAY_HEAT || overlayMode === OVERLAY_STRIKES;

  return (
    <Section title="Lightning Verification" icon={Zap}
      extra={
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:'0.7rem', fontWeight:700, color:statusColor, fontFamily:"'DM Mono',monospace" }}>
            <span style={{ width:7, height:7, borderRadius:99, background:statusColor, boxShadow:`0 0 8px ${statusColor}`, animation:status==='live'?'pulse 1.4s ease-in-out infinite':'none' }} />
            {status.toUpperCase()}
          </span>
          <span style={{ fontSize:'0.7rem', fontWeight:700, color:'#a78bfa', fontFamily:"'DM Mono',monospace" }}>{visibleStrikes.length} strikes · 6 h</span>
          <button onClick={() => setEnabled((e) => !e)} style={{ padding:'6px 10px', borderRadius:8, fontSize:'0.7rem', fontWeight:700, background:enabled?'rgba(220,38,38,0.15)':'rgba(34,197,94,0.15)', color:enabled?'#dc2626':'#22c55e', border:`1px solid ${enabled?'#dc2626':'#22c55e'}40`, cursor:'pointer' }}>
            {enabled ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      }
    >
      {/* ── Overlay mode toggle bar — mirrors TCMSection map mode style ── */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, flexWrap:'wrap' }}>
        <Layers style={{ width:13, height:13, color:'#a78bfa', flexShrink:0 }} />
        <span style={{ fontSize:'0.6rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(148,163,184,0.5)', marginRight:4 }}>
          Overlay
        </span>
        {OVERLAY_MODES.map(({ id, label, icon: Icon }) => {
          const active = overlayMode === id;
          return (
            <button
              key={id}
              onClick={() => setOverlayMode(id)}
              style={{
                display:'flex', alignItems:'center', gap:5,
                padding:'4px 10px', borderRadius:8, cursor:'pointer',
                fontSize:'0.68rem', fontWeight:700,
                background: active ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.08)'}`,
                color: active ? '#a78bfa' : '#64748b',
                transition:'all 0.15s',
              }}
            >
              <Icon style={{ width:10, height:10 }} />
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Colour picker ─────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, flexWrap:'wrap' }}>
        <Palette style={{ width:13, height:13, color:'#a78bfa', flexShrink:0 }} />
        <span style={{ fontSize:'0.6rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(148,163,184,0.5)', marginRight:4 }}>
          Strike colour
        </span>
        {STRIKE_COLOUR_OPTIONS.map(opt => {
          const active = strikeColour === opt.id;
          return (
            <button key={opt.id} onClick={() => setStrikeColour(opt.id)}
              style={{
                display:'flex', alignItems:'center', gap:4,
                padding:'3px 9px', borderRadius:7, cursor:'pointer',
                fontSize:'0.65rem', fontWeight:700,
                background: active ? (opt.hex ? opt.hex + '33' : 'rgba(167,139,250,0.18)') : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? (opt.hex || '#a78bfa') : 'rgba(255,255,255,0.08)'}`,
                color: active ? (opt.hex || '#a78bfa') : '#64748b',
                transition:'all 0.15s',
              }}>
              {opt.id !== 'age' && <span style={{ width:8, height:8, borderRadius:'50%', background:opt.hex, display:'inline-block', flexShrink:0 }} />}
              {opt.label}
            </button>
          );
        })}
      </div>

      <div ref={wrapRef} style={{ position:'relative', width:'100%', borderRadius:12, overflow:'hidden', background:t.mapSeaTop, border:'1px solid rgba(255,255,255,0.05)', display:'flex', justifyContent:'center', alignItems:'flex-start' }}>
        {/* Base SVG — country outline + heatmap */}
        <svg width={size.w} height={size.h} style={{ display:'block', position:'relative', zIndex:1 }}>
          <defs>
            <filter id="tcm-soften-light" x="-15%" y="-15%" width="130%" height="130%">
              <feGaussianBlur stdDeviation={Math.max(1.5, Math.min(size.w,size.h)/320)} />
              <feComponentTransfer><feFuncA type="linear" slope="1.7" intercept="-0.4" /></feComponentTransfer>
            </filter>
          </defs>
          <rect x={0} y={0} width={size.w} height={size.h} fill={t.mapSeaTop} />
          {outline && <path d={outline} fill={t.mapLand} stroke={t.mapBorder} strokeWidth={0.7} />}
          {showHeatmap && matrixData && (
            <g opacity={0.55}>
              <HeatmapLayer matrix={matrixData.M} rows={matrixData.rows} cols={matrixData.cols} bbox={bbox} w={size.w} h={size.h} riskType={riskType} day={dayIdx} />
            </g>
          )}
          {outline && <path d={outline} fill="none" stroke={t.mapBorder} strokeWidth={0.9} pointerEvents="none" opacity={lightMode?1:0.6} />}
          <TitleCard w={Math.min(420,size.w-20)} x={10} y={10} title={`Lightning Verification · ${REGIONS[region].label}`} sub={`${visibleStrikes.length.toLocaleString()} strikes · today · Blitzortung`} />
        </svg>
        {/* Canvas overlay — all strikes drawn here, no DOM element per strike */}
        {showStrikes && (
          <StrikeCanvas
            strikes={visibleStrikes}
            bbox={bbox}
            w={size.w}
            h={size.h}
            project={project}
            colourId={strikeColour}
            now={now}
          />
        )}
      </div>
      <p style={{ margin:'10px 2px 0', fontSize:'0.7rem', color:t.textMuted, lineHeight:1.5 }}>
        Coloured circles are real cloud-to-ground strikes from the Blitzortung community network — brighter = more recent. Strikes are stored and synced across all devices and browsers.
      </p>
    </Section>
  );
}