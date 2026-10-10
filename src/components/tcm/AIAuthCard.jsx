// ── AI authentication card for TCM forecasts ───────────────────────────────
import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, AlertOctagon, CheckCircle2, Loader2, Sparkles } from 'lucide-react';

const VERDICT_TONE = {
  APPROVED: {
    color: '#22c55e',
    fill: 'rgba(34,197,94,0.10)',
    border: 'rgba(34,197,94,0.45)',
    icon: ShieldCheck,
    label: 'AI Approved',
  },
  ADJUSTED: {
    color: '#f59e0b',
    fill: 'rgba(245,158,11,0.10)',
    border: 'rgba(245,158,11,0.45)',
    icon: CheckCircle2,
    label: 'AI Reviewed — Minor Notes',
  },
  FLAGGED: {
    color: '#dc2626',
    fill: 'rgba(220,38,38,0.10)',
    border: 'rgba(220,38,38,0.45)',
    icon: AlertOctagon,
    label: 'AI Flagged Issues',
  },
};

export default function AIAuthCard({ verdict, loading, tokens }) {
  const t = tokens;
  if (loading) {
    return (
      <div style={{
        padding: '14px 16px', marginBottom: 20, borderRadius: 14,
        background: t.cardBg, border: `1px solid ${t.cardBorder}`,
        display: 'flex', alignItems: 'center', gap: 12, backdropFilter: 'blur(12px)',
      }}>
        <Sparkles style={{ width: 18, height: 18, color: '#38bdf8' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: t.textPrimary }}>
            AI authentication in progress…
          </div>
          <div style={{ fontSize: '0.7rem', color: t.textMuted, marginTop: 2 }}>
            Sending forecast to AI meteorologist for sanity check.
          </div>
        </div>
        <Loader2 className="animate-spin" style={{ width: 16, height: 16, color: '#38bdf8' }} />
      </div>
    );
  }
  if (!verdict) return null;

  const tone = VERDICT_TONE[verdict.verdict] || VERDICT_TONE.FLAGGED;
  const Icon = tone.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        padding: 0, marginBottom: 20, borderRadius: 14, overflow: 'hidden',
        background: t.cardBg, border: `1.5px solid ${tone.border}`,
        backdropFilter: 'blur(12px)', boxShadow: t.cardShadow,
      }}
    >
      <div style={{
        padding: '12px 16px',
        background: `linear-gradient(135deg, ${tone.fill}, transparent)`,
        borderBottom: `1px solid ${tone.border}`,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: tone.fill, border: `1px solid ${tone.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon style={{ width: 16, height: 16, color: tone.color }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '0.58rem', fontWeight: 800, color: tone.color,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            fontFamily: "'DM Mono', monospace",
          }}>
            AI Authentication
          </div>
          <div style={{ fontSize: '0.92rem', fontWeight: 800, color: t.textPrimary, marginTop: 1 }}>
            {tone.label}
          </div>
        </div>
        <div style={{
          padding: '4px 10px', borderRadius: 99,
          background: tone.fill, border: `1px solid ${tone.border}`,
          fontSize: '0.7rem', fontWeight: 800, color: tone.color,
          fontFamily: "'DM Mono', monospace",
        }}>
          {verdict.confidence ?? 0}% confidence
        </div>
      </div>

      <div style={{ padding: '12px 16px 14px' }}>
        <p style={{
          margin: 0, fontSize: '0.82rem', color: t.textSecondary, lineHeight: 1.55,
        }}>
          {verdict.notes || 'No additional notes.'}
        </p>

        {Array.isArray(verdict.issues) && verdict.issues.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              fontSize: '0.62rem', fontWeight: 700, color: t.textMuted,
              textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
              fontFamily: "'DM Mono', monospace",
            }}>
              Issues identified
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {verdict.issues.map((iss, i) => (
                <div key={i} style={{
                  padding: '8px 10px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.025)',
                  border: `1px solid ${t.cardBorder}`,
                  fontSize: '0.74rem', color: t.textSecondary, lineHeight: 1.45,
                }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                    background: tone.fill, color: tone.color,
                    fontSize: '0.62rem', fontWeight: 800, marginRight: 6,
                    fontFamily: "'DM Mono', monospace",
                  }}>
                    {iss.risk?.toUpperCase()}{iss.day != null ? ` D${iss.day + 1}` : ''}
                  </span>
                  {iss.reason}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}