/* ════════════════════════════════════════════════════════════════════════════
   Subscription  (route: /Subscription)
   ────────────────────────────────────────────────────────────────────────────
   Public subscription page — pricing tiers, the API product matrix and the
   per-tier API-credit usage. Driven by the SubscriptionMatrix config (editable
   in Admin Settings → Subscriptions) and fully theme-aware (light + dark).
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Zap, Loader2, ArrowLeft } from 'lucide-react';
import { loadSubConfig, cellFor } from '@/lib/subscriptionConfig';
import { useTheme } from '@/components/ThemeContext';

const FONT = "'DM Sans', system-ui, sans-serif";

// Two full palettes so the page reads well in both themes.
const PALETTE = {
  dark: {
    rootBg: 'radial-gradient(ellipse 90% 55% at 50% -10%, rgba(56,189,248,0.08) 0%, transparent 60%), #05070d',
    ink: '#f1f5f9', mid: '#94a3b8', faint: '#64748b',
    h1grad: 'linear-gradient(120deg,#ffffff 0%,#9fb3d1 100%)',
    cardBg: 'linear-gradient(160deg, rgba(20,28,46,0.7) 0%, rgba(9,13,24,0.9) 100%)',
    cardBorder: 'rgba(255,255,255,0.08)',
    featBorder: 'rgba(167,139,250,0.55)', featText: '#a78bfa',
    featShadow: '0 0 0 1px rgba(167,139,250,0.25), 0 18px 50px rgba(124,58,237,0.18)',
    wrapBorder: 'rgba(255,255,255,0.08)', rowBorder: 'rgba(255,255,255,0.06)',
    thBg: 'rgba(255,255,255,0.02)', prodBg: '#080c15', prodThBg: '#0a0f1a',
    usageText: '#cbd5e1', usageDot: '#38bdf8',
    check: '#22c55e', cross: '#ef4444', custom: '#fbbf24',
    backBg: 'rgba(255,255,255,0.04)', backBorder: 'rgba(255,255,255,0.1)',
  },
  light: {
    rootBg: 'radial-gradient(ellipse 90% 55% at 50% -10%, rgba(56,189,248,0.16) 0%, transparent 60%), #eef4ff',
    ink: '#0f172a', mid: '#475569', faint: '#64748b',
    h1grad: 'linear-gradient(120deg,#0f172a 0%,#0369a1 100%)',
    cardBg: 'linear-gradient(160deg, #ffffff 0%, #f4f8ff 100%)',
    cardBorder: 'rgba(15,23,42,0.10)',
    featBorder: 'rgba(124,58,237,0.5)', featText: '#7c3aed',
    featShadow: '0 0 0 1px rgba(124,58,237,0.18), 0 16px 44px rgba(124,58,237,0.12)',
    wrapBorder: 'rgba(15,23,42,0.10)', rowBorder: 'rgba(15,23,42,0.07)',
    thBg: 'rgba(15,23,42,0.03)', prodBg: '#ffffff', prodThBg: '#f4f8ff',
    usageText: '#334155', usageDot: '#0284c7',
    check: '#16a34a', cross: '#dc2626', custom: '#b45309',
    backBg: 'rgba(14,165,233,0.08)', backBorder: 'rgba(14,165,233,0.28)',
  },
};

const buildCSS = (P) => `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap');
.sub-root { background: ${P.rootBg}; min-height: 100vh; color: ${P.ink}; font-family: ${FONT}; padding: 40px 20px 80px; transition: background 0.3s, color 0.3s; }
.sub-inner { max-width: 1120px; margin: 0 auto; }
.sub-back { display: inline-flex; align-items: center; gap: 7px; margin-bottom: 22px; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; color: ${P.mid}; text-decoration: none; background: ${P.backBg}; border: 1px solid ${P.backBorder}; transition: all 0.16s; }
.sub-back:hover { color: ${P.ink}; border-color: ${P.usageDot}; }
.sub-h1 { font-size: clamp(28px, 5vw, 42px); font-weight: 900; letter-spacing: -0.03em; margin: 0; background: ${P.h1grad}; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.sub-sub { color: ${P.mid}; font-size: clamp(14px,2.2vw,16px); line-height: 1.6; margin: 14px 0 0; max-width: 720px; }
.sub-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin: 40px 0 56px; }
.sub-card { position: relative; display: flex; flex-direction: column; padding: 22px 20px; border-radius: 18px; background: ${P.cardBg}; border: 1px solid ${P.cardBorder}; }
.sub-card.feat { border-color: ${P.featBorder}; box-shadow: ${P.featShadow}; }
.sub-badge { position: absolute; top: -11px; left: 20px; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; }
.sub-tier-name { font-size: 15px; font-weight: 800; letter-spacing: 0.02em; margin: 4px 0 10px; color: ${P.ink}; }
.sub-tier-name.feat { color: ${P.featText}; }
.sub-price { font-size: 30px; font-weight: 900; letter-spacing: -0.03em; font-family: 'DM Sans', monospace; color: ${P.ink}; }
.sub-period { font-size: 13px; font-weight: 600; color: ${P.mid}; }
.sub-note { font-size: 12px; font-style: italic; color: ${P.faint}; margin-top: 3px; }
.sub-usage-h { font-size: 9.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: ${P.faint}; margin: 18px 0 8px; display: flex; align-items: center; gap: 5px; }
.sub-usage { list-style: none; margin: 0; padding: 0; }
.sub-usage li { font-size: 12.5px; color: ${P.usageText}; line-height: 1.5; margin-bottom: 6px; display: flex; gap: 7px; }
.sub-usage li::before { content: ''; width: 5px; height: 5px; margin-top: 7px; border-radius: 50%; background: ${P.usageDot}; flex-shrink: 0; }
.sub-matrix-title { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 4px; color: ${P.ink}; }
.sub-matrix-caption { font-size: 13px; color: ${P.mid}; margin: 0 0 18px; }
.sub-table-wrap { overflow-x: auto; border: 1px solid ${P.wrapBorder}; border-radius: 16px; -webkit-overflow-scrolling: touch; }
.sub-table { border-collapse: collapse; width: 100%; min-width: 640px; }
.sub-table th, .sub-table td { padding: 15px 16px; text-align: center; border-bottom: 1px solid ${P.rowBorder}; }
.sub-table thead th { font-size: 12px; font-weight: 800; color: ${P.ink}; background: ${P.thBg}; position: sticky; top: 0; }
.sub-table tbody tr:last-child td { border-bottom: none; }
.sub-prod { text-align: left !important; font-size: 13.5px; font-weight: 700; color: ${P.ink}; position: sticky; left: 0; background: ${P.prodBg}; min-width: 200px; }
.sub-prod-th { text-align: left !important; position: sticky; left: 0; background: ${P.prodThBg}; z-index: 2; }
.sub-yes { color: ${P.check}; }
.sub-no  { color: ${P.cross}; }
.sub-custom { font-size: 12px; font-weight: 700; color: ${P.custom}; white-space: nowrap; }
@media (max-width: 560px) { .sub-root { padding: 24px 12px 64px; } }
`;

function Cell({ cell }) {
  if (cell?.type === 'yes') return <Check className="sub-yes" style={{ width: 19, height: 19 }} strokeWidth={3} aria-label="Included" />;
  if (cell?.type === 'text') return <span className="sub-custom">{cell.text}</span>;
  return <X className="sub-no" style={{ width: 19, height: 19 }} strokeWidth={3} aria-label="Not included" />;
}

export default function Subscription() {
  const { isDark } = useTheme();
  const P = isDark ? PALETTE.dark : PALETTE.light;
  const CSS = buildCSS(P);

  const [cfg, setCfg] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSubConfig()
      .then(({ config }) => { if (alive) setCfg(config); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (!cfg) {
    return (
      <div className="sub-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{CSS}</style>
        {failed
          ? <p style={{ color: P.mid }}>Couldn’t load subscriptions. Please refresh.</p>
          : <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: P.mid }}>
              <Loader2 style={{ width: 18, height: 18, animation: 'spin 0.9s linear infinite' }} />
              <span style={{ fontWeight: 600 }}>Loading plans…</span>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>}
      </div>
    );
  }

  const { intro, tiers, products } = cfg;

  return (
    <div className="sub-root">
      <style>{CSS}</style>
      <div className="sub-inner">

        {/* ── Back to home ── */}
        <Link to="/" className="sub-back"><ArrowLeft style={{ width: 15, height: 15 }} /> Back to Home</Link>

        {/* ── Heading ── */}
        <header>
          <h1 className="sub-h1">{intro.title}</h1>
          {intro.subtitle && <p className="sub-sub">{intro.subtitle}</p>}
        </header>

        {/* ── Pricing cards ── */}
        <div className="sub-cards">
          {tiers.map((t) => (
            <div key={t.id} className={`sub-card${t.highlight ? ' feat' : ''}`}>
              {t.badge && (
                <span className="sub-badge" style={{ background: `${t.badgeColor}22`, color: t.badgeColor, border: `1px solid ${t.badgeColor}` }}>
                  {t.badge}
                </span>
              )}
              <div className={`sub-tier-name${t.highlight ? ' feat' : ''}`}>{t.name}</div>
              <div>
                <span className="sub-price">{t.price}</span>
                {t.period && <span className="sub-period"> {t.period}</span>}
              </div>
              {t.priceNote && <div className="sub-note">{t.priceNote}</div>}

              {Array.isArray(t.apiUsage) && t.apiUsage.filter(Boolean).length > 0 && (
                <>
                  <div className="sub-usage-h">
                    <Zap style={{ width: 11, height: 11, color: P.usageDot }} /> API credit usage
                  </div>
                  <ul className="sub-usage">
                    {t.apiUsage.filter(Boolean).map((ln, i) => <li key={i}>{ln}</li>)}
                  </ul>
                </>
              )}
            </div>
          ))}
        </div>

        {/* ── Product matrix ── */}
        <h2 className="sub-matrix-title">API Product Matrix</h2>
        <p className="sub-matrix-caption">What each plan includes across our forecast products and APIs.</p>

        <div className="sub-table-wrap">
          <table className="sub-table">
            <thead>
              <tr>
                <th className="sub-prod-th">Product</th>
                {tiers.map((t) => <th key={t.id}>{t.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="sub-prod">{p.name}</td>
                  {tiers.map((t) => (
                    <td key={t.id}><Cell cell={cellFor(p, t.id)} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
