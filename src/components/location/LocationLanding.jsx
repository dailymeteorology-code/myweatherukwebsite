/* The Location Weather landing state, before a search: the search itself, "use my location",
   your recent places, and the big cities with the weather there right now.

   The city cards' numbers are the 15-minute Met Office UKV analysis (corrected by station
   reports) and the radar at each city, read from this site's own server in one request; no
   per-card forecast call. */
import React, { useEffect, useState } from 'react';
import { MapPin, Clock, Crosshair, X, Loader2, ShieldCheck } from 'lucide-react';
import LocationSearchBox from './LocationSearchBox';
import WxIcon from './WxIcon';
import { classify, condLabel, sunElevation } from '@/lib/ukvLocation';

const POPULAR = [
  { name: 'London', region: 'Greater London', lat: 51.5074, lon: -0.1278 },
  { name: 'Manchester', region: 'Greater Manchester', lat: 53.4808, lon: -2.2426 },
  { name: 'Birmingham', region: 'West Midlands', lat: 52.4862, lon: -1.8904 },
  { name: 'Edinburgh', region: 'Scotland', lat: 55.9533, lon: -3.1883 },
  { name: 'Cardiff', region: 'Wales', lat: 51.4816, lon: -3.1791 },
  { name: 'Belfast', region: 'Northern Ireland', lat: 54.5973, lon: -5.9301 },
  { name: 'Glasgow', region: 'Scotland', lat: 55.8642, lon: -4.2518 },
  { name: 'Leeds', region: 'West Yorkshire', lat: 53.8008, lon: -1.5491 },
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

function Label({ icon: Icon, children, action }) {
  return (
    <div className="lw-title" style={{ marginBottom: 10 }}>
      {Icon && <Icon />}{children}
      {action && <span className="lw-title-aside">{action}</span>}
    </div>
  );
}

export default function LocationLanding({
  query, onQueryChange, onSearch, loading,
  recent = [], onForget, onClearAll,
  user, authChecked,
  onUseMyLocation, locating, geoError, unit = 'C',
}) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/location/now?p=${POPULAR.map((p) => `${p.lat},${p.lon}`).join('|')}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null)).then((j) => j && setNow(j.places)).catch(() => {});
    return () => ac.abort();
  }, []);

  return (
    <div style={{ paddingTop: 8, paddingBottom: 40 }}>
      <div style={{ textAlign: 'center', margin: '18px 0 26px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 99, marginBottom: 14, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
          <ShieldCheck size={12} color="#bfe6ff" />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Met Office UKV · 2 km · updated through the day</span>
        </div>
        <h1 style={{ margin: 0, fontSize: 'clamp(30px, 6vw, 46px)', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.08, textShadow: '0 2px 18px rgba(0,10,30,0.25)' }}>
          The weather, wherever you are
        </h1>
        <p style={{ margin: '10px auto 0', maxWidth: 470, fontSize: 16, lineHeight: 1.5, color: 'var(--ink2)' }}>
          Hour by hour for five days, rain radar, and every detail the Met Office&rsquo;s high-resolution model has, for anywhere in the UK and Ireland.
        </p>
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto 12px', display: 'flex', gap: 8 }}>
        <LocationSearchBox value={query} onChange={onQueryChange} onSearch={onSearch} loading={loading} size="large" autoFocus />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 30 }}>
        <button type="button" className="lw-chip" onClick={onUseMyLocation} disabled={locating}>
          {locating ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
          {locating ? 'Finding you…' : 'Use my location'}
        </button>
      </div>
      {geoError && <p style={{ textAlign: 'center', margin: '-18px 0 24px', fontSize: 13, color: '#fecaca' }}>{geoError}</p>}

      {recent.length > 0 && (
        <div className="lw-glass lw-card" style={{ maxWidth: 680, margin: '0 auto 16px' }}>
          <Label icon={Clock} action={<button type="button" onClick={onClearAll} style={{ background: 'none', border: 0, color: 'var(--ink2)', cursor: 'pointer', font: 'inherit', fontSize: 12 }}>Clear</button>}>
            Your recent places
          </Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {recent.map((r) => (
              <span key={`${r.name}|${r.lat}|${r.lon}`} className="lw-chip" style={{ padding: 0 }}>
                <button type="button" onClick={() => onSearch({ name: r.name, region: r.region, lat: r.lat, lon: r.lon })}
                  style={{ background: 'none', border: 0, color: '#fff', font: 'inherit', fontWeight: 600, padding: '6px 4px 6px 12px', cursor: 'pointer' }}>
                  {r.name}{r.at && <span style={{ fontWeight: 500, color: 'var(--ink3)', marginLeft: 6, fontSize: 11 }}>{timeAgo(r.at)}</span>}
                </button>
                <button type="button" onClick={() => onForget(r)} aria-label={`Remove ${r.name}`}
                  style={{ background: 'none', border: 0, color: 'var(--ink3)', padding: '6px 10px 6px 2px', cursor: 'pointer', lineHeight: 0 }}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      {authChecked && !user && (
        <p style={{ textAlign: 'center', margin: '0 0 16px', fontSize: 13, color: 'var(--ink3)' }}>Sign in and this page will remember the places you look up.</p>
      )}

      <div className="lw-glass lw-card" style={{ maxWidth: 680, margin: '0 auto' }}>
        <Label icon={MapPin}>Right now</Label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
          {POPULAR.map((c, i) => {
            const n = now?.[i];
            const day = sunElevation(Date.now(), c.lat, c.lon) > -0.833;
            const cond = n ? classify({ tcc: n.tcc, precipRate: n.radar ?? 0, span: 0 }) : null;
            return (
              <button key={c.name} type="button" onClick={() => onSearch({ name: c.name, region: c.region, lat: c.lat, lon: c.lon })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 16, cursor: 'pointer', textAlign: 'left', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', color: '#fff', font: 'inherit' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{c.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cond ? condLabel(cond, day) : c.region}</span>
                </span>
                {cond && <WxIcon cond={cond} day={day} size={28} />}
                {n?.t2 != null && <span style={{ fontSize: 22, fontWeight: 300 }}>{Math.round(unit === 'F' ? (n.t2 * 9) / 5 + 32 : n.t2)}°</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
