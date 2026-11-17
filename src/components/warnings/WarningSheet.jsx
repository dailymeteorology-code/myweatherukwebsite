/* One warning, in full, on the Warnings tab's map (17 Nov 2026, at the user's request): "the warning matrix up
   top on the left, then the valid dates and times with a cool line thing, then the small description, then the
   full description with the expected impacts bullet points, then the issued time and day and, if it was
   updated, what time and day, and below that a list of impacted locations". Whether the Met Office has updated
   it is said at the top, in so many words, and what it changed. The look is in warnings-screen.css. */
import React from 'react';
import { X, AlertTriangle, Check, RefreshCw, Clock3, MapPin } from 'lucide-react';
import { LIKELIHOOD, IMPACT, SEV_HEX, sevInkOn, groupAreas } from '@/components/warnings/MetOfficeWarning';
import { phaseOf, isUpdated, updatedAt } from '@/components/warnings/warningState';
import { ukZone } from '@/lib/ukZone';

const TZ = 'Europe/London';
/* each takes a Date or ms */
const D = (v) => (v instanceof Date ? v : new Date(v));
const hm = (d) => D(d).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayShort = (d) => D(d).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const dayLong = (d) => D(d).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const dayTiny = (d) => D(d).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric' });   // Tue 17
const asDate = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

/* "15 h", "1 day 6 h" */
function spanText(ms) {
  const h = Math.round(ms / 36e5);
  if (!Number.isFinite(h) || h <= 0) return '';
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24), r = h % 24;
  return `${d} day${d === 1 ? '' : 's'}${r ? ` ${r} h` : ''}`;
}
/* "40 min", "3 h 20 min", "2 days" */
function untilText(ms) {
  const min = Math.max(1, Math.round(ms / 6e4));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return `${h} h${m ? ` ${m} min` : ''}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/* The Met Office's impact matrix, small: likelihood up, impact across, its own colours, the warning's square ticked */
const CELL = { G: '#c5e510', Y: '#ffe629', A: '#ff9b00', R: '#d1063b' };
const GRID = { 4: ['G', 'Y', 'A', 'R'], 3: ['G', 'Y', 'A', 'A'], 2: ['G', 'G', 'Y', 'A'], 1: ['G', 'G', 'Y', 'Y'] };
function MatrixMini({ likelihood, impact }) {
  const L = Number(likelihood), I = Number(impact);
  const has = L >= 1 && L <= 4 && I >= 1 && I <= 4;
  return (
    <figure className="ws-matrix" aria-label={has ? `Impact matrix: ${LIKELIHOOD[L][0]} likelihood, ${IMPACT[I].toLowerCase()} impact` : 'Impact matrix: not published for this warning'}>
      <div className="ws-mx">
        <span className="ws-mx-y" aria-hidden="true">Likelihood</span>
        <div className="ws-mx-grid" aria-hidden="true">
          {[4, 3, 2, 1].map((l) => [1, 2, 3, 4].map((i) => {
            const on = has && l === L && i === I;
            return <i key={`${l}${i}`} className={on ? 'is-on' : ''} style={{ background: CELL[GRID[l][i - 1]] }}>{on && <Check strokeWidth={3.2} />}</i>;
          }))}
        </div>
        <span className="ws-mx-x" aria-hidden="true">Impact</span>
      </div>
      <figcaption>
        {has
          ? <><b>{LIKELIHOOD[L][0]}</b> likelihood<br /><b>{IMPACT[I]}</b> impact</>
          : 'No likelihood or impact given'}
      </figcaption>
    </figure>
  );
}

/* From and until: two dots in the warning's colour joined by a plain line (17 Nov 2026, at the user's request: "no
   glow effect, and connect the two dots"), how long it lasts beside the line */
function ValidLine({ from, to, now, hex }) {
  const phase = now < from ? 'upcoming' : now >= to ? 'ended' : 'inforce';
  const status = phase === 'upcoming' ? `Starts in ${untilText(from - now)}`
    : phase === 'inforce' ? `In force · ends in ${untilText(to - now)}` : 'Ended';
  return (
    <div className="ws-valid" style={{ '--ws-sev': hex }}>
      <div className="ws-v-grid">
        <div className="ws-v-track" aria-hidden="true"><i /><span /><i /></div>
        <div className="ws-v-texts">
          <div className="ws-v-when"><small>From</small><b>{hm(from)}</b><span>{dayTiny(from)}</span></div>
          <em className="ws-v-dur">{spanText(to - from)}</em>
          <div className="ws-v-when"><small>Until</small><b>{hm(to)}</b><span>{dayTiny(to)}</span></div>
        </div>
      </div>
      <p className="ws-v-status">{status}</p>
      <p className="ws-v-zone">Times in {ukZone(from)}</p>
    </div>
  );
}

/* `actions`: buttons for the head before the close button (the map's "Save picture"); `now`: ms */
export default function WarningSheet({ warning: w, onClose, actions = null, now = Date.now() }) {
  const sev = w.severity || 'Yellow';
  const hex = SEV_HEX[sev] || SEV_HEX.Yellow;
  const from = asDate(w.validFrom), to = asDate(w.validTo);
  const phase = phaseOf(w, now);
  const updated = isUpdated(w);
  const changedAt = updatedAt(w);
  const issued = asDate(w.issuedDate);
  /* our own warnings list their areas as plain names */
  const groups = groupAreas(w).map((g) => (typeof g === 'string' ? { region: g, authorities: [] } : g)).filter((g) => g?.region);
  const expect = Array.isArray(w.whatToExpect) ? w.whatToExpect.filter(Boolean) : [];
  const full = String(w.furtherDetails || '').split(/\n+/).map((t) => t.trim()).filter(Boolean);
  /* our own warnings: their text is in `impacts` and their areas are plain names */
  const ownText = !full.length && !expect.length && w.impacts && w.impacts !== w.description ? [String(w.impacts)] : [];
  const version = parseFloat(w.warningVersion);
  return (
    <div className="ws" style={{ '--ws-sev': hex }}>
      <header className="ws-head">
        <span className="ws-badge" style={{ background: hex, color: sevInkOn(sev) }}>
          <AlertTriangle fill="currentColor" fillOpacity={0.18} strokeWidth={2.2} />
        </span>
        <div className="ws-title">
          <b>{sev} warning</b>
          <span>{w.type || 'Weather'}{w.isManual ? ' · MyWeatherUK' : ''}</span>
        </div>
        {actions}
        {onClose && <button type="button" className="wm-btn wm-icon" onClick={onClose} aria-label="Close this warning"><X /></button>}
      </header>
      {/* where it stands, plainly: in force or upcoming, and updated or not */}
      <div className="ws-pills">
        <span className={`ws-pill is-${phase}`}>{phase === 'inforce' ? 'In force' : phase === 'upcoming' ? 'Upcoming' : 'Ended'}</span>
        {updated
          ? <span className="ws-pill is-upd"><RefreshCw />Updated{changedAt ? ` ${hm(changedAt)} ${dayShort(changedAt)}` : ''}</span>
          : !w.isManual && <span className="ws-pill">Not updated since issued</span>}
      </div>

      <div className="ws-scroll">
        <div className="ws-top">
          <MatrixMini likelihood={w.likelihood} impact={w.impactLevel} />
          {from && to
            ? <ValidLine from={from.getTime()} to={to.getTime()} now={now} hex={hex} />
            : <p className="ws-soft">No times given.</p>}
        </div>

        {w.description && <p className="ws-headline">{w.description}</p>}

        {(full.length > 0 || expect.length > 0 || ownText.length > 0) && (
          <section className="ws-sec">
            <h3>What to expect</h3>
            {[...full, ...ownText].map((t, i) => <p key={i} className="ws-text">{t}</p>)}
            {expect.length > 0 && <ul className="ws-list">{expect.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          </section>
        )}

        {(issued || changedAt) && (
          <section className="ws-sec">
            <h3>Issued{updated ? ' and updated' : ''}</h3>
            <div className="ws-when">
              {issued && (
                <div className="ws-when-row">
                  <Clock3 aria-hidden="true" />
                  <span>{updated ? 'First issued' : 'Issued'}</span>
                  <b>{hm(issued)} {ukZone(issued)}, {dayLong(issued)}</b>
                </div>
              )}
              {changedAt && (
                <div className="ws-when-row is-upd">
                  <RefreshCw aria-hidden="true" />
                  <span>Updated{Number.isFinite(version) && version > 1 ? ` (version ${Math.round(version)})` : ''}</span>
                  <b>{hm(changedAt)} {ukZone(changedAt)}, {dayLong(changedAt)}</b>
                </div>
              )}
            </div>
            {updated && w.updateDescription && <p className="ws-changed"><b>What changed</b>{w.updateDescription}</p>}
            {!updated && !w.isManual && <p className="ws-soft">The Met Office has not changed this warning since it was issued.</p>}
          </section>
        )}

        {groups.length > 0 && (
          <section className="ws-sec">
            <h3>Areas affected</h3>
            {groups.map((g) => (
              <div key={g.region} className="ws-region">
                <b><MapPin aria-hidden="true" />{g.region}</b>
                {g.authorities.length > 0 && <div className="ws-chips">{g.authorities.map((a) => <span key={a}>{a}</span>)}</div>}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
