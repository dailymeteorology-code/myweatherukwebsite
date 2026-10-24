/* The warning symbols as components: `warningSymbol(type)` gives the symbol for a warning type
   (Met Office or the site's own), drawn from warningSymbolShapes. Wind keeps Lucide's Wind; every
   other type has MyWeatherUK's own. Each takes Lucide's props (size, strokeWidth, color,
   className, style), so it drops in wherever a Lucide icon stood. */
import React from 'react';
import { Wind } from 'lucide-react';
import { WARNING_SYMBOLS, SOFT_OPACITY, symbolKey } from './warningSymbolShapes';

const PAINT = {
  soft: { fill: 'currentColor', fillOpacity: SOFT_OPACITY },
  solid: { fill: 'currentColor' },
  dot: { fill: 'currentColor', stroke: 'none' },
  wash: { fill: 'currentColor', fillOpacity: SOFT_OPACITY, stroke: 'none' },
};

function make(key) {
  const { label, els } = WARNING_SYMBOLS[key];
  function Symbol({ size = 24, strokeWidth = 2, color = 'currentColor', className, style, ...rest }) {
    const k = Number(strokeWidth) / 2;   // an element's own line width scales with the symbol's
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}
        style={color === 'currentColor' ? style : { color, ...style }} {...rest}>
        {els.map(([Tag, { paint, strokeWidth: w, ...a }], i) => <Tag key={i} {...a} {...PAINT[paint]} {...(w ? { strokeWidth: w * k } : {})} />)}
      </svg>
    );
  }
  Symbol.displayName = `${label.replace(/\s+/g, '')}WarningSymbol`;
  return Symbol;
}

export const WARNING_SYMBOL_COMPONENTS = Object.fromEntries(Object.keys(WARNING_SYMBOLS).map((k) => [k, make(k)]));

/** The symbol component for a warning type. */
export function warningSymbol(type) {
  const k = symbolKey(type);
  return k ? WARNING_SYMBOL_COMPONENTS[k] : Wind;
}
