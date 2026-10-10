import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart2, ChevronDown } from 'lucide-react';

function todayDateStr() { return new Date().toISOString().slice(0, 10); }

export default function OMHistoricalPanel({ omHistory, loading }) {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState(30);

  const entries = Object.entries(omHistory || {})
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days);

  const maxCount  = entries.length ? Math.max(...entries.map(e => e.count), 1) : 1;
  const total     = entries.reduce((s, e) => s + e.count, 0);
  const peakEntry = entries.reduce((best, e) => e.count > (best?.count || 0) ? e : best, null);

  const barColor = (count) => {
    if (count >= 1000) return '#ef4444';
    if (count >= 300)  return '#f97316';
    if (count >= 50)   return '#facc15';
    if (count >= 10)   return '#4ade80';
    return '#38bdf8';
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00Z');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-6xl px-6 mb-6">
      <button onClick={() => setExpanded(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderRadius: 16, background: 'rgba(250,204,21,0.04)', border: '1px solid rgba(250,204,21,0.15)', cursor: 'pointer', marginBottom: expanded ? 14 : 0 }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(250,204,21,0.08)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(250,204,21,0.04)')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(250,204,21,0.12)', border: '1px solid rgba(250,204,21,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BarChart2 style={{ width: 16, height: 16, color: '#facc15' }} />
          </div>
          <div style={{ textAlign: 'left' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9' }}>Historical Lightning Activity</p>
            <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b' }}>
              Open-Meteo observed strike counts · last {days} days{loading && ' · Updating…'}
            </p>
          </div>
          {total > 0 && (
            <div style={{ marginLeft: 12, padding: '3px 12px', borderRadius: 999, background: 'rgba(250,204,21,0.12)', border: '1px solid rgba(250,204,21,0.2)', fontSize: '0.72rem', fontWeight: 700, color: '#facc15', fontFamily: 'monospace' }}>
              {total.toLocaleString()} total
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={e => { e.stopPropagation(); setDays(d); }}
              style={{ padding: '3px 10px', borderRadius: 8, fontSize: '0.65rem', fontWeight: 700, border: `1px solid ${days === d ? '#facc15' : 'rgba(255,255,255,0.1)'}`, background: days === d ? 'rgba(250,204,21,0.15)' : 'transparent', color: days === d ? '#facc15' : '#475569', cursor: 'pointer' }}>
              {d}d
            </button>
          ))}
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown style={{ width: 16, height: 16, color: '#475569' }} />
          </motion.div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35 }} style={{ overflow: 'hidden' }}>
            <div style={{ borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(8,12,24,0.92)', backdropFilter: 'blur(16px)' }}>
              <div style={{ padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>⚡ Total Strikes</p>
                  <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#facc15', fontFamily: 'monospace', lineHeight: 1.2 }}>{total.toLocaleString()}</p>
                </div>
                {peakEntry && (
                  <div>
                    <p style={{ margin: 0, fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>▶ Peak Day</p>
                    <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f1f5f9', fontFamily: 'monospace' }}>
                      {peakEntry.date}{' '}
                      <span style={{ color: peakEntry.count >= 1000 ? '#ef4444' : peakEntry.count >= 300 ? '#f97316' : '#facc15' }}>
                        ({peakEntry.count.toLocaleString()} strikes)
                      </span>
                    </p>
                  </div>
                )}
                <div>
                  <p style={{ margin: 0, fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Days with Activity</p>
                  <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>{entries.filter(e => e.count > 0).length} / {entries.length}</p>
                </div>
              </div>

              <div style={{ padding: '20px 24px 8px' }}>
                <p style={{ margin: '0 0 12px', fontSize: '0.62rem', fontWeight: 700, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Daily Strike Count</p>
                {entries.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: '#334155', fontSize: '0.8rem' }}>
                    {loading ? 'Loading historical data…' : 'No data available for this period'}
                  </div>
                )}
                {entries.length > 0 && (
                  <div style={{ position: 'relative' }}>
                    {[0.25, 0.5, 0.75, 1.0].map(frac => (
                      <div key={frac} style={{ position: 'absolute', left: 0, right: 0, bottom: 40 + frac * 140, borderTop: '1px dashed rgba(255,255,255,0.05)', pointerEvents: 'none' }}>
                        <span style={{ position: 'absolute', right: 0, top: -8, fontSize: '0.58rem', color: '#334155', fontFamily: 'monospace' }}>
                          {Math.round(maxCount * frac).toLocaleString()}
                        </span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 180, paddingBottom: 40, overflowX: 'auto', paddingRight: 8 }}>
                      {entries.map(entry => {
                        const heightPct = maxCount > 0 ? (entry.count / maxCount) * 140 : 0;
                        const color = barColor(entry.count);
                        const isToday = entry.date === todayDateStr();
                        return (
                          <div key={entry.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0, minWidth: days > 20 ? 28 : 38 }}
                            title={`${entry.date}: ${entry.count.toLocaleString()} strikes`}>
                            {entry.count > 0 && (
                              <span style={{ fontSize: '0.55rem', color, fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {entry.count >= 1000 ? (entry.count / 1000).toFixed(1) + 'k' : entry.count}
                              </span>
                            )}
                            <div style={{ position: 'relative', width: '100%' }}>
                              <div style={{ width: '100%', height: Math.max(heightPct, entry.count > 0 ? 3 : 1), background: entry.count > 0 ? `linear-gradient(to top, ${color}cc, ${color})` : 'rgba(255,255,255,0.04)', borderRadius: '3px 3px 0 0', border: isToday ? `1px solid ${color}` : 'none', boxShadow: entry.count > 0 ? `0 0 8px ${color}44` : 'none', transition: 'height 0.4s ease' }} />
                            </div>
                            <span style={{ fontSize: '0.52rem', color: isToday ? '#facc15' : '#334155', fontFamily: 'monospace', whiteSpace: 'nowrap', transform: 'rotate(-45deg)', transformOrigin: 'top left', marginTop: 4, display: 'block', width: 30 }}>
                              {formatDate(entry.date)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ padding: '0 24px 18px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  { color: '#38bdf8', label: '< 10 strikes' }, { color: '#4ade80', label: '10 – 49' },
                  { color: '#facc15', label: '50 – 299' }, { color: '#f97316', label: '300 – 999' },
                  { color: '#ef4444', label: '1000+' },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                    <span style={{ fontSize: '0.62rem', color: '#475569' }}>{label}</span>
                  </div>
                ))}
                <span style={{ fontSize: '0.62rem', color: '#334155', marginLeft: 'auto' }}>Source: Open-Meteo ERA5 archive</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}