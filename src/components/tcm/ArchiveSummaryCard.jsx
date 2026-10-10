// Single archive entry card — shared between dashboard and dedicated archive
// page. Designed so the archive page can list hundreds of entries in a tight,
// scannable grid (≈80px tall each).
import React from 'react';
import { motion } from 'framer-motion';
import { CloudLightning, Zap, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { RISK_COLOR, RISK_FILL, RISK_BORDER } from '@/components/tcm/riskConfig';

export default function ArchiveSummaryCard({ entry, compact = false }) {
  const lvl = entry.level || 'No Risk';
  const lvlColor  = RISK_COLOR(lvl, 'thunderstorm');
  const lvlFill   = RISK_FILL(lvl, 'thunderstorm');
  const lvlBorder = RISK_BORDER(lvl, 'thunderstorm');
  const dateObj = new Date(entry.date);
  const dateStr = dateObj.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  if (compact) {
    return (
      <Link to={`/TCMArchive?date=${entry.date}&region=${entry.region}`}
        style={{ textDecoration: 'none' }}>
        <motion.div whileHover={{ y: -2 }}
          style={{
            display: 'grid',
            gridTemplateColumns: '90px 1fr auto',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            background: `linear-gradient(90deg, ${lvlFill}, rgba(15,23,42,0.4))`,
            border: `1px solid ${lvlBorder}`,
            borderLeft: `4px solid ${lvlColor}`,
            borderRadius: 10,
            cursor: 'pointer',
          }}>
          <span style={{
            fontSize: '0.62rem', fontWeight: 800, color: lvlColor === '#000000' ? '#fff' : lvlColor,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            padding: '3px 8px', borderRadius: 99,
            background: lvlFill, border: `1.5px solid ${lvlBorder}`,
            textAlign: 'center',
          }}>{lvl}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f1f5f9' }}>{dateStr}</div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.region?.toUpperCase()} · Score {entry.score}/100 · Coverage ~{entry.coverage || 0}%
            </div>
          </div>
          <ChevronRight style={{ width: 14, height: 14, color: '#64748b' }} />
        </motion.div>
      </Link>
    );
  }

  // Full card (for the dedicated archive page detail view)
  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)',
      border: `1px solid ${lvlBorder}`, borderRadius: 12, overflow: 'hidden', marginBottom: 12,
    }}>
      <div style={{
        background: `linear-gradient(135deg, ${lvlFill}, transparent)`,
        borderBottom: `1px solid ${lvlBorder}`,
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 10px', borderRadius: 99, background: lvlFill, border: `1.5px solid ${lvlBorder}`,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: lvlColor, boxShadow: `0 0 6px ${lvlColor}` }} />
          <span style={{ fontSize: '0.7rem', fontWeight: 800, color: lvlColor === '#000000' ? '#fff' : lvlColor }}>{lvl}</span>
        </span>
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f1f5f9' }}>{dateStr}</span>
        <span style={{ fontSize: '0.65rem', fontFamily: "'DM Mono',monospace", color: '#94a3b8', marginLeft: 'auto' }}>
          {entry.region?.toUpperCase()} · Score {entry.score}/100
        </span>
      </div>
      <div style={{ padding: '10px 14px' }}>
        <p style={{ margin: '0 0 6px', fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.55 }}>{entry.narrative}</p>
        {entry.hazardNote && <p style={{ margin: 0, fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.5 }}>{entry.hazardNote}</p>}

        {/* Thunderstorm overview — environment metrics + hazard sub-risks */}
        {(entry.ranges || entry.sub) && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{
              fontSize: '0.6rem', fontWeight: 800, color: '#94a3b8',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              fontFamily: "'DM Mono',monospace", marginBottom: 8,
            }}>
              Thunderstorm Overview
            </div>

            {entry.ranges && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 6, marginBottom: 10 }}>
                {[
                  { label: 'Peak CAPE', value: `${entry.ranges.cape?.max || 0}`, unit: 'J/kg', color: '#ef4444' },
                  { label: 'Bulk Shear', value: `${entry.ranges.shear?.max || 0}`, unit: 'm/s', color: '#38bdf8' },
                  { label: 'Max Gust', value: `${entry.ranges.gust?.max || 0}`, unit: 'mph', color: '#a78bfa' },
                  { label: 'Rain Rate', value: `${entry.ranges.precip?.max || 0}`, unit: 'mm/h', color: '#0ea5e9' },
                  { label: 'Hail', value: `${entry.ranges.hailMm?.max || 0}`, unit: 'mm', color: '#7dd3fc' },
                  { label: 'Coverage', value: `${entry.coverage || 0}`, unit: '%', color: '#22c55e' },
                ].map(m => (
                  <div key={m.label} style={{
                    padding: '6px 8px', background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)', borderRadius: 7,
                  }}>
                    <div style={{ fontSize: '0.54rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'DM Mono',monospace" }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 800, color: m.color, fontFamily: "'DM Mono',monospace", marginTop: 1 }}>
                      {m.value}<span style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 600, marginLeft: 2 }}>{m.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {entry.sub && (
              <div>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#64748b', marginBottom: 5, fontFamily: "'DM Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Hazard sub-risks
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 6 }}>
                  {[
                    { id: 'tornado', label: 'Tornado', icon: '🌪️', color: '#f97316' },
                    { id: 'hail', label: 'Hail', icon: '🧊', color: '#38bdf8' },
                    { id: 'flashFlood', label: 'Flood', icon: '💧', color: '#0ea5e9' },
                    { id: 'strongWinds', label: 'Winds', icon: '💨', color: '#a78bfa' },
                    { id: 'supercell', label: 'Supercell', icon: '🌀', color: '#dc2626' },
                  ].map(h => {
                    const sc = entry.sub?.[h.id] || 0;
                    return (
                      <div key={h.id} style={{
                        padding: '6px 8px', background: 'rgba(255,255,255,0.025)',
                        border: '1px solid rgba(255,255,255,0.06)', borderRadius: 7,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                          <span style={{ fontSize: '0.85rem' }}>{h.icon}</span>
                          <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#cbd5e1', flex: 1 }}>{h.label}</span>
                          <span style={{ fontSize: '0.62rem', fontWeight: 800, color: sc > 5 ? h.color : '#64748b', fontFamily: "'DM Mono',monospace" }}>{sc}</span>
                        </div>
                        <div style={{ height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 99 }}>
                          <div style={{ width: `${Math.min(100, sc)}%`, height: '100%', background: h.color, borderRadius: 99 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        {(entry.outlookImage || entry.lightningImage) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 8, marginTop: 10 }}>
            {entry.outlookImage && (
              <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                <img src={entry.outlookImage} alt="Outlook 06Z" style={{ width: '100%', display: 'block' }} />
                <div style={{ position: 'absolute', top: 6, left: 6, fontSize: '0.6rem', fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.65)', padding: '3px 7px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CloudLightning style={{ width: 10, height: 10 }} /> 06Z Outlook
                </div>
              </div>
            )}
            {entry.lightningImage && (
              <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                <img src={entry.lightningImage} alt="Lightning verification 23:59" style={{ width: '100%', display: 'block' }} />
                <div style={{ position: 'absolute', top: 6, left: 6, fontSize: '0.6rem', fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.65)', padding: '3px 7px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Zap style={{ width: 10, height: 10 }} /> 23:59 Verification
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}