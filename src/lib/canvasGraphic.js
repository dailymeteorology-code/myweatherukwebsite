/**
 * Shared drawing helpers for the canvas-rendered social graphics (1080×1920 JPGs):
 * glass cards, rounded rects, pills, image loading and JPG download.
 */
export const FONT = 'Inter, system-ui, sans-serif';

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Frosted dark-glass card. */
export function glassCard(ctx, x, y, w, h, r = 26, tint = null) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, 'rgba(17,30,58,0.86)'); g.addColorStop(1, 'rgba(8,16,36,0.9)');
  ctx.fillStyle = g; ctx.fill(); ctx.restore();
  if (tint) { roundRect(ctx, x, y, w, h, r); ctx.fillStyle = tint; ctx.fill(); }
  roundRect(ctx, x, y, w, h, r); ctx.strokeStyle = 'rgba(186,230,253,0.26)'; ctx.lineWidth = 1.6; ctx.stroke();
}

/** A filled pill with centred text; returns its width. */
export function pill(ctx, x, y, text, { bg = '#0ea5e9', fg = '#fff', size = 22, padX = 18, h = null, weight = 800, align = 'left' } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + padX * 2, hh = h || size + 18;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  roundRect(ctx, x0, y, w, hh, hh / 2); ctx.fillStyle = bg; ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(text, x0 + w / 2, y + hh / 2 + 1);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  return w;
}

/** Shrink a font until `text` fits `maxW`. */
export function fitFont(ctx, text, weight, size, maxW) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) ctx.font = `${weight} ${Math.floor((size * maxW) / w)}px ${FONT}`;
}

export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // a logo without CORS headers would taint the export, so skip it
    img.src = src;
  });
}

/** Deep night-sky backdrop with a soft coloured glow. */
export function backdrop(ctx, W, H, glow = 'rgba(56,189,248,0.22)') {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#060d1f'); g.addColorStop(0.55, '#0a1530'); g.addColorStop(1, '#050b1a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const r = ctx.createRadialGradient(W * 0.8, H * 0.12, 0, W * 0.8, H * 0.12, W * 0.9);
  r.addColorStop(0, glow); r.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  const r2 = ctx.createRadialGradient(W * 0.1, H * 0.85, 0, W * 0.1, H * 0.85, W * 0.8);
  r2.addColorStop(0, 'rgba(99,102,241,0.14)'); r2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = r2; ctx.fillRect(0, 0, W, H);
}

/** Logo + handle + version, bottom-left. */
export function brandFooter(ctx, H, { logo, handle, version }) {
  let x = 60;
  if (logo) { const s = 64; ctx.save(); ctx.beginPath(); ctx.arc(60 + s / 2, H - 70, s / 2, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(logo, 60, H - 70 - s / 2, s, s); ctx.restore(); x = 60 + s + 18; }
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.font = `900 30px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.fillText(handle, x, H - 72);
  ctx.font = `800 17px ${FONT}`; ctx.fillStyle = 'rgba(148,163,184,0.95)'; ctx.fillText(String(version || '').toUpperCase(), x, H - 46);
}

export function downloadCanvas(canvas, filename) {
  canvas?.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/jpeg', 0.93);
}
