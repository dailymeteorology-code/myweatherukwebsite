/**
 * Presentation for the "Around the World" section.
 *
 * Split from the data layer so the fetching, the WMO→Met Office mapping and the
 * lightning bookkeeping stay readable next to each other, and the markup stays
 * readable on its own.
 *
 * Three deliberate choices, because the first pass got them wrong:
 *
 *  - The scrim is bottom-weighted, not a flat wash. The animated sky is the
 *    best thing on the card; covering all of it at 35% black to make the text
 *    legible made fifteen cards look like fifteen grey rectangles. The gradient
 *    now runs transparent at the top to near-black at the bottom, so the sun,
 *    moon and cloud banks read while the numbers stay on solid ground.
 *  - Temperature dominates. It is the one thing people come for, so it gets the
 *    display size and everything else steps back a tier.
 *  - Bands have identity. A coloured accent and a live summary per band mean
 *    you can tell at a glance where you are in a fifteen-card list.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, Wind, Droplets, ArrowUpRight } from 'lucide-react';
import SkyBackdrop from '@/components/location/SkyBackdrop';
import WxIcon from '@/components/location/WxIcon';
import { useUnits } from '@/components/useUnits';

const degToCompass = (deg) => {
  if (deg == null) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
};

/** Each band gets its own accent so the eye can find its place in the list. */
export const BAND_ACCENT = {
  uk: { dot: '#38bdf8', text: 'text-sky-400', ring: 'rgba(56,189,248,0.35)' },
  eu: { dot: '#a78bfa', text: 'text-violet-400', ring: 'rgba(167,139,250,0.35)' },
  world: { dot: '#34d399', text: 'text-emerald-400', ring: 'rgba(52,211,153,0.35)' },
};

/* ── live lightning banner ──────────────────────────────────────────────── */

export function LightningBanner({ stats, live, lastStrikeAt, bands }) {
  // Bars are scaled against the busiest band so the comparison is honest even
  // when the whole planet is quiet. `stats` is null until the first count arrives.
  const peak = Math.max(1, ...bands.map((b) => stats?.[b.id]?.fifteen ?? 0));
  const hot = (stats?.world?.fifteen ?? 0) > 0;
  const num = (v) => (stats ? v.toLocaleString('en-GB') : '–');
  const short = (v) => (v >= 100000 ? `${Math.round(v / 1000)}k` : v.toLocaleString('en-GB'));

  return (
    <Link
      to="/Lightning"
      aria-label="Live lightning worldwide. Open the lightning map."
      /* A glass pane like everything else on the page. It used to be a
         hard-coded slate-900 slab with white text, which is fine in the dark
         and a black brick in the light — it was the one element that did not
         follow the theme. */
      className="lg-pane group relative block mb-6 overflow-hidden
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
    >
      {/* Storm-lit backdrop. Brightens while strikes are landing. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 transition-opacity duration-700"
        style={{
          background:
            /* Storm light only. The opaque base underneath it is gone: the
               pane's own translucency is the surface now, so the same two
               tints read as weather in either theme. */
            'radial-gradient(120% 140% at 8% 0%, rgba(250,204,21,0.16) 0%, rgba(250,204,21,0) 45%),' +
            'radial-gradient(100% 140% at 100% 100%, rgba(129,140,248,0.18) 0%, rgba(129,140,248,0) 50%)',
          opacity: hot ? 1 : 0.82,
        }}
      />

      <div className="relative p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4">
          <span
            className="flex items-center justify-center w-9 h-9 rounded-2xl border flex-shrink-0"
            style={{
              borderColor: hot ? 'rgba(250,204,21,0.45)' : 'rgba(148,163,184,0.25)',
              background: hot ? 'rgba(250,204,21,0.12)' : 'rgba(148,163,184,0.08)',
              boxShadow: hot ? '0 0 22px rgba(250,204,21,0.25)' : 'none',
            }}
          >
            <Zap
              className={`w-[18px] h-[18px] ${hot ? 'text-amber-500 dark:text-yellow-300' : 'text-[color:var(--ink-2)]'}`}
              style={hot ? { filter: 'drop-shadow(0 0 6px rgba(250,204,21,0.7))' } : undefined}
            />
          </span>

          <span className="min-w-0">
            <span className="block text-[13.5px] font-extrabold tracking-tight text-[color:var(--ink-1)] leading-tight">
              Live lightning
            </span>
            <span className="flex items-center gap-2 mt-0.5">
              <span
                className={`inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em]
                            ${live ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}
                />
                {live ? 'Live' : stats ? 'Delayed' : 'Connecting'}
              </span>
              {lastStrikeAt && (
                <span className="text-[10px] text-[color:var(--ink-2)] tabular-nums">
                  last{' '}
                  {lastStrikeAt.toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              )}
            </span>
          </span>

          <span
            className="ml-auto flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider
                       text-[color:var(--ink-2)] group-hover:text-[color:var(--accent-uk)] transition-colors"
          >
            Lightning map
            <ArrowUpRight className="w-3.5 h-3.5" />
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2.5 md:gap-3">
          {bands.map((b) => {
            const s = stats?.[b.id] || { fifteen: 0, hour: 0, today: 0 };
            const accent = BAND_ACCENT[b.id];
            return (
              /* The page's glass, a step up from the pane it sits in. These were black at 25%,
                 which in the light theme made three grey slabs. */
              <div
                key={b.id}
                className="min-w-0 rounded-2xl px-2.5 sm:px-3 py-2.5"
                style={{ background: 'var(--glass-fill-strong)', border: '1px solid var(--glass-hairline)' }}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: accent.dot }}
                  />
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--ink-2)] truncate">
                    {b.label}
                  </span>
                </div>

                {/* On a phone a tile is about 80px wide: "/15 min" wraps under the number, and
                    the hour and today counts stack, with today's six figures shortened. */}
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  <span className="text-[19px] sm:text-[22px] md:text-[26px] font-extrabold tabular-nums leading-none text-[color:var(--ink-1)]">
                    {num(s.fifteen)}
                  </span>
                  <span className="text-[9.5px] font-semibold text-[color:var(--ink-3)]">/15 min</span>
                </div>

                {/* Relative activity — instantly shows where the storms are. */}
                <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--glass-hairline)' }}>
                  <div
                    className="h-full rounded-full transition-[width] duration-700 ease-out"
                    style={{
                      width: `${Math.max(s.fifteen ? 4 : 0, (s.fifteen / peak) * 100)}%`,
                      background: accent.dot,
                      boxShadow: s.fifteen ? `0 0 10px ${accent.ring}` : 'none',
                    }}
                  />
                </div>

                <div className="mt-2 flex flex-col sm:flex-row sm:flex-wrap sm:gap-x-2.5 text-[9.5px] text-[color:var(--ink-3)] tabular-nums">
                  <span>{num(s.hour)} hr</span>
                  <span>
                    <span className="sm:hidden">{stats ? short(s.today) : '–'}</span>
                    <span className="hidden sm:inline">{num(s.today)}</span> today
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Link>
  );
}

/* ── band heading ───────────────────────────────────────────────────────── */

export function BandHeading({ group, cities }) {
  const { fmtTemp } = useUnits();
  const accent = BAND_ACCENT[group.id];

  const summary = useMemo(() => {
    const withTemp = cities.filter((c) => c.current?.temperature_2m != null);
    if (!withTemp.length) return null;
    const sorted = [...withTemp].sort(
      (a, b) => b.current.temperature_2m - a.current.temperature_2m
    );
    return { warm: sorted[0], cold: sorted[sorted.length - 1] };
  }, [cities]);

  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="flex items-center gap-2 flex-shrink-0">
        <span className="w-2 h-2 rounded-full" style={{ background: accent.dot }} />
        <span className="text-[11.5px] font-extrabold uppercase tracking-[0.13em] text-slate-700 dark:text-slate-200">
          {group.label}
        </span>
      </span>

      {summary && (
        <span className="text-[10.5px] text-slate-500 dark:text-[color:var(--ink-2)] truncate">
          warmest {summary.warm.name} {fmtTemp(summary.warm.current.temperature_2m)}
          <span className="mx-1.5 opacity-40">·</span>
          coolest {summary.cold.name} {fmtTemp(summary.cold.current.temperature_2m)}
        </span>
      )}

      <span
        className="flex-1 h-px rounded-full"
        style={{ background: `linear-gradient(90deg, ${accent.ring}, transparent)` }}
      />
    </div>
  );
}

/* ── city card ──────────────────────────────────────────────────────────── */

/* The Location page's live sky inside the card (for this city's weather and the sun's height
   there now) under its Apple-style symbol. UK and Irish cards open the full forecast. */
export function CityCard({ city, index, bandId, isWarmest }) {
  const { fmtTemp, fmtWind } = useUnits();
  const { name, current, localTime, error, cond, day, sun, morning, rate, cloud, desc, href, windy } = city;
  const accent = BAND_ACCENT[bandId];
  const Shell = href ? Link : 'div';
  const shellProps = href
    ? { to: href, 'aria-label': `${name}, ${desc || 'loading'}. Open the full forecast.` }
    : { role: 'group', 'aria-label': `${name}${desc ? `, ${desc}` : ''}` };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay: (index % 5) * 0.05 }}
    >
      <Shell
        {...shellProps}
        className={`group relative block h-52 rounded-3xl overflow-hidden
                   ring-1 ring-white/10 shadow-[0_6px_20px_rgba(2,6,23,0.28)]
                   transition-all duration-300
                   ${href ? 'hover:ring-white/25 hover:shadow-[0_14px_36px_rgba(2,6,23,0.45)] hover:-translate-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400' : ''}`}
      >
        {/* the sky, drifting very slightly closer on hover */}
        <div className="absolute inset-0 transition-transform duration-[900ms] ease-out group-hover:scale-[1.06]" aria-hidden="true">
          <SkyBackdrop contained cond={cond || 'cloudy'} sun={sun ?? 30} morning={morning}
            wind={current?.wind_speed_10m ?? 8} wdir={current?.wind_direction_10m ?? 240} rate={rate ?? 0} cloud={cloud ?? 60} />
        </div>

        {/* Bottom-weighted scrim: the sky stays visible up top, the numbers get
            solid ground underneath. A flat wash made every card look the same. */}
        <div
          className="absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              'linear-gradient(to top, rgba(2,6,23,0.88) 0%, rgba(2,6,23,0.62) 28%, rgba(2,6,23,0.16) 56%, rgba(2,6,23,0) 100%)',
          }}
        />

        <div className="relative h-full p-3.5 flex flex-col justify-between text-white">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 flex flex-col gap-1">
              <span className="text-[13.5px] font-extrabold tracking-tight drop-shadow truncate">{name}</span>
              <span className="flex items-center gap-1.5">
                {localTime && (
                  <span className="rounded-full bg-black/25 px-1.5 py-[1px] text-[9.5px] font-semibold tabular-nums text-white/85 backdrop-blur-sm">
                    {localTime}
                  </span>
                )}
                {isWarmest && (
                  <span
                    className="flex-shrink-0 rounded-full px-1.5 py-[1px] text-[8.5px] font-extrabold uppercase tracking-wider"
                    style={{ background: 'rgba(250,204,21,0.22)', color: '#fde047' }}
                    title="Warmest in this group"
                  >
                    Warmest
                  </span>
                )}
              </span>
            </span>
            {cond && <WxIcon cond={cond} day={day} windy={windy} size={42} style={{ flex: 'none', marginTop: -4, marginRight: -4, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.35))' }} />}
          </div>

          {error && !current ? (
            <span className="text-[11px] text-white/70">Unavailable</span>
          ) : !current ? (
            <span className="text-[11px] text-white/70">Loading…</span>
          ) : (
            <div>
              <span className="block text-[2.6rem] leading-[0.85] font-black tabular-nums tracking-tight drop-shadow-lg">
                {fmtTemp(current.temperature_2m)}
              </span>

              <div className="mt-1.5 text-[11.5px] font-semibold text-white/90 drop-shadow truncate">
                {desc}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-white/80">
                <span className="rounded-md bg-white/10 px-1.5 py-[2px] backdrop-blur-sm">
                  Feels {fmtTemp(current.apparent_temperature)}
                </span>
                {current.wind_speed_10m != null && (
                  <span className="flex items-center gap-1">
                    <Wind className="w-3 h-3 opacity-70" />
                    {degToCompass(current.wind_direction_10m)} {fmtWind(current.wind_speed_10m)}
                  </span>
                )}
                {current.relative_humidity_2m != null && (
                  <span className="flex items-center gap-1">
                    <Droplets className="w-3 h-3 opacity-70" />
                    {Math.round(current.relative_humidity_2m)}%
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Band accent — a hairline that ties the card to its group heading. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[3px] opacity-70 group-hover:opacity-100 transition-opacity"
          style={{ background: `linear-gradient(90deg, transparent, ${accent.dot}, transparent)` }}
        />
      </Shell>
    </motion.div>
  );
}
