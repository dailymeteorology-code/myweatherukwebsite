import React from 'react';
import { CloudLightning, Maximize2, Minimize2 } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   The Lightning page's command bar — title, connection state, the
   region switch, fullscreen, and the live counters.

   This is the ONLY place any of those live. The page used to carry the
   region switch three times (page nav, this bar, and the map toolbar),
   fullscreen twice, the connection state twice, and a decorative sun/moon
   button that was not wired to anything at all. Every control has one home
   here and the map toolbar keeps only tools that act on the map itself.

   Everything is drawn from the site's liquid-glass tokens rather than from
   hardcoded midnight-blue, so the bar is the same material as the rest of
   the site and follows the theme without a second set of colours.
   ═══════════════════════════════════════════════════════════════ */

const REGIONS = [
  { id: 'uk',     short: 'UK',    long: '🇬🇧 UK' },
  { id: 'europe', short: 'EU',    long: '🌍 Europe' },
  { id: 'world',  short: 'World', long: '🌐 World' },
];

export default function LightningHeaderBar({
  lightMode, wsStatus, view, setView, mapFullscreen, setMapFullscreen,
  feedPool, lastMinUkCount, lastMinEuCount, ukCount, euCount, worldCount = 0,
  activeWarningCount, lastUpdate,
}) {
  const live = wsStatus === 'live';
  const fmt = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  /* Counters read as one continuous rail rather than seven separate cards.
     Seven bordered boxes for seven numbers is a lot of furniture for very
     little information, and at phone width it wrapped into a wall. */
  const stats = [
    { label: 'UK / min',  value: lastMinUkCount.toLocaleString(), color: '#22d3ee', hot: lastMinUkCount > 0 },
    { label: 'EU / min',  value: lastMinEuCount.toLocaleString(), color: '#8b5cf6', hot: lastMinEuCount > 0 },
    { label: 'UK today',  value: ukCount.toLocaleString(),        color: '#38bdf8' },
    { label: 'EU today',  value: euCount.toLocaleString(),        color: '#818cf8' },
    { label: 'World',     value: worldCount.toLocaleString(),     color: '#34d399' },
    { label: 'Warnings',  value: String(activeWarningCount),      color: '#f97316', hot: activeWarningCount > 0 },
    { label: 'Updated',   value: fmt(lastUpdate),                 color: 'var(--ink-2)' },
  ];

  return (
    <div style={{ padding: '14px 16px 0' }}>
      <style>{`
        .lx-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap;
                  padding:11px 14px; border-radius:20px 20px 0 0; }
        .lx-seg { display:flex; gap:2px; padding:3px; border-radius:11px;
                  background:var(--glass-fill); border:1px solid var(--glass-hairline); }
        .lx-seg button { padding:6px 13px; font:inherit; font-size:0.74rem; font-weight:700;
                  border:none; border-radius:8px; cursor:pointer; background:transparent;
                  color:var(--ink-2); transition:background .18s, color .18s; white-space:nowrap; }
        .lx-seg button[data-on="1"] { background:var(--glass-fill-strong); color:var(--ink-1);
                  box-shadow:0 1px 3px rgba(0,0,0,0.18); }
        .lx-ghost { display:flex; align-items:center; gap:6px; padding:7px 12px; border-radius:11px;
                  background:var(--glass-fill); border:1px solid var(--glass-hairline);
                  color:var(--ink-2); font-size:0.74rem; font-weight:700; cursor:pointer;
                  transition:background .18s, color .18s; }
        .lx-ghost:hover { background:var(--glass-fill-strong); color:var(--ink-1); }
        .lx-rail { display:grid; grid-template-columns:repeat(7, minmax(0,1fr));
                  border-top:1px solid var(--glass-hairline); border-radius:0 0 20px 20px;
                  overflow:hidden; }
        .lx-rail > div { padding:10px 12px; min-width:0;
                  border-left:1px solid var(--glass-hairline); }
        .lx-rail > div:first-child { border-left:none; }
        .lx-region-long { display:inline; }
        .lx-region-short { display:none; }
        @media (max-width: 720px) {
          .lx-rail { grid-template-columns:repeat(3, minmax(0,1fr)); }
          .lx-rail > div:nth-child(3n+1) { border-left:none; }
          .lx-rail > div:nth-child(n+4) { border-top:1px solid var(--glass-hairline); }
          .lx-region-long { display:none; }
          .lx-region-short { display:inline; }
        }
      `}</style>

      <div className="lg-pane" style={{ borderRadius: 20, overflow: 'hidden' }}>
        <div className="lx-bar">
          <div style={{
            width: 32, height: 32, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(34,211,238,0.22), rgba(139,92,246,0.18))',
            border: '1px solid rgba(34,211,238,0.35)',
          }}>
            <CloudLightning style={{ width: 16, height: 16, color: '#22d3ee' }} />
          </div>
          <span style={{ fontWeight: 650, fontSize: '1.02rem', letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>
            Lightning
          </span>

          {/* Connection state. One pill, and it says which of the three
              states it is in rather than only live / not-live. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 99,
            background: live ? 'rgba(52,211,153,0.13)' : 'rgba(249,115,22,0.13)',
            border: `1px solid ${live ? 'rgba(52,211,153,0.40)' : 'rgba(249,115,22,0.40)'}`,
          }}>
            <span className={live ? 'live-dot-green' : 'live-dot-amber'} style={{
              width: 6, height: 6, borderRadius: 99, display: 'block',
              background: live ? '#34d399' : '#f97316',
              boxShadow: `0 0 8px ${live ? '#34d399' : '#f97316'}`,
            }} />
            <span style={{
              fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em',
              fontFamily: 'ui-monospace, monospace',
              color: live ? (lightMode ? '#047857' : '#34d399') : (lightMode ? '#9a3412' : '#f97316'),
            }}>
              {live ? 'LIVE' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}
            {/* The feed runs several sockets at once so a stall on one never
                costs a strike. Saying how many are up makes LIVE mean
                something more precise than 'we have not given up yet'. */}
            {feedPool?.target > 0 && (
              <span style={{ opacity: 0.72, fontWeight: 700 }}>
                {' '}{feedPool.live}/{feedPool.target}
              </span>
            )}
            </span>
          </div>

          <div style={{ flex: 1, minWidth: 4 }} />

          <div className="lx-seg" role="tablist" aria-label="Region">
            {REGIONS.map(({ id, short, long }) => (
              <button key={id} role="tab" aria-selected={view === id}
                data-on={view === id ? '1' : '0'} onClick={() => setView(id)}>
                <span className="lx-region-long">{long}</span>
                <span className="lx-region-short">{short}</span>
              </button>
            ))}
          </div>

          <button className="lx-ghost" onClick={() => setMapFullscreen(v => !v)}
            title={mapFullscreen ? 'Exit fullscreen' : 'Fullscreen map'}>
            {mapFullscreen
              ? <><Minimize2 style={{ width: 13, height: 13 }} /> Exit</>
              : <><Maximize2 style={{ width: 13, height: 13 }} /> Full</>}
          </button>
        </div>

        <div className="lx-rail">
          {stats.map(({ label, value, color, hot }) => (
            <div key={label}>
              <p style={{
                margin: 0, fontSize: '0.56rem', fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--ink-3)', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{label}</p>
              <p style={{
                margin: '1px 0 0', fontSize: '1.05rem', fontWeight: 700, color,
                fontFamily: 'ui-monospace, monospace', letterSpacing: '-0.03em',
                textShadow: hot ? `0 0 14px ${color}55` : 'none',
              }}>{value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
