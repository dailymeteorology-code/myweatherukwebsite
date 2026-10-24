/* Met Office warnings in force over the searched town (and the admin's own, e.g. wildfire).
 *
 * Sits directly above the forecast: a warning is the single most important thing on the page, so
 * it goes before the detail rather than after it. Each one is a card in its severity's colour:
 * the type's own symbol, the severity, when it runs, and a live line saying whether it is in force
 * now or how long until it starts. Tapped, it opens the Met Office's own wording — the headline,
 * what to expect, the full text — and a link to the Met Office.
 *
 * The same warnings also run along the hourly forecast as bars over the hours they cover
 * (LocationForecast.jsx); tapping one of those opens the matching card here (`openId`).
 */
import React, { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { warningSymbol } from '@/components/warnings/WarningSymbols';
import { AnimatePresence, motion } from 'framer-motion';

/* the type's symbol (MyWeatherUK's own, warnings/WarningSymbols): the same one the bar on the hourly forecast carries */
export const warningIcon = (type) => warningSymbol(type);

/* Text on the severity colour. Dark on yellow and amber (white on orange is barely 3:1), white on
   red, which is a shade deeper than the map's red for the same reason. */
export const SEVERITY_INK = { Yellow: '#2a2000', Amber: '#2b1200', Red: '#ffffff' };
export const SEVERITY_FILL = { Yellow: '#facc15', Amber: '#f97316', Red: '#dc2626' };
export const severityFill = (s) => SEVERITY_FILL[s] || SEVERITY_FILL.Yellow;
export const severityInk = (s) => SEVERITY_INK[s] || SEVERITY_INK.Yellow;

export const warningName = (w) => `${w.severity} warning of ${String(w.type).toLowerCase()}`;

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const HM = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const dayOf = (ms) => DAY.format(new Date(ms));

/** "Fri 23 Oct, 10:00 – 21:00", or "Fri 23 Oct, 18:00 – Sat 24 Oct, 06:00" across midnight. */
export function warningSpan(w) {
  if (!w.startMs || !w.endMs) return '';
  const a = dayOf(w.startMs), b = dayOf(w.endMs - 1);
  return a === b
    ? `${a}, ${HM.format(new Date(w.startMs))} – ${HM.format(new Date(w.endMs))}`
    : `${a}, ${HM.format(new Date(w.startMs))} – ${dayOf(w.endMs)}, ${HM.format(new Date(w.endMs))}`;
}

const inWords = (ms) => {
  const min = Math.max(1, Math.round(ms / 60e3));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
};

/** Where the warning stands now: { live, text }. */
export function warningStatus(w, now = Date.now()) {
  if (w.startMs && now < w.startMs) return { live: false, text: `Starts in ${inWords(w.startMs - now)}` };
  if (w.endMs && now < w.endMs) return { live: true, text: `In force now · ends in ${inWords(w.endMs - now)}` };
  return { live: false, text: 'Ended' };
}

const MET_OFFICE = 'https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings';

function WarningCard({ warning: w, open, onToggle, now }) {
  const fill = severityFill(w.severity), ink = severityInk(w.severity);
  const Icon = warningIcon(w.type);
  const status = warningStatus(w, now);
  return (
    <div id={`lw-warn-${w.id}`} className="lw-warn" style={{
      background: `linear-gradient(105deg, ${rgba(fill, 0.34)}, ${rgba(fill, 0.1)} 70%)`,
      borderColor: rgba(fill, 0.6),
      boxShadow: `inset 4px 0 0 ${fill}`,
    }}>
      <button type="button" className="lw-warn-head" onClick={onToggle} aria-expanded={open}>
        <span className="lw-warn-icon" style={{ background: fill, color: ink }}><Icon size={22} strokeWidth={2.2} /></span>
        <span className="lw-warn-text">
          <span className="lw-warn-top">
            <b className="lw-warn-badge" style={{ background: fill, color: ink }}>{w.severity}</b>
            <span className="lw-warn-type">{`${w.type} warning`}</span>
          </span>
          <span className="lw-warn-when">{warningSpan(w)}</span>
          <span className={`lw-warn-status${status.live ? ' is-live' : ''}`}>
            <i style={{ background: status.live ? fill : 'rgba(255,255,255,0.7)' }} />{status.text}
          </span>
        </span>
        <ChevronDown className="lw-warn-chev" size={18} style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}>
            <div className="lw-warn-body" style={{ borderTopColor: rgba(fill, 0.35) }}>
              {w.headline && <p className="lw-warn-headline">{w.headline}</p>}
              {w.whatToExpect.length > 0 && (
                <>
                  <div className="lw-warn-label">What to expect</div>
                  <ul className="lw-warn-list">
                    {w.whatToExpect.map((b, i) => <li key={i}><i style={{ background: fill }} />{b}</li>)}
                  </ul>
                </>
              )}
              {w.description && (
                <>
                  {w.whatToExpect.length > 0 && <div className="lw-warn-label">Further details</div>}
                  <p className="lw-warn-desc">{w.description}</p>
                </>
              )}
              <div className="lw-warn-foot">
                {w.isManual
                  ? <span>Issued by MyWeatherUK</span>
                  : <a href={MET_OFFICE} target="_blank" rel="noopener noreferrer">Met Office warnings<ExternalLink size={12} /></a>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function LocationWarnings({ warnings = [], openId = null, onToggle }) {
  /* the status lines count down, so the cards re-read the clock every minute */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60e3);
    return () => clearInterval(id);
  }, []);
  if (!warnings.length) return null;
  return (
    <div className="lw-warns">
      {warnings.map((w) => (
        <WarningCard key={w.id} warning={w} now={now} open={openId === w.id} onToggle={() => onToggle?.(openId === w.id ? null : w.id)} />
      ))}
    </div>
  );
}
