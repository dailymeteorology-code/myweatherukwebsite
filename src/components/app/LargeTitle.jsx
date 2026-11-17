/* An iOS large title (17 Nov 2026, the iOS-app redesign): the page's name in 34 pt bold at the top left, as a
   tab's first screen has it in an Apple app, with an optional line under it and room for a control on the
   right. Colours come from the page's own ink (the glass pages' --ink-1/--ink-2), falling back to the text's. */
import React from 'react';

export default function LargeTitle({ title, subtitle = null, right = null, maxWidth = 1120 }) {
  return (
    <header
      className="mx-auto w-full px-4 sm:px-6"
      style={{ maxWidth, paddingTop: 'calc(env(safe-area-inset-top, 0px) + clamp(14px, 4.5vw, 40px))' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{
          margin: 0, fontSize: 'clamp(30px, 8.6vw, 40px)', lineHeight: 1.12, fontWeight: 750, letterSpacing: '-0.015em',
          color: 'var(--ink-1, currentColor)', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, system-ui, sans-serif',
        }}>{title}</h1>
        {right}
      </div>
      {subtitle ? (
        <p style={{ margin: '6px 0 0', fontSize: 15, lineHeight: 1.4, fontWeight: 550, color: 'var(--ink-2, currentColor)' }}>{subtitle}</p>
      ) : null}
    </header>
  );
}
