/* Location search with type-ahead.

   Suggestions come from this site's own place search (server/placeSearch.js): a few letters
   are enough ("duns" offers Dunstable), any case, typos forgiven, postcodes too. Requests are
   debounced, and each keystroke aborts the one before, so a slow answer never replaces a newer one.

   The list opens as a liquid-glass panel drawn over the page (a portal on <body>): inside the
   page's glass top bar a panel could only blur the bar itself, not what lies behind it.

   Picking a suggestion passes its COORDINATES up, not its text: there are seven villages
   called Dunston, and resolving the winner by name afterwards would be a coin toss. */
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Loader2, X, Building2, MapPin, House, Trees, Mail } from 'lucide-react';

const DEBOUNCE_MS = 160;
const KIND = { city: ['City', Building2], town: ['Town', MapPin], village: ['Village', House], hamlet: ['Hamlet', Trees], suburb: ['Area', MapPin], postcode: ['Postcode', Mail] };

/* the name with what was typed in bold (wherever it matches: the start, or the start of a word) */
function Highlight({ name, q }) {
  const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return name;
  return <>{name.slice(0, i)}<b>{name.slice(i, i + q.length)}</b>{name.slice(i + q.length)}</>;
}

export default function LocationSearchBox({ value, onChange, onSearch, loading = false, autoFocus = false, size = 'normal' }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState('');
  const [cursor, setCursor] = useState(-1);
  const [rect, setRect] = useState(null);

  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const abortRef = useRef(null);
  // set when a suggestion is chosen, so the resulting value change does not reopen the list
  const skipRef = useRef(false);

  useEffect(() => {
    if (skipRef.current) { skipRef.current = false; setOpen(false); return undefined; }
    const q = (value || '').trim();
    if (q.length < 2) { setSuggestions([]); setBusy(false); setOpen(false); return undefined; }
    setBusy(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      let hits = [];
      try {
        const r = await fetch(`/api/location/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
        hits = r.ok ? (await r.json()).results || [] : [];
      } catch { if (ac.signal.aborted) return; }
      if (ac.signal.aborted) return;
      setSuggestions(hits);
      setSearched(q);
      setCursor(-1);
      setBusy(false);
      // only while someone is typing here: a name filled in by a link must not pop the list open
      setOpen(document.activeElement === inputRef.current);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* the panel sits under the search (under the whole top bar when it is in one), kept in place
     while the page scrolls or resizes */
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const a = (boxRef.current?.closest('.lw-bar') || boxRef.current)?.getBoundingClientRect();
      if (a) setRect({ left: a.left, top: a.bottom + 8, width: a.width });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);

  // close when a click lands outside both the box and the panel
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = useCallback((s) => {
    skipRef.current = true;
    onChange(s.name);
    setOpen(false);
    setSuggestions([]);
    onSearch({ name: s.name, region: s.region, lat: s.lat, lon: s.lon });
  }, [onChange, onSearch]);

  const onKeyDown = (e) => {
    if (!open || !suggestions.length) {
      if (e.key === 'Enter') { e.preventDefault(); setOpen(false); onSearch({ name: (value || '').trim() }); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + suggestions.length) % suggestions.length); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(suggestions[cursor >= 0 ? cursor : 0]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const big = size === 'large';
  const bar = size === 'bar';           // inside the page's glass top bar: no box of its own
  const empty = open && !busy && searched.length >= 2 && !suggestions.length;

  return (
    <div ref={boxRef} className={`lw-searchbox${big ? ' is-large' : ''}${bar ? ' is-bar' : ''}`}>
      <Search className="lw-searchbox-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length && setOpen(true)}
        placeholder="Search a town, city or postcode"
        aria-label="Search for a place in the UK or Ireland"
        aria-autocomplete="list"
        aria-expanded={open}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {(busy || loading) && <Loader2 className="lw-searchbox-end animate-spin" aria-hidden="true" />}
      {!busy && !loading && value && (
        <button type="button" className="lw-searchbox-end lw-searchbox-clear" aria-label="Clear search"
          onClick={() => { onChange(''); setSuggestions([]); setOpen(false); inputRef.current?.focus(); }}>
          <X />
        </button>
      )}

      {(open && (suggestions.length > 0 || empty)) && rect && createPortal(
        <div ref={listRef} className="lw-suggest" style={{ left: rect.left, top: rect.top, width: rect.width }}>
          {empty ? (
            <div className="lw-suggest-empty">No places match &ldquo;{searched}&rdquo;. Try a nearby town or a postcode.</div>
          ) : (
            <ul role="listbox" aria-label="Places">
              {suggestions.map((s, i) => {
                const [kindLabel, Icon] = KIND[s.kind] || KIND.town;
                return (
                  <li key={`${s.name}|${s.lat}|${s.lon}`} role="option" aria-selected={i === cursor}>
                    <button type="button" className="lw-suggest-item" onMouseEnter={() => setCursor(i)} onClick={() => choose(s)}>
                      <span className="lw-suggest-ico"><Icon /></span>
                      <span className="lw-suggest-text">
                        <span className="lw-suggest-name"><Highlight name={s.name} q={searched} /></span>
                        {s.region && <span className="lw-suggest-region">{s.region}</span>}
                      </span>
                      <span className="lw-suggest-kind">{kindLabel}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="lw-suggest-foot">Places © OpenStreetMap contributors · Ordnance Survey via postcodes.io</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
