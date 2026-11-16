/* The admin's drawing tools (lib/mapDrawings): what to draw, its colour (any, from the swatches or
   the picker) and how thick, with Undo, Clear and Done. While it is open the map is drawn on, not
   moved (two fingers still move and zoom it on a touch screen). */
import React from 'react';
import { ArrowUpRight, Check, Circle, Minus, PenLine, Pentagon, Square, Trash2, Undo2 } from 'lucide-react';
import { DRAW_COLOURS, DRAW_KINDS, DRAW_WIDTHS } from '@/lib/mapDrawings';

const ICON = { free: PenLine, line: Minus, arrow: ArrowUpRight, rect: Square, ellipse: Circle, shape: Pentagon };

export default function DrawBar({ tool, setTool, onUndo, onClear, onDone, onFinishShape, shapePoints = 0, canUndo, count, phone, style }) {
  const set = (k, v) => setTool((t) => ({ ...t, [k]: v }));
  const custom = !DRAW_COLOURS.includes(tool.colour);
  return (
    <div className={`mdd${phone ? ' is-phone' : ''}`} style={style} role="toolbar" aria-label="Draw on the map">
      <div className="mdd-row">
        {DRAW_KINDS.map(([k, label]) => {
          const I = ICON[k];
          return (
            <button key={k} type="button" className={`mdd-btn${tool.kind === k ? ' is-on' : ''}`} aria-pressed={tool.kind === k} title={label} aria-label={label} onClick={() => set('kind', k)}>
              <I size={phone ? 18 : 16} />{!phone && <span>{label}</span>}
            </button>
          );
        })}
      </div>
      <div className="mdd-row">
        {DRAW_COLOURS.map((c) => (
          <button key={c} type="button" className={`mdd-swatch${tool.colour === c ? ' is-on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={tool.colour === c} onClick={() => set('colour', c)} />
        ))}
        <label className={`mdd-swatch mdd-pick${custom ? ' is-on' : ''}`} title="Any colour" style={custom ? { background: tool.colour } : undefined}>
          <input type="color" value={tool.colour} onChange={(e) => set('colour', e.target.value)} aria-label="Any colour" />
        </label>
        <span className="mdd-gap" />
        {DRAW_WIDTHS.map(([label, w]) => (
          <button key={label} type="button" className={`mdd-width${tool.w === w ? ' is-on' : ''}`} aria-pressed={tool.w === w} title={label} aria-label={`${label} line`} onClick={() => set('w', w)}>
            <i style={{ height: Math.max(2, w * 0.6) }} />
          </button>
        ))}
      </div>
      <div className="mdd-row">
        {tool.kind === 'shape' && (
          <span className="mdd-hint">{shapePoints ? `${shapePoints} corner${shapePoints === 1 ? '' : 's'}: ` : ''}{shapePoints >= 3 ? '' : 'press each corner, then Finish'}</span>
        )}
        {tool.kind === 'shape' && shapePoints >= 3 && (
          <button type="button" className="mdd-act is-main" onClick={onFinishShape}><Check size={15} />Finish shape</button>
        )}
        <span className="mdd-gap" />
        <button type="button" className="mdd-act" onClick={onUndo} disabled={!canUndo}><Undo2 size={15} />Undo</button>
        <button type="button" className="mdd-act" onClick={onClear} disabled={!count}><Trash2 size={15} />Clear</button>
        <button type="button" className="mdd-act is-main" onClick={onDone}><Check size={15} />Done</button>
      </div>
    </div>
  );
}
