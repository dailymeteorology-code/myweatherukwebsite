/* The hour sheet (Location Weather, 15 Nov 2026): everything the forecast has for one hour, opened by
   tapping an hour on the hourly strip, or by a link to that moment (…&at=2026-11-21T15:00: the sheet's
   "Copy link"). A side sheet on a computer; on a phone a sheet from the bottom, which drags down to
   close like the warning map's (WarningsMapModal.jsx dragSheet). It renders inside .lw-page, whose
   colours it uses, as a fixed layer over the page. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, ChevronLeft, ChevronRight, Link2, Check, Droplets, Wind, Cloud, Eye, Sun, Gauge, Thermometer, Snowflake, Zap, Moon, Mountain, Umbrella,
} from 'lucide-react';
import WxIcon from '@/components/location/WxIcon';
import { useUnits } from '@/components/useUnits';
import {
  condLabel, hhmm, hourOf, ukDay, dayLabel, compass, beaufort, uvWord, visWord, thunderRisk, snowChance, rateOf, PRECIP_KINDS, moonPhase,
  sourceName, fromThisHour,
} from '@/lib/ukvLocation';

/* ── a moment in a link: the UK's own date and clock time, 2026-11-21T15:00 ── */
export const momentParam = (t) => `${ukDay(t)}T${hhmm(t)}`;
export function parseMoment(s) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(s || '');
  if (!m) return null;
  const guess = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`);
  if (!Number.isFinite(guess)) return null;
  const off = (hourOf(guess) - new Date(guess).getUTCHours() + 24) % 24;   // 0 in GMT, 1 in BST
  return guess - off * 36e5;
}
/* the hours the sheet steps through (the strip's: this hour on), and the one nearest a moment */
export const sheetHours = (model) => fromThisHour(model.full);
export function hourFor(model, ms) {
  let best = null;
  for (const h of sheetHours(model)) if (!best || Math.abs(h.t - ms) < Math.abs(best.t - ms)) best = h;
  return best && Math.abs(best.t - ms) <= 3 * 36e5 ? best : null;
}

const PHONE = '(max-width: 640px)';

function Row({ icon: Icon, label, value, sub, children }) {
  return (
    <div className="lw-sh-row">
      <span className="lw-sh-ico"><Icon size={15} /></span>
      <span className="lw-sh-label">{label}</span>
      <span className="lw-sh-val"><span className="lw-sh-v">{children}{value}</span>{sub ? <small>{sub}</small> : null}</span>
    </div>
  );
}

export default function HourSheet({ model, t, onClose, onMove, linkFor }) {
  const U = useUnits();
  const hs = useMemo(() => sheetHours(model), [model]);
  const i = hs.findIndex((h) => h.t === t);
  const h = i >= 0 ? hs[i] : hourFor(model, t);
  const [copied, setCopied] = useState(false);
  const sheetRef = useRef(null);
  const dragRef = useRef(null);

  /* Escape closes it; the arrow keys step through the hours */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && i > 0) onMove(hs[i - 1].t);
      else if (e.key === 'ArrowRight' && i >= 0 && i < hs.length - 1) onMove(hs[i + 1].t);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, hs, onClose, onMove]);
  useEffect(() => setCopied(false), [t]);
  if (!h) return null;

  /* the first hour is now: what the hero and the strip show for it (the analysis and the radar) */
  const isNow = h === hs[0];
  const x = isNow ? model.now : h;
  const deg = (c) => (c == null ? '—' : `${Math.round(U.temp(c))}${U.tempUnit}`);
  const rate = rateOf(x);
  const falling = rate >= 0.1 || (x.precip ?? 0) >= 0.1;
  const kind = PRECIP_KINDS[x.kind] || PRECIP_KINDS.rain;
  const sc = snowChance(x.snowCond);
  const ts = x.nova ? thunderRisk(x.nova.p) : null;
  const bf = beaufort(x.wind);
  const moon = moonPhase(h.t);
  const when = isNow ? 'Now' : `${dayLabel(h.day)} ${hhmm(h.t)}`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(linkFor(h.t)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };

  /* on a phone: drag the handle or the header down to put the sheet away */
  const settle = (el) => { el.style.transition = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)'; };
  const drag = {
    down: (e) => {
      const el = sheetRef.current;
      if (!el || !window.matchMedia?.(PHONE).matches || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.target.closest('button, a') || !e.target.closest('.lw-sh-grab, .lw-sh-head')) return;
      dragRef.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0 };
      try { el.setPointerCapture(e.pointerId); } catch { /* fine without */ }
      el.style.animation = 'none';
      el.style.transition = 'none';
    },
    move: (e) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.id || !sheetRef.current) return;
      d.dy = Math.max(0, e.clientY - d.y0);
      sheetRef.current.style.transform = `translateY(${d.dy}px)`;
    },
    up: (e) => {
      const d = dragRef.current, el = sheetRef.current;
      if (!d || e.pointerId !== d.id || !el) return;
      dragRef.current = null;
      const speed = d.dy / Math.max(1, performance.now() - d.t0);
      settle(el);
      if (d.dy > Math.min(110, el.offsetHeight * 0.3) || (d.dy > 24 && speed > 0.5)) {
        el.style.transform = `translateY(${el.offsetHeight + 24}px)`;
        setTimeout(onClose, 200);
      } else el.style.transform = '';
    },
    cancel: () => { const el = sheetRef.current; dragRef.current = null; if (el) { settle(el); el.style.transform = ''; } },
  };

  return (
    /* touches stay in the sheet: the site's pull-to-refresh (GlobalPullToRefresh) would take a drag
       down near the top of the page as a reload */
    <div className="lw-sh-wrap" onClick={onClose}
      onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div ref={sheetRef} className="lw-sh lw-glass" role="dialog" aria-modal="true" aria-label={`The forecast for ${when}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={drag.down} onPointerMove={drag.move} onPointerUp={drag.up} onPointerCancel={drag.cancel}>
        <div className="lw-sh-grab" aria-hidden="true"><i /></div>
        <div className="lw-sh-head">
          <WxIcon cond={x.cond} day={x.isDay} windy={x.windy} size={44} title={condLabel(x.cond, x.isDay, x.windy)} />
          <div className="lw-sh-when">
            <b>{when}</b>
            <span>{condLabel(x.cond, x.isDay, x.windy)}</span>
          </div>
          <div className="lw-sh-temp">{deg(x.t2)}<small>Feels {deg(x.feels)}</small></div>
          <button type="button" className="lw-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="lw-sh-nav">
          <button type="button" className="lw-chip" disabled={i <= 0} onClick={() => onMove(hs[i - 1].t)} aria-label="The hour before"><ChevronLeft size={14} />Earlier</button>
          <button type="button" className="lw-chip" onClick={copy} aria-label="Copy a link to this hour">{copied ? <Check size={14} /> : <Link2 size={14} />}{copied ? 'Link copied' : 'Copy link'}</button>
          <button type="button" className="lw-chip" disabled={i < 0 || i >= hs.length - 1} onClick={() => onMove(hs[i + 1].t)} aria-label="The hour after">Later<ChevronRight size={14} /></button>
        </div>
        <div className="lw-sh-body">
          {falling ? (
            <Row icon={Umbrella} label={kind.name} value={U.fmtRate(rate)}
              sub={[x.span > 0 && x.precip != null ? `${U.fmtRain(x.precip, 1)} in ${x.span === 1 ? 'the hour' : `${x.span} hours`}` : null, x.pRain != null ? `chance ${x.pRain}%` : null].filter(Boolean).join(' · ')}>
              <i className="lw-sh-kind" style={{ background: `linear-gradient(180deg, ${kind.top}, ${kind.bottom})` }} />
            </Row>
          ) : (
            <Row icon={Umbrella} label="Rain" value="Dry" sub={x.pRain != null ? `chance ${x.pRain}%` : null} />
          )}
          {sc && <Row icon={Snowflake} label="Snow chance" value={sc.word}><i className="lw-sh-kind" style={{ background: sc.colour }} /></Row>}
          {ts && <Row icon={Zap} label="Thunderstorms" value={`${Math.round(x.nova.p)}%`} sub={`${ts.word} risk · TCM NOVA`} />}
          <Row icon={Wind} label="Wind" value={`${U.fmtWind(x.wind)} ${compass(x.wdir)}`} sub={`gusts ${U.fmtWind(x.gust)} · ${bf.name.toLowerCase()}`}>
            <svg className="lw-sh-arrow" width="14" height="14" viewBox="-5 -5 10 10" style={{ transform: `rotate(${(x.wdir ?? 0) + 180}deg)` }} aria-hidden="true"><path d="M0 -5 L3.5 3 L0 1.4 L-3.5 3Z" fill="currentColor" /></svg>
          </Row>
          {x.tcc != null && (
            <Row icon={Cloud} label="Cloud" value={`${Math.round(x.tcc)}%`}
              sub={[x.lcc != null ? `low ${Math.round(x.lcc)}%` : null, x.mcc != null ? `mid ${Math.round(x.mcc)}%` : null, x.hcc != null ? `high ${Math.round(x.hcc)}%` : null,
                x.cloudBase != null && x.cloudBase < 5000 ? `base ${Math.round(x.cloudBase / 10) * 10} m` : null].filter(Boolean).join(' · ')} />
          )}
          {x.vis != null && <Row icon={Eye} label="Visibility" value={`${x.vis < 10 ? x.vis.toFixed(1) : Math.round(x.vis)} km`} sub={visWord(x.vis)} />}
          {x.isDay && x.uvi != null && <Row icon={Sun} label="UV index" value={Math.round(x.uvi)} sub={uvWord(x.uvi)} />}
          {x.rh != null && <Row icon={Droplets} label="Humidity" value={`${Math.round(x.rh)}%`} sub={x.td != null ? `dew point ${deg(x.td)}` : null} />}
          {x.mslp != null && <Row icon={Gauge} label="Pressure" value={`${Math.round(x.mslp)} hPa`} />}
          {x.freeze != null && (
            <Row icon={Mountain} label="Freezing level" value={x.freeze === 0 ? 'At the ground' : `${Math.round(x.freeze / 10) * 10} m`}
              sub={x.warmAloft ? `milder air above, up to ${Math.round(x.warmAloft / 10) * 10} m` : null} />
          )}
          {x.ground != null && <Row icon={Thermometer} label="Ground" value={deg(x.ground)} sub={x.ground <= 0 ? 'frozen surfaces' : null} />}
          <Row icon={x.sun > 0 ? Sun : Moon} label={x.sun > 0 ? 'Sun' : 'Moon'}
            value={x.sun > 0 ? `${Math.round(x.sun)}° up` : moon.name}
            sub={x.sun > 0 ? null : `${Math.round(moon.lit * 100)}% lit`} />
        </div>
        <p className="lw-sh-src">
          {h.ext ? `${sourceName(h.src)}, every three or six hours from here.` : isNow ? 'Now: the UKV analysed with station reports and the radar.' : 'Met Office UKV 2 km.'}
          {x.span > 1 ? ` Amounts are for the ${x.span} hours to ${hhmm(h.t)}.` : ''}
        </p>
      </div>
    </div>
  );
}
