/* Story mode (Location Weather, 16 Nov 2026, Phase F): the forecast as full-screen cards, one after
   another, over the page's own live sky, which turns to each card's time (the sky of tonight behind
   "Tonight"). Now → the next hour → today → tonight → tomorrow → the weekend (src/lib/location/story.js).

   A tap on the right goes on, on the left goes back; a swipe does the same, a swipe down closes, and a
   finger held down pauses. Each card moves on by itself after a few seconds, unless the reader has asked
   for less motion. The arrow keys and Escape work too. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, RotateCcw, Share2, Wind, Umbrella, Thermometer } from 'lucide-react';
import WxIcon from '@/components/location/WxIcon';
import { useUnits } from '@/components/useUnits';
import { storyCards } from '@/lib/location/story';
import { condLabel, compass, hhmm, PRECIP_KINDS } from '@/lib/ukvLocation';

const DUR = 7500;                                  // ms a card stays before the next
const barH = (r) => (r < 0.1 ? 3 : Math.min(100, 18 + Math.sqrt(r) * 28));

export default function StoryMode({ model, onSky, onClose, onShare }) {
  const U = useUnits();
  const deg = (c) => (c == null ? '—' : `${Math.round(U.temp(c))}°`);
  const cards = useMemo(() => storyCards(model, U), [model, U]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const reduce = useMemo(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const card = cards[Math.min(i, cards.length - 1)];
  const last = i >= cards.length - 1;
  const rootRef = useRef(null);

  const next = useCallback(() => setI((k) => Math.min(cards.length - 1, k + 1)), [cards.length]);
  const prev = useCallback(() => setI((k) => Math.max(0, k - 1)), []);

  /* the sky behind follows the card's time */
  useEffect(() => { onSky(card?.t ?? null); }, [card?.key, card?.t, onSky]);

  /* the page under it stays put; the keys; a hidden tab pauses; focus comes back where it was */
  useEffect(() => {
    const before = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    rootRef.current?.focus();
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    const vis = () => setHidden(document.hidden);
    document.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', vis);
      before?.focus?.();
    };
  }, [onClose, next, prev]);

  /* taps, swipes and holds */
  const press = useRef(null);
  const down = (e) => {
    if (e.target.closest('button')) return;
    press.current = { x: e.clientX, y: e.clientY, at: Date.now() };
    setPaused(true);
  };
  const up = (e) => {
    const p = press.current;
    press.current = null;
    setPaused(false);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (dy > 90 && dy > Math.abs(dx)) { onClose(); return; }
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) next(); else prev(); return; }
    if (Date.now() - p.at < 350 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const w = rootRef.current?.clientWidth || window.innerWidth;
      if (e.clientX < w / 3) prev(); else next();
    }
  };
  const stop = (e) => e.stopPropagation();            // the site's pull-to-refresh never sees these touches

  if (!card) return null;
  const running = !paused && !hidden && !reduce && !last;
  return (
    <div ref={rootRef} className="lw-story" role="dialog" aria-modal="true" aria-label={`${model.location.name}: the forecast, card by card`} tabIndex={-1}
      onPointerDown={down} onPointerUp={up} onPointerCancel={() => { press.current = null; setPaused(false); }}
      onTouchStart={stop} onTouchMove={stop}>
      <div className="lw-story-col">
        <div className="lw-story-bars" aria-hidden="true">
          {cards.map((c, k) => (
            <span key={c.key} className="lw-story-seg">
              <i key={k === i ? `on${i}` : 'off'}
                className={k < i || (k === i && (reduce || last)) ? 'is-done' : k === i ? 'is-on' : ''}
                style={k === i && !reduce && !last ? { animationDuration: `${DUR}ms`, animationPlayState: running ? 'running' : 'paused' } : undefined}
                onAnimationEnd={k === i ? next : undefined} />
            </span>
          ))}
        </div>
        <div className="lw-story-top">
          <span className="lw-story-place" translate="no">{model.location.name}</span>
          <button type="button" className="lw-story-x" onClick={onClose} aria-label="Close"><X size={22} /></button>
        </div>

        <div key={card.key} className="lw-story-card" aria-live="polite">
          <div className="lw-story-label">{card.label}</div>

          {card.key === 'now' && (
            <div className="lw-story-hero">
              <WxIcon cond={card.cond} day={card.isDay} windy={card.windy} size={112} />
              <div className="lw-story-temp">{deg(card.temp)}</div>
              <div className="lw-story-cond">{condLabel(card.cond, card.isDay, card.windy)}</div>
              <div className="lw-story-sub">Feels like {deg(card.feels)}{card.hi != null ? ` · H:${deg(card.hi)} L:${deg(card.lo)}` : ''}</div>
              {card.wind != null && (
                <div className="lw-story-chips">
                  <span><Wind size={15} />{U.fmtWind(card.wind)}{card.wdir != null ? ` from the ${compass(card.wdir)}` : ''}{(card.gust ?? 0) >= 25 ? `, gusts ${U.fmtWind(card.gust)}` : ''}</span>
                </div>
              )}
            </div>
          )}

          {card.key === 'next' && card.mins && (
            <>
              <p className="lw-story-text">{card.text}</p>
              <div className="lw-story-mins" role="img" aria-label={card.text}>
                {card.mins.map((m) => {
                  const k = PRECIP_KINDS[m.kind] || PRECIP_KINDS.rain;
                  return <i key={m.t} style={{ height: `${barH(m.rate)}%`, ...(m.rate >= 0.1 ? { background: `linear-gradient(180deg, ${k.top}, ${k.bottom})`, opacity: 0.45 + 0.55 * (m.chance / 100) } : {}) }} />;
                })}
              </div>
              <div className="lw-story-axis"><span>Now</span><span>{hhmm(card.mins[30]?.t)}</span><span>{hhmm(card.mins[card.mins.length - 1]?.t)}</span></div>
            </>
          )}

          {card.key === 'next' && card.hours && (
            <>
              <p className="lw-story-text">{card.text}</p>
              <div className="lw-story-hours">
                {card.hours.map((h) => (
                  <div key={h.t}>
                    <span>{hhmm(h.t)}</span>
                    <WxIcon cond={h.cond} day={h.isDay} windy={h.windy} size={38} />
                    <b>{deg(h.temp)}</b>
                    <small>{h.pRain != null && h.pRain >= 10 ? `${Math.round(h.pRain / 10) * 10}%` : ' '}</small>
                  </div>
                ))}
              </div>
            </>
          )}

          {['today', 'tonight', 'tomorrow'].includes(card.key) && (
            <>
              <div className="lw-story-part">
                <WxIcon cond={card.cond} day={card.isDay} windy={card.windy} size={92} />
                {/* the high or the low; the words below say the weather (a label here could disagree with them) */}
                <div className="lw-story-big">{card.key === 'tonight' ? <><small>Low</small>{deg(card.lo)}</> : <><small>High</small>{deg(card.hi)}</>}</div>
              </div>
              <p className="lw-story-text">{card.text}</p>
              <div className="lw-story-chips">
                {(card.pRain ?? 0) >= 10 && <span><Umbrella size={15} />{Math.round(card.pRain / 10) * 10}% chance of rain</span>}
                {(card.gust ?? 0) >= 30 && <span><Wind size={15} />Gusts {U.fmtWind(card.gust)}</span>}
                {card.key === 'tonight' && card.feelsLo != null && card.feelsLo <= (card.lo ?? 99) - 2 && <span><Thermometer size={15} />Feels like {deg(card.feelsLo)}</span>}
              </div>
            </>
          )}

          {card.days && (
            <div className="lw-story-days">
              {card.days.map((d) => (
                <div key={d.day} className="lw-story-day">
                  <div><b>{d.label}</b><small>{d.date}</small></div>
                  <WxIcon cond={d.cond} day windy={d.windy} size={46} />
                  <span className="lw-story-words">{d.words}{d.pRain >= 30 ? ` · ${Math.round(d.pRain / 10) * 10}% chance of rain` : ''}</span>
                  <span className="lw-story-range"><b>{deg(d.hi)}</b> {deg(d.lo)}</span>
                </div>
              ))}
            </div>
          )}

          {last && (
            <div className="lw-story-end">
              <button type="button" onClick={() => setI(0)}><RotateCcw size={16} />Watch again</button>
              {onShare && <button type="button" onClick={onShare}><Share2 size={16} />Share as a picture</button>}
              <button type="button" onClick={onClose}><X size={16} />Close</button>
            </div>
          )}
        </div>

        {i === 0 && <p className="lw-story-hint" aria-hidden="true">Tap to go on · swipe down to close</p>}
      </div>
    </div>
  );
}
