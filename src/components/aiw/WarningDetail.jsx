import React, { useEffect, useState } from 'react';
import { MapPin, Gauge, Navigation, History, ShieldCheck, Database, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { SEV, aiwGet, fmtAt, fmtRemaining, fmtAgo, STATUS_LABEL, sevText } from './aiwClient';

/** Severity badge: icon + word + level, never colour alone. */
export function SevBadge({ severity, size = 'md', isTest = false }) {
  const s = SEV[severity];
  if (!s) return null;
  const big = size === 'lg';
  return (
    <span aria-label={`${s.label} warning, level ${s.level} of 3`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
        padding: big ? '5px 11px' : '3px 8px', borderRadius: 7, background: s.color, color: s.ink,
        fontSize: big ? '0.78rem' : '0.62rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
      <s.Icon style={{ width: big ? 14 : 11, height: big ? 14 : 11 }} aria-hidden="true" />
      {isTest ? 'Test · ' : ''}{s.label}
    </span>
  );
}

function Row({ label, children }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', borderTop: '1px solid var(--glass-hairline)' }}>
      <span style={{ flex: '0 0 118px', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', paddingTop: 2 }}>{label}</span>
      <span style={{ flex: 1, fontSize: '0.76rem', color: 'var(--ink-1)', minWidth: 0, wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

function Section({ icon: Icon, title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={{ marginTop: 12 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
        <Icon style={{ width: 13, height: 13, color: 'var(--ink-3)' }} aria-hidden="true" />
        <span style={{ fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-2)', flex: 1, textAlign: 'left' }}>{title}</span>
        {open ? <ChevronUp style={{ width: 13, height: 13, color: 'var(--ink-3)' }} /> : <ChevronDown style={{ width: 13, height: 13, color: 'var(--ink-3)' }} />}
      </button>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
    </section>
  );
}

const CONF_TXT = { high: 'High', medium: 'Moderate', low: 'Low' };

/**
 * The warning detail view.
 *   compact  — for the map's floating panel: the essentials and a link out.
 *   full     — for the Issued Warnings Centre: everything, including history
 *              and verification against what actually happened.
 */
export default function WarningDetail({ warning, compact = false, lightMode, onShowOnMap, onOpenFull }) {
  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const id = warning?.id;

  useEffect(() => {
    if (!id || compact) return undefined;
    let cancelled = false;
    setLoading(true); setErr(null);
    aiwGet(`/warnings/${encodeURIComponent(id)}`)
      .then((j) => { if (!cancelled) setFull(j); })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, compact, warning?.updatedAt]);

  if (!warning) return null;
  const w = { ...warning, ...(full || {}) };
  const s = SEV[w.severity];
  const now = Date.now();
  const tz = w.tz; const tzl = w.tzLabel || '';
  const active = w.status === 'active';
  const ev = w.evidence || {};
  const env = ev.environment || null;

  return (
    <div style={{ padding: compact ? '12px 13px 14px' : '2px 0 6px', color: 'var(--ink-1)' }}>
      {w.isTest && (
        <div role="note" style={{ marginBottom: 9, padding: '6px 10px', borderRadius: 9, fontSize: '0.7rem', fontWeight: 800, background: 'repeating-linear-gradient(45deg,rgba(148,163,184,0.18) 0 8px,transparent 8px 16px)', border: '1.5px dashed var(--ink-3)', color: 'var(--ink-1)' }}>
          TEST WARNING — issued by an administrator to exercise the system. Not a forecast.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, flexWrap: 'wrap' }}>
        <SevBadge severity={w.severity} size="lg" isTest={w.isTest} />
        <span style={{
          padding: '4px 9px', borderRadius: 7, fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
          background: active ? 'rgba(52,211,153,0.15)' : 'var(--glass-fill)', color: active ? (lightMode ? '#047857' : '#34d399') : 'var(--ink-2)',
          border: `1px solid ${active ? 'rgba(52,211,153,0.4)' : 'var(--glass-hairline)'}`,
        }}>{STATUS_LABEL[w.status] || w.status}{active && w.state && w.state !== 'issued' ? ` · ${STATUS_LABEL[w.state] || w.state}` : ''}</span>
        {w.dataStale && active && (
          <span style={{ padding: '4px 9px', borderRadius: 7, fontSize: '0.62rem', fontWeight: 800, background: 'rgba(244,67,54,0.14)', color: lightMode ? '#C62828' : '#F44336', border: '1px solid rgba(244,67,54,0.4)' }}>
            LIGHTNING DATA DELAYED — NOT BEING UPDATED
          </span>
        )}
      </div>
      <h3 style={{ margin: '9px 0 2px', fontSize: compact ? '0.95rem' : '1.1rem', fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.25 }}>
        {w.title}
      </h3>
      <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--ink-3)', fontFamily: 'ui-monospace, monospace' }}>{w.id}</p>

      <div style={{ margin: '10px 0 0', borderRadius: 12, padding: '2px 11px 7px', background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)' }}>
        <Row label="Valid from">{fmtAt(w.validFrom, tz, true)} {tzl}</Row>
        <Row label={active ? 'Expires (predicted)' : 'Was due to expire'}>
          {fmtAt(w.expiresAt, tz, true)} {tzl}{active && w.remainingMin != null ? ` · ${fmtRemaining(w.remainingMin)}` : ''}
        </Row>
        {!active && w.endedAt && <Row label={w.status === 'cancelled' ? 'Cancelled' : 'Ended'}>{fmtAt(w.endedAt, tz, true)} {tzl} — {w.endReason}</Row>}
        {w.peakAt && active && w.peakAt > now && <Row label="Peak risk">around {fmtAt(w.peakAt, tz)} {tzl}</Row>}
        <Row label="Issued">{fmtAt(w.issuedAt, tz, true)} {tzl} ({fmtAgo(w.issuedAt, now)})</Row>
        <Row label="Last updated">{w.updatedAt ? `${fmtAt(w.updatedAt, tz)} ${tzl} (${fmtAgo(w.updatedAt, now)})` : '—'}</Row>
        <Row label="Area">{w.areaLabel}{w.areaKm2 ? ` · ${w.areaKm2.toLocaleString()} km²` : ''}</Row>
        <Row label="Confidence">{CONF_TXT[w.confidence] || w.confidence}{w.coverage === 'partial' ? ' · partial lightning-network coverage here' : ''}</Row>
      </div>

      <p style={{ margin: '11px 0 0', fontSize: compact ? '0.78rem' : '0.84rem', lineHeight: 1.6 }}>{w.description}</p>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 11 }}>
        {onShowOnMap && (
          <button type="button" onClick={() => onShowOnMap(w)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 700, background: s.color, color: s.ink, border: 'none' }}>
            <MapPin style={{ width: 13, height: 13 }} /> Show on map
          </button>
        )}
        {compact && onOpenFull && (
          <button type="button" onClick={() => onOpenFull(w)}
            style={{ padding: '7px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 700, background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)' }}>
            Full warning details
          </button>
        )}
      </div>

      {!compact && (
        <>
          {loading && <p style={{ fontSize: '0.74rem', color: 'var(--ink-3)', marginTop: 12 }}><Loader2 style={{ width: 12, height: 12, animation: 'spin 0.9s linear infinite', verticalAlign: -2 }} /> Loading the full record…</p>}
          {err && <p style={{ fontSize: '0.74rem', color: sevText('red', lightMode), marginTop: 12 }}>Could not load the full record: {err}</p>}

          <Section icon={ShieldCheck} title="Why this warning was issued">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.76rem', lineHeight: 1.55 }}>
              {(w.reasons || []).map((r) => <li key={r}>{r}</li>)}
            </ul>
            {!!w.confidenceReasons?.length && (
              <p style={{ margin: '7px 0 0', fontSize: '0.7rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                <b>Confidence ({CONF_TXT[w.confidence] || w.confidence}):</b> {w.confidenceReasons.join('; ')}.
              </p>
            )}
          </Section>

          {ev && Object.keys(ev).length > 0 && (
            <Section icon={Gauge} title="Evidence">
              <div style={{ borderRadius: 12, padding: '2px 11px 7px', background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)' }}>
                <Row label="Strike rate">{ev.ratePerMin} / min now · {ev.previousRatePerMin} / min the 10 min before ({ev.phase})</Row>
                <Row label="Strikes, last 10 min">{ev.strikes10}</Row>
                <Row label="Peak probability">{ev.peakProbability != null ? `${Math.round(ev.peakProbability * 100)}% of lightning within 8 km, peaking at +${ev.peakLeadMin} min` : null}</Row>
                <Row label="Core density">{ev.peakDensity100 != null ? `${ev.peakDensity100} strikes per 100 km² in 10 min` : null}</Row>
                <Row label="People in area">{ev.exposedPopulation ? ev.exposedPopulation.toLocaleString() : 'no towns over 15,000'}{ev.populationAhead ? ` · ${ev.populationAhead.toLocaleString()} more in the path within ${ev.timeToPopulationMin} min` : ''}</Row>
                <Row label="Motion estimate">{w.track ? `${w.track.speedKmh} km/h toward ${Math.round(w.track.towardDeg)}°` : null}{ev.motionSources?.length ? ` · from ${ev.motionSources.join(', ')}` : ''}{ev.motionSpreadKmh != null ? ` (estimates agree within ${ev.motionSpreadKmh} km/h)` : ''}</Row>
                <Row label="Tracked for">{ev.trackCycles ? `${ev.trackCycles} min` : null}</Row>
                {env && <Row label="Atmosphere">CAPE {env.cape ?? '—'} J/kg · lifted index {env.liftedIndex ?? '—'} · CIN {env.cin ?? '—'} J/kg · 0–6 km shear {env.shear0_6kmKmh ?? '—'} km/h · steering wind {env.steeringKmh ?? '—'} km/h <span style={{ color: 'var(--ink-3)' }}>({env.source}, {env.validHour?.slice(11, 16)} UTC)</span></Row>}
              </div>
            </Section>
          )}

          {!!w.forecast?.length && (
            <Section icon={Navigation} title="30-minute forecast track">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(92px,1fr))', gap: 6 }}>
                {w.forecast.map((f) => (
                  <div key={f.lead} style={{ padding: '6px 8px', borderRadius: 9, background: 'var(--glass-fill)', border: `1px dashed ${s.color}` }}>
                    <div style={{ fontSize: '0.66rem', fontWeight: 800 }}>+{f.lead} min</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--ink-3)', fontFamily: 'ui-monospace, monospace' }}>{fmtAt(f.validAt, tz)} · {f.centroid[0].toFixed(2)}, {f.centroid[1].toFixed(2)}</div>
                  </div>
                ))}
              </div>
              {!!w.geography?.placesAhead?.length && (
                <p style={{ margin: '7px 0 0', fontSize: '0.72rem', color: 'var(--ink-2)' }}>
                  Forecast to reach: {w.geography.placesAhead.slice(0, 8).map((p) => p.name).join(', ')}.
                </p>
              )}
            </Section>
          )}

          {w.verification?.byLead && (
            <Section icon={ShieldCheck} title="How the forecast verified">
              <p style={{ margin: '0 0 6px', fontSize: '0.7rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                Each logged 30-minute forecast compared with the lightning that actually followed. <b>Captured</b>: share of the storm&apos;s later strikes that fell inside the forecast area for that time. <b>Area with no strike</b>: share of the forecast area with no strike within 8 km.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                <thead><tr style={{ color: 'var(--ink-3)', textAlign: 'left' }}><th>Lead</th><th>Captured</th><th>Area with no strike</th><th>Strikes</th></tr></thead>
                <tbody>
                  {Object.entries(w.verification.byLead).map(([L, v]) => (
                    <tr key={L} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                      <td>+{L} min</td>
                      <td>{v.capture == null ? '—' : `${Math.round(v.capture * 100)}%`}</td>
                      <td>{v.falseAreaFraction == null ? '—' : `${Math.round(v.falseAreaFraction * 100)}%`}</td>
                      <td>{v.strikes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
          {w.verification?.skipped && <p style={{ fontSize: '0.7rem', color: 'var(--ink-3)', marginTop: 10 }}>Not verified: {w.verification.skipped}.</p>}
          {!w.verification && !active && <p style={{ fontSize: '0.7rem', color: 'var(--ink-3)', marginTop: 10 }}>Verification runs once 35 minutes of observations after the last forecast are in.</p>}

          {!!(w.events?.length || w.versions?.length) && (
            <Section icon={History} title="History" defaultOpen={false}>
              <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                {(w.events || []).map((e) => (
                  <li key={e.id} style={{ display: 'flex', gap: 9, padding: '6px 0', borderTop: '1px solid var(--glass-hairline)' }}>
                    <span style={{ flex: '0 0 68px', fontSize: '0.66rem', fontFamily: 'ui-monospace, monospace', color: 'var(--ink-3)' }}>{fmtAt(e.at, tz)}</span>
                    <span style={{ flex: 1, fontSize: '0.72rem' }}>
                      <b>{STATUS_LABEL[e.type] || e.type}</b>
                      {e.from && e.to ? ` ${e.from} → ${e.to}` : e.to ? ` (${e.to})` : ''}
                      {e.reason ? <span style={{ color: 'var(--ink-2)' }}> — {e.reason}</span> : null}
                      {e.actor && e.actor !== 'engine' ? <span style={{ color: 'var(--ink-3)' }}> · by {e.actor}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
              <p style={{ margin: '6px 0 0', fontSize: '0.64rem', color: 'var(--ink-3)' }}>{(w.versions || []).length} recorded versions of this warning are kept; the original is never overwritten.</p>
            </Section>
          )}

          <Section icon={Database} title="Data and model" defaultOpen={false}>
            <div style={{ borderRadius: 12, padding: '2px 11px 7px', background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)' }}>
              <Row label="Forecast model">{w.model?.version}{w.model?.trained ? '' : ' (baseline — no trained model validated yet)'}</Row>
              <Row label="Lightning feed">{w.dataQuality?.feed}</Row>
              <Row label="Atmosphere">{w.dataQuality?.environment?.source}{w.dataQuality?.environment?.status ? ` (${w.dataQuality.environment.status})` : ''}</Row>
              <Row label="Radar / satellite">{w.dataQuality ? `${w.dataQuality.radar}; ${w.dataQuality.satellite}` : null}</Row>
              <Row label="Expiry basis">{w.expiryBasis ? `storm lifetime ≈ ${w.expiryBasis.lifetimeMin} min${w.expiryBasis.transitMin != null ? `, time to cross the area ≈ ${w.expiryBasis.transitMin} min` : ''}` : null}</Row>
            </div>
          </Section>

          <p style={{ margin: '14px 0 0', fontSize: '0.64rem', lineHeight: 1.5, color: 'var(--ink-3)' }}>{full?.disclaimer}</p>
        </>
      )}
    </div>
  );
}
