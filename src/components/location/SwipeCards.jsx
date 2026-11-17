/* Cards in one place, swiped left and right (Location Weather, 17 Nov 2026, the user: "the thunderstorm, snow risk
   and the night sky forecast and the two weeks ahead on 1 card which is scrollable from left to right and right to
   left"). Each child is a page the width of the card; a page whose card has nothing to say takes no room and gets
   no dot. The box takes the height of the page on show, so a short page leaves no gap under it. A page's own id
   (ids: one per child, or null) lets a link or a "matters today" chip bring it into view, sideways too. */
import React, { useCallback, useEffect, useRef, useState } from 'react';

export default function SwipeCards({ children, ids = [], label }) {
  const ref = useRef(null);
  const [pages, setPages] = useState([]);            // the page elements with something in them
  const [at, setAt] = useState(0);
  const [height, setHeight] = useState(null);

  /* which pages have a card in them (cards come and go as their data arrive) */
  const recount = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const full = [...el.children].filter((p) => p.childElementCount > 0);
    setPages((old) => (old.length === full.length && old.every((p, i) => p === full[i]) ? old : full));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    recount();
    const mo = new MutationObserver(recount);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [recount]);

  /* the page on show: the one nearest the left edge of the box */
  const onScroll = () => {
    const el = ref.current;
    if (!el || !pages.length) return;
    let best = 0;
    pages.forEach((p, i) => { if (Math.abs(p.offsetLeft - el.scrollLeft) < Math.abs(pages[best].offsetLeft - el.scrollLeft)) best = i; });
    setAt(best);
  };
  /* the box as tall as the page on show, following it as it grows or shrinks */
  useEffect(() => {
    const p = pages[Math.min(at, pages.length - 1)];
    if (!p) { setHeight(null); return undefined; }
    const fit = () => setHeight(p.offsetHeight);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(p);
    return () => ro.disconnect();
  }, [pages, at]);

  const go = (i) => {
    const el = ref.current, p = pages[i];
    if (el && p) el.scrollTo({ left: p.offsetLeft, behavior: 'smooth' });
  };

  return (
    <div className="lw-swipe-wrap">
      <div ref={ref} className="lw-swipe" onScroll={onScroll} role="group" aria-roledescription="carousel" aria-label={label}
        style={height ? { height } : undefined}>
        {React.Children.map(children, (child, i) => (
          <div className="lw-swipe-page" id={ids[i] || undefined}>{child}</div>
        ))}
      </div>
      {pages.length > 1 && (
        <div className="lw-swipe-dots" role="tablist" aria-label={label}>
          {pages.map((p, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === at} aria-label={`Card ${i + 1} of ${pages.length}`}
              className={i === at ? 'is-on' : undefined} onClick={() => go(i)} />
          ))}
        </div>
      )}
    </div>
  );
}
