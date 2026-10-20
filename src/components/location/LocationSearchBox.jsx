/* Location search with type-ahead.
 *
 * Suggestions are debounced and every in-flight request is aborted when the
 * next keystroke lands, so a slow lookup can never overwrite a newer one with
 * stale results.
 *
 * Picking a suggestion passes its COORDINATES up, not its text. Seven UK
 * villages are called Dunston; resolving the winner by name afterwards would be
 * a coin toss.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, MapPin, Loader2, X } from 'lucide-react';
import { searchUkPlaces } from '@/lib/ukPlaces';

const DEBOUNCE_MS = 220;

export default function LocationSearchBox({
  value, onChange, onSearch, loading = false, autoFocus = false, size = 'normal',
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(-1);

  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  // Set when a suggestion is chosen, so the resulting value change does not
  // immediately reopen the dropdown with the name that was just picked.
  const skipRef = useRef(false);

  useEffect(() => {
    if (skipRef.current) { skipRef.current = false; setOpen(false); return undefined; }
    const q = (value || '').trim();
    if (q.length < 2) { setSuggestions([]); setBusy(false); return undefined; }

    setBusy(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const hits = await searchUkPlaces(q, { signal: ac.signal });
      if (ac.signal.aborted) return;
      setSuggestions(hits);
      setCursor(-1);
      setBusy(false);
      // only while someone is typing here: a name filled in by a link must not pop the list open
      setOpen(hits.length > 0 && document.activeElement === inputRef.current);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Close when focus or a click goes elsewhere.
  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
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
      if (e.key === 'Enter') { e.preventDefault(); onSearch({ name: (value || '').trim() }); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + suggestions.length) % suggestions.length); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursor >= 0) choose(suggestions[cursor]);
      else onSearch({ name: (value || '').trim() });
    } else if (e.key === 'Escape') { setOpen(false); }
  };

  const big = size === 'large';

  return (
    <div ref={boxRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <div style={{ position: 'relative' }}>
        <Search style={{
          position: 'absolute', left: big ? 16 : 13, top: '50%', transform: 'translateY(-50%)',
          width: big ? 18 : 15, height: big ? 18 : 15, color: 'rgba(255,255,255,0.45)', pointerEvents: 'none',
        }} />
        <input
          ref={inputRef}
          type="text"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length && setOpen(true)}
          placeholder="Search a town, city or postcode…"
          aria-label="Search for a place in the UK or Ireland"
          aria-autocomplete="list"
          aria-expanded={open}
          className="w-full bg-white/15 backdrop-blur-xl border border-white/25 text-white placeholder-white/55 focus:outline-none focus:border-white/60 focus:bg-white/20"
          style={{
            borderRadius: big ? 16 : 12,
            padding: big ? '15px 44px 15px 46px' : '10px 38px 10px 38px',
            fontSize: big ? 16 : 14,
          }}
        />
        {(busy || loading) && (
          <Loader2 className="animate-spin" style={{
            position: 'absolute', right: big ? 16 : 13, top: '50%', transform: 'translateY(-50%)',
            width: big ? 17 : 14, height: big ? 17 : 14, color: 'rgba(255,255,255,0.55)',
          }} />
        )}
        {!busy && !loading && value && (
          <button
            type="button" onClick={() => { onChange(''); setSuggestions([]); setOpen(false); }}
            aria-label="Clear search"
            style={{
              position: 'absolute', right: big ? 14 : 11, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', lineHeight: 1,
            }}>
            <X style={{ width: big ? 16 : 14, height: big ? 16 : 14 }} />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 60,
            margin: 0, padding: 6, listStyle: 'none',
            background: 'rgba(14,22,36,0.86)', backdropFilter: 'blur(24px) saturate(160%)', WebkitBackdropFilter: 'blur(24px) saturate(160%)',
            border: '1px solid rgba(255,255,255,0.16)', borderRadius: 14,
            boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
            maxHeight: 320, overflowY: 'auto',
          }}>
          {suggestions.map((s, i) => (
            <li key={s.key} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(s)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 11,
                  padding: '9px 11px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                  background: i === cursor ? 'rgba(255,255,255,0.10)' : 'transparent',
                }}>
                <MapPin style={{ width: 14, height: 14, color: '#7dd3fc', flexShrink: 0 }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', color: '#f1f5f9', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </span>
                  {s.region && (
                    <span style={{ display: 'block', color: 'rgba(148,163,184,0.85)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.region}
                    </span>
                  )}
                </span>
                {s.countryCode && s.countryCode !== 'GB' && (
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: '#94a3b8', flexShrink: 0 }}>
                    {s.countryCode}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
