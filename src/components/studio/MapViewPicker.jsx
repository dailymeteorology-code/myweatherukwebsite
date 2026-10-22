/* Picks an outlook graphic's map view: a preset region, or any counties of the UK and Ireland,
   clicked on a small map or ticked in a list (Cornwall, Devon and Cork, say, or the whole of
   Scotland bar the islands). The graphic then zooms to them, with the rest of the land in grey. */
import React, { useMemo, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { MAP_PRESETS, VIEW_W, VIEW_H, presetIds, useCounties, COUNTRY_ORDER } from '@/components/studio/studioGeo';
import { Btn, Seg } from '@/components/studio/StudioUI';

export default function MapViewPicker({ region, areas = [], context = true, onChange, onContext }) {
  const data = useCounties();
  const [open, setOpen] = useState(region === 'custom');
  const [q, setQ] = useState('');
  const [hover, setHover] = useState(null);
  const selected = useMemo(() => new Set(region === 'custom' ? areas : data && region !== 'uk' ? presetIds(data, region) : []), [region, areas, data]);

  const setCustom = (ids) => onChange({ region: ids.length ? 'custom' : 'uk', areas: ids });
  const toggle = (id) => {
    const base = region === 'uk' ? [] : [...selected];
    setCustom(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  };
  const setGroup = (ids, on) => {
    const base = new Set(region === 'uk' ? [] : selected);
    ids.forEach((id) => (on ? base.add(id) : base.delete(id)));
    setCustom([...base]);
  };

  const groups = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return COUNTRY_ORDER.flatMap((country) => data.groups.filter((g) => g.country === country)).map((g) => ({
      ...g, shown: g.ids.filter((id) => !needle || data.byId[id].name.toLowerCase().includes(needle) || g.name.toLowerCase().includes(needle)),
    })).filter((g) => g.shown.length);
  }, [data, q]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="sg-row">
        {MAP_PRESETS.map((p) => (
          <Btn key={p.id} sm on={region === p.id} onClick={() => onChange({ region: p.id, areas: [] })}>{p.label}</Btn>
        ))}
        <Btn sm on={region === 'custom' || open} color="#a78bfa" onClick={() => setOpen((v) => !v)}>Custom counties…</Btn>
      </div>
      {region !== 'uk' && (
        <div className="sg-row" style={{ justifyContent: 'space-between' }}>
          <span className="sg-note">Land outside the view</span>
          <Seg value={context ? 'grey' : 'hide'} onChange={(v) => onContext(v === 'grey')} options={[['grey', 'Grey'], ['hide', 'Hidden']]} />
        </div>
      )}
      {open && (
        <div className="sg-panel">
          {!data && <p className="sg-note">Loading counties…</p>}
          {data && (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '0 0 auto', width: 168, position: 'relative' }}>
                  <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ width: '100%', display: 'block' }} role="group" aria-label="Click counties to add or remove them">
                    {data.areas.map((a) => {
                      const on = selected.has(a.id);
                      return (
                        <path key={a.id} d={a.coarse} fillRule="evenodd"
                          onClick={() => toggle(a.id)} onMouseEnter={() => setHover(a.name)} onMouseLeave={() => setHover(null)}
                          style={{
                            cursor: 'pointer', transition: 'fill .12s',
                            fill: on ? 'color-mix(in srgb, #a78bfa 70%, transparent)' : hover === a.name ? 'var(--sg-border3)' : 'var(--sg-surface2)',
                            stroke: on ? '#7c3aed' : 'var(--sg-border3)', strokeWidth: 0.45,
                          }}>
                          <title>{a.name}</title>
                        </path>
                      );
                    })}
                  </svg>
                  <span className="sg-note" style={{ position: 'absolute', left: 0, bottom: 0, fontWeight: 700, color: 'var(--sg-text)' }}>{hover || ' '}</span>
                </div>
                <div style={{ flex: '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ position: 'relative' }}>
                    <Search style={{ position: 'absolute', left: 10, top: 10, width: 14, height: 14, color: 'var(--sg-faint)' }} />
                    <input className="sg-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a county or region" style={{ paddingLeft: 30 }} />
                  </div>
                  <div className="sg-row" style={{ justifyContent: 'space-between' }}>
                    <span className="sg-note"><b>{selected.size || 'No'}</b> {selected.size === 1 ? 'county' : 'counties'} chosen</span>
                    {region === 'custom' && <Btn sm danger icon={X} onClick={() => onChange({ region: 'uk', areas: [] })}>Clear</Btn>}
                  </div>
                  <div className="sg-list" style={{ maxHeight: 300 }}>
                    {groups.map((g) => {
                      const n = g.ids.filter((id) => selected.has(id)).length;
                      const all = n === g.ids.length;
                      return (
                        <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <button type="button" className="sg-btn is-sm" aria-pressed={all} onClick={() => setGroup(g.ids, !all)}
                            style={{ justifyContent: 'flex-start', ...(n ? { '--c': '#a78bfa' } : {}) }} title={all ? 'Remove the whole group' : 'Add the whole group'}>
                            <span style={{ width: 14, height: 14, borderRadius: 4, display: 'grid', placeItems: 'center', border: '1.5px solid var(--sg-border3)', background: all ? '#a78bfa' : n ? 'color-mix(in srgb, #a78bfa 35%, transparent)' : 'transparent' }}>
                              {all && <Check style={{ width: 10, height: 10, color: '#fff' }} />}
                            </span>
                            <b style={{ color: 'var(--sg-text)' }}>{g.name}</b>
                            <span style={{ marginLeft: 'auto', color: 'var(--sg-faint)' }}>{n}/{g.ids.length}</span>
                          </button>
                          <div className="sg-row" style={{ gap: 4, paddingLeft: 4 }}>
                            {g.shown.map((id) => (
                              <Btn key={id} sm on={selected.has(id)} color="#a78bfa" onClick={() => toggle(id)}>{data.byId[id].name}</Btn>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p className="sg-note">Click counties on the map or in the list. Any mix works: English counties with Welsh or Irish ones, a single county, or whole regions. The graphic zooms to fit them.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
