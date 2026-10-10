/* The Location Weather landing state — what you see before searching.
 *
 * It used to be a 100px emoji, one line of text and five city buttons. This
 * gives it something to do: a prominent search, your own recent places, a
 * one-tap "use my location", and an honest statement of what the page covers.
 *
 * NOTHING HERE INVENTS A NUMBER. It would be easy to put a temperature on each
 * city card, but that is a Met Office call per card on a page nobody has asked
 * for a forecast on yet. The cards are navigation, and they look like it.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, Clock, Crosshair, X, Loader2, ShieldCheck } from 'lucide-react';
import LocationSearchBox from './LocationSearchBox';

const POPULAR = [
  { name: 'London', region: 'Greater London' },
  { name: 'Manchester', region: 'Greater Manchester' },
  { name: 'Birmingham', region: 'West Midlands' },
  { name: 'Edinburgh', region: 'Scotland' },
  { name: 'Cardiff', region: 'Wales' },
  { name: 'Belfast', region: 'Northern Ireland' },
  { name: 'Glasgow', region: 'Scotland' },
  { name: 'Leeds', region: 'West Yorkshire' },
];

const timeAgo = (iso) => {
  const then = new Date(iso).getTime();
  if (!then || Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
};

function SectionLabel({ icon: Icon, children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      {Icon && <Icon style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.5)' }} />}
      <span style={{
        fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.13em',
        textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)',
      }}>
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
      {action}
    </div>
  );
}

export default function LocationLanding({
  query, onQueryChange, onSearch, loading,
  recent = [], onForget, onClearAll,
  user, authChecked,
  onUseMyLocation, locating, geoError,
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      style={{ paddingTop: 18, paddingBottom: 40 }}
    >
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '4px 12px', borderRadius: 99, marginBottom: 14,
          background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)',
        }}>
          <ShieldCheck style={{ width: 12, height: 12, color: '#7dd3fc' }} />
          <span style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em', color: 'rgba(255,255,255,0.85)' }}>
            Official Met Office data
          </span>
        </div>

        <h2 style={{
          margin: 0, fontSize: 'clamp(1.6rem, 5vw, 2.4rem)', fontWeight: 800,
          letterSpacing: '-0.03em', color: '#fff', lineHeight: 1.1,
        }}>
          What&rsquo;s the weather where you are?
        </h2>
        <p style={{ margin: '10px auto 0', maxWidth: 440, fontSize: '0.95rem', lineHeight: 1.5, color: 'rgba(255,255,255,0.65)' }}>
          Hour-by-hour and daily forecasts for anywhere in the UK and Ireland —
          and anywhere else in the world.
        </p>
      </div>

      {/* ── Search ───────────────────────────────────────────────── */}
      <div style={{ maxWidth: 520, margin: '0 auto 12px', display: 'flex', gap: 8 }}>
        <LocationSearchBox
          value={query}
          onChange={onQueryChange}
          onSearch={onSearch}
          loading={loading}
          size="large"
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 34 }}>
        <button
          type="button"
          onClick={onUseMyLocation}
          disabled={locating}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '7px 16px', borderRadius: 99, cursor: locating ? 'default' : 'pointer',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)',
            color: 'rgba(255,255,255,0.85)', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
          }}>
          {locating
            ? <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
            : <Crosshair style={{ width: 13, height: 13, color: '#7dd3fc' }} />}
          {locating ? 'Finding you…' : 'Use my location'}
        </button>
      </div>

      {geoError && (
        <p style={{ textAlign: 'center', margin: '-22px 0 28px', fontSize: '0.78rem', color: '#fca5a5' }}>
          {geoError}
        </p>
      )}

      {/* ── Recent searches ──────────────────────────────────────── */}
      {recent.length > 0 && (
        <div style={{ maxWidth: 620, margin: '0 auto 30px' }}>
          <SectionLabel
            icon={Clock}
            action={
              <button type="button" onClick={onClearAll}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                               fontSize: '0.66rem', fontWeight: 700, color: 'rgba(255,255,255,0.45)' }}>
                Clear
              </button>
            }>
            Your recent searches
          </SectionLabel>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {recent.map((r) => (
              <div key={`${r.name}|${r.lat}|${r.lon}`}
                   style={{
                     display: 'inline-flex', alignItems: 'center',
                     background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)',
                     borderRadius: 99, overflow: 'hidden',
                   }}>
                <button
                  type="button"
                  onClick={() => onSearch({ name: r.name, region: r.region, lat: r.lat, lon: r.lon })}
                  style={{
                    display: 'inline-flex', alignItems: 'baseline', gap: 7,
                    padding: '7px 6px 7px 14px', background: 'none', border: 'none',
                    cursor: 'pointer', color: '#fff', fontSize: '0.84rem', fontWeight: 600, fontFamily: 'inherit',
                  }}>
                  {r.name}
                  {r.region && (
                    <span style={{ fontSize: '0.68rem', fontWeight: 500, color: 'rgba(255,255,255,0.45)' }}>
                      {r.region}
                    </span>
                  )}
                  {r.at && (
                    <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.32)' }}>
                      {timeAgo(r.at)}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onForget(r)}
                  aria-label={`Remove ${r.name} from recent searches`}
                  style={{ padding: '7px 11px 7px 5px', background: 'none', border: 'none',
                           cursor: 'pointer', color: 'rgba(255,255,255,0.35)', lineHeight: 1 }}>
                  <X style={{ width: 12, height: 12 }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Only say this once we actually know they are signed out, so the line
          does not flash at a signed-in reader while auth is still resolving. */}
      {authChecked && !user && (
        <p style={{ maxWidth: 620, margin: '0 auto 30px', textAlign: 'center', fontSize: '0.78rem', color: 'rgba(255,255,255,0.42)' }}>
          Sign in and this page will remember the places you look up.
        </p>
      )}

      {/* ── Popular ──────────────────────────────────────────────── */}
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <SectionLabel icon={MapPin}>Popular places</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {POPULAR.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => onSearch({ name: c.name })}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
                padding: '11px 14px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)',
                fontFamily: 'inherit', transition: 'background 0.15s, border-color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.13)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}>
              <span style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 700 }}>{c.name}</span>
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.7rem' }}>{c.region}</span>
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
