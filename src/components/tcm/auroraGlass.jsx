/* ═══════════════════════════════════════════════════════════════
   Aurora Glass — shared design tokens for the TCM / Lightning page.
   Deep midnight backgrounds, high-translucency frosted glass panels,
   neon cyan / violet accents, and top-edge aurora highlight rails.
   ═══════════════════════════════════════════════════════════════ */

// Generated aurora background texture (deep navy → black with soft cyan/violet bleeds)
export const AURORA_BG_URL =
  'https://media.base44.com/images/public/69945c97e07811f2b5427aa6/5478991b9_generated_image.png';

export const AURORA = {
  // Page backdrop
  pageBg: 'radial-gradient(140% 120% at 15% -10%, rgba(34,211,238,0.07) 0%, transparent 45%), radial-gradient(130% 130% at 100% 110%, rgba(139,92,246,0.09) 0%, transparent 50%), linear-gradient(180deg, #0b1226 0%, #080d1d 55%, #060b18 100%)',
  pageBgLight: 'linear-gradient(180deg, #eef3fb 0%, #e7eef8 100%)',

  // Accent colours
  cyan:   '#22d3ee',
  violet: '#8b5cf6',
  cyanDim:   'rgba(34,211,238,0.55)',
  violetDim: 'rgba(139,92,246,0.55)',

  // Text
  text:    '#e8eefb',
  textSub: '#8b9bc0',
  textFaint: 'rgba(139,155,192,0.55)',
};

/**
 * Frosted glass panel base style.
 * @param {object} extra  — extra style overrides
 * @param {boolean} light — light-mode variant
 */
export const glassPanel = (extra = {}, light = false) => ({
  position: 'relative',
  background: light
    ? 'rgba(255,255,255,0.72)'
    : 'linear-gradient(160deg, rgba(30,41,72,0.55) 0%, rgba(16,23,46,0.50) 55%, rgba(10,15,32,0.62) 100%)',
  border: light ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.10)',
  backdropFilter: 'blur(20px) saturate(150%)',
  WebkitBackdropFilter: 'blur(20px) saturate(150%)',
  borderRadius: 16,
  boxShadow: light
    ? '0 4px 24px rgba(0,0,0,0.08)'
    : '0 10px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
  overflow: 'hidden',
  ...extra,
});

/**
 * Top-edge aurora highlight rail — a thin glowing gradient bar that sits
 * along the very top of a glass panel. Render as the first child.
 * @param {string} from  — left colour
 * @param {string} to    — right colour
 */
export function AuroraRail({ from = AURORA.cyan, to = AURORA.violet, light = false }) {
  if (light) return null;
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 1.5,
      background: `linear-gradient(90deg, transparent 0%, ${from} 22%, ${to} 78%, transparent 100%)`,
      opacity: 0.85, pointerEvents: 'none', zIndex: 1,
    }} />
  );
}

// hex → "r,g,b"
export function rgbStr(hex) {
  if (!hex || hex[0] !== '#') return '139,155,192';
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)].join(',');
}