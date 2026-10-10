import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, X, ArrowRight, Zap, Bell, BarChart3, CheckCircle, Loader2, CloudLightning, Shield, Sparkles } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';

const POPUP_DISMISSED_KEY = 'mwuk_newsletter_popup_dismissed';
const POPUP_SUBSCRIBED_KEY = 'mwuk_newsletter_subscribed';

function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const BENEFITS = [
  { icon: Zap,       text: 'Weekly storm outlook summaries', color: '#facc15', bg: 'rgba(250,204,21,0.12)', bd: 'rgba(250,204,21,0.3)' },
  { icon: BarChart3, text: 'Model run performance reports',  color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', bd: 'rgba(56,189,248,0.3)' },
  { icon: Bell,      text: 'High-risk weather alerts',        color: '#f87171', bg: 'rgba(248,113,113,0.12)', bd: 'rgba(248,113,113,0.3)' },
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap');
@keyframes nlp-aurora { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }
@keyframes nlp-spin { to { transform: rotate(360deg); } }
@keyframes nlp-sweep { to { transform: rotate(360deg); } }
@keyframes nlp-float { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-14px) } }
@keyframes nlp-ring { 0%{ transform: scale(0.8); opacity:0.5 } 100%{ transform: scale(1.7); opacity:0 } }
@keyframes nlp-shine { 0%{ transform: translateX(-140%) skewX(-18deg) } 60%,100%{ transform: translateX(240%) skewX(-18deg) } }
@keyframes nlp-pop { 0%{ transform: scale(0.6); opacity:0 } 60%{ transform: scale(1.08) } 100%{ transform: scale(1); opacity:1 } }

.nlp-backdrop {
  position: fixed; inset: 0; z-index: 9800;
  display: flex; align-items: center; justify-content: center;
  padding: 24px; overflow-y: auto;
  background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(56,189,248,0.10), transparent 60%), rgba(3,7,16,0.74);
  backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px);
}
.nlp-card {
  position: relative; box-sizing: border-box;
  width: min(440px, 100%); margin: auto;
  border-radius: 26px; overflow: hidden;
  background: linear-gradient(168deg, #0e1a30 0%, #0a1120 52%, #0b1426 100%);
  border: 1px solid rgba(56,189,248,0.22);
  box-shadow: 0 40px 120px rgba(0,0,0,0.7), 0 0 0 1px rgba(56,189,248,0.06), 0 0 80px rgba(56,189,248,0.10);
  font-family: 'DM Sans', system-ui, sans-serif;
}
.nlp-rail { position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg,#38bdf8,#818cf8 40%,#a78bfa 60%,#38bdf8); background-size: 200% 100%; animation: nlp-aurora 4s linear infinite; }
.nlp-particle { position: absolute; border-radius: 50%; pointer-events: none; }
.nlp-body { position: relative; padding: 34px 30px 26px; }
.nlp-close {
  position: absolute; top: 14px; right: 14px; z-index: 10;
  width: 34px; height: 34px; border-radius: 11px;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10);
  display: flex; align-items: center; justify-content: center; cursor: pointer; color: #64748b; transition: all 0.15s;
}
.nlp-close:hover { background: rgba(255,255,255,0.13); color: #cbd5e1; transform: rotate(90deg); }

.nlp-hero { display: flex; justify-content: center; margin-bottom: 20px; }
.nlp-hero-core {
  position: relative; width: 74px; height: 74px; border-radius: 50%;
  background: linear-gradient(135deg, rgba(56,189,248,0.20), rgba(129,140,248,0.18));
  border: 1.5px solid rgba(56,189,248,0.38);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 34px rgba(56,189,248,0.22);
}
.nlp-sweep { position: absolute; inset: -7px; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0%, rgba(56,189,248,0.45) 12%, transparent 26%); animation: nlp-sweep 3.4s linear infinite; pointer-events: none; }
.nlp-ring { position: absolute; inset: -4px; border-radius: 50%; border: 1.5px solid rgba(56,189,248,0.4); animation: nlp-ring 2.6s ease-out infinite; pointer-events: none; }

.nlp-eyebrow { display:inline-flex; align-items:center; gap:6px; padding:4px 12px; border-radius:99px; background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.25); color:#7dd3fc; font-size:10.5px; font-weight:800; letter-spacing:0.12em; text-transform:uppercase; margin:0 auto 12px; }
.nlp-title { margin: 0 0 7px; font-size: 25px; font-weight: 900; letter-spacing: -0.03em; line-height: 1.12; text-align: center; background: linear-gradient(120deg,#ffffff 0%,#bae6fd 50%,#c7d2fe 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.nlp-sub { margin: 0 0 22px; font-size: 13.5px; color: #8ba0b8; line-height: 1.55; text-align: center; }

.nlp-benefits { display: flex; flex-direction: column; gap: 8px; margin-bottom: 22px; }
.nlp-benefit { display: flex; align-items: center; gap: 12px; padding: 11px 13px; border-radius: 13px; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.06); }
.nlp-benefit-ic { width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.nlp-benefit-tx { font-size: 13.5px; color: #dbe4ef; font-weight: 600; }

.nlp-form { display: flex; flex-direction: column; gap: 11px; }
.nlp-input-wrap { position: relative; }
.nlp-input { width: 100%; box-sizing: border-box; padding: 14px 15px 14px 42px; border-radius: 13px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #eef4fb; font-size: 15px; outline: none; transition: border-color 0.15s, box-shadow 0.15s; font-family: inherit; }
.nlp-input:focus { border-color: rgba(56,189,248,0.55); box-shadow: 0 0 0 3px rgba(56,189,248,0.12); }
.nlp-input::placeholder { color: #56657c; }

.nlp-cta { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 15px 0; border-radius: 13px; border: none; color: #061019; font-size: 15px; font-weight: 900; letter-spacing: 0.01em; cursor: pointer; font-family: inherit; background: linear-gradient(135deg,#38bdf8 0%,#818cf8 55%,#a78bfa 100%); box-shadow: 0 8px 26px rgba(56,189,248,0.32); transition: transform 0.12s, box-shadow 0.15s; }
.nlp-cta:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 32px rgba(56,189,248,0.42); }
.nlp-cta:active:not(:disabled) { transform: translateY(0); }
.nlp-cta:disabled { cursor: wait; background: rgba(56,189,248,0.3); color: #cbd5e1; box-shadow: none; }
.nlp-cta-shine { position: absolute; top: 0; left: 0; width: 45%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent); animation: nlp-shine 3.2s ease-in-out infinite; pointer-events: none; }

.nlp-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 15px; gap: 8px; flex-wrap: wrap; }
.nlp-foot-note { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: #56657c; }
.nlp-foot-link { font-size: 11.5px; color: #38bdf8; text-decoration: none; font-weight: 700; }

/* ── Mobile: fit every phone ── */
@media (max-width: 520px) {
  .nlp-backdrop { padding: 12px; }
  .nlp-card { width: 100%; border-radius: 22px; }
  .nlp-body { padding: 26px 18px 20px; }
  .nlp-hero { margin-bottom: 16px; }
  .nlp-hero-core { width: 62px; height: 62px; }
  .nlp-title { font-size: 20px; }
  .nlp-sub { font-size: 12.5px; margin-bottom: 18px; }
  .nlp-benefits { gap: 7px; margin-bottom: 18px; }
  .nlp-benefit { padding: 10px 12px; }
  .nlp-benefit-tx { font-size: 12.5px; }
  .nlp-input { padding: 13px 13px 13px 40px; font-size: 16px; } /* 16px stops iOS zoom-on-focus */
  .nlp-cta { padding: 14px 0; font-size: 15px; }
}
/* ── Short screens (landscape phones): allow scroll, tighten ── */
@media (max-height: 640px) {
  .nlp-hero { margin-bottom: 12px; }
  .nlp-hero-core { width: 54px; height: 54px; }
  .nlp-sub { margin-bottom: 14px; }
  .nlp-benefits { margin-bottom: 14px; }
}
`;

export default function NewsletterPopup() {
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('prompt'); // prompt | sending | done
  const [error, setError] = useState('');

  useEffect(() => {
    if (localStorage.getItem(POPUP_SUBSCRIBED_KEY) === 'true') return;
    if (sessionStorage.getItem(POPUP_DISMISSED_KEY) === 'true') return;
    const timer = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(POPUP_DISMISSED_KEY, 'true');
    setVisible(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStep('sending');
    setError('');
    try {
      const existing = await base44.entities.NewsletterSubscriber.filter({ email: email.trim().toLowerCase() });
      if (existing?.length && existing[0].verified && !existing[0].unsubscribed) {
        localStorage.setItem(POPUP_SUBSCRIBED_KEY, 'true');
        setStep('done');
        return;
      }
      const token = genToken();
      const now = new Date().toISOString();
      if (existing?.length) {
        await base44.entities.NewsletterSubscriber.update(existing[0].id, { verification_token: token, verified: false, subscribed_at: now, unsubscribed: false });
      } else {
        await base44.entities.NewsletterSubscriber.create({
          email: email.trim().toLowerCase(), verified: false, verification_token: token,
          subscribed_at: now, weekly_summary: true, storm_alerts: true, unsubscribed: false,
        });
      }
      try {
        const verifyUrl = `${window.location.origin}/NewsletterSignup?verify=${token}`;
        await base44.integrations.Core.SendEmail({
          to: email.trim().toLowerCase(),
          subject: 'Verify your MyWeatherUK newsletter subscription',
          body: `Thank you for subscribing!\n\nClick here to verify: ${verifyUrl}\n\n— MyWeatherUK`,
        });
      } catch { /* SendEmail only for registered users; subscription still recorded */ }
      localStorage.setItem(POPUP_SUBSCRIBED_KEY, 'true');
      setStep('done');
      setTimeout(() => setVisible(false), 3400);
    } catch {
      setStep('prompt');
      setError('Something went wrong. Please try again.');
    }
  };

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          className="nlp-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={dismiss}
        >
          <style>{CSS}</style>

          <motion.div
            className="nlp-card"
            initial={{ opacity: 0, scale: 0.9, y: 26 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nlp-rail" />

            {/* Ambient glow + floating particles */}
            <div className="nlp-particle" style={{ top: -46, right: -46, width: 200, height: 200, background: 'radial-gradient(circle, rgba(129,140,248,0.10) 0%, transparent 70%)' }} />
            <div className="nlp-particle" style={{ bottom: -30, left: -30, width: 170, height: 170, background: 'radial-gradient(circle, rgba(56,189,248,0.09) 0%, transparent 70%)' }} />
            <div className="nlp-particle" style={{ top: 60, left: 22, width: 5, height: 5, background: '#38bdf8', opacity: 0.5, animation: 'nlp-float 5s ease-in-out infinite' }} />
            <div className="nlp-particle" style={{ top: 120, right: 30, width: 4, height: 4, background: '#a78bfa', opacity: 0.5, animation: 'nlp-float 6.5s ease-in-out infinite 0.6s' }} />
            <div className="nlp-particle" style={{ bottom: 90, left: 40, width: 3, height: 3, background: '#818cf8', opacity: 0.5, animation: 'nlp-float 7s ease-in-out infinite 1.1s' }} />

            <button className="nlp-close" onClick={dismiss} aria-label="Close"><X size={16} /></button>

            <div className="nlp-body">
              {step !== 'done' ? (
                <>
                  {/* Hero */}
                  <div className="nlp-hero">
                    <div className="nlp-hero-core">
                      <div className="nlp-sweep" />
                      <div className="nlp-ring" />
                      <CloudLightning size={32} color="#7dd3fc" style={{ position: 'relative', zIndex: 1 }} />
                    </div>
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <span className="nlp-eyebrow"><Sparkles size={11} /> MyWeatherUK Newsletter</span>
                  </div>
                  <h2 className="nlp-title">Stay ahead of the storms</h2>
                  <p className="nlp-sub">Get the sharpest UK convective outlooks straight to your inbox — completely free, forever.</p>

                  {/* Benefits */}
                  <div className="nlp-benefits">
                    {BENEFITS.map(({ icon: Icon, text, color, bg, bd }, i) => (
                      <motion.div
                        key={text} className="nlp-benefit"
                        initial={{ opacity: 0, x: -14 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.12 + i * 0.08, duration: 0.35 }}
                      >
                        <div className="nlp-benefit-ic" style={{ background: bg, border: `1px solid ${bd}` }}>
                          <Icon size={16} color={color} />
                        </div>
                        <span className="nlp-benefit-tx">{text}</span>
                      </motion.div>
                    ))}
                  </div>

                  {/* Form */}
                  <form className="nlp-form" onSubmit={handleSubmit}>
                    <div className="nlp-input-wrap">
                      <Mail size={16} style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', color: '#56657c', pointerEvents: 'none' }} />
                      <input
                        className="nlp-input"
                        type="email" required inputMode="email" autoComplete="email"
                        placeholder="your@email.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                      />
                    </div>

                    {error && <p style={{ margin: 0, fontSize: 12.5, color: '#f87171', textAlign: 'center' }}>{error}</p>}

                    <button className="nlp-cta" type="submit" disabled={step === 'sending'}>
                      {step !== 'sending' && <span className="nlp-cta-shine" />}
                      {step === 'sending'
                        ? <><Loader2 size={17} style={{ animation: 'nlp-spin 1s linear infinite' }} /> Subscribing…</>
                        : <>Subscribe free <ArrowRight size={16} /></>}
                    </button>
                  </form>

                  <div className="nlp-foot">
                    <span className="nlp-foot-note"><Shield size={12} /> No spam. Unsubscribe any time.</span>
                    <Link to="/NewsletterSignup" onClick={dismiss} className="nlp-foot-link">Learn more →</Link>
                  </div>
                </>
              ) : (
                /* Success */
                <div style={{ textAlign: 'center', padding: '18px 0 10px' }}>
                  <div style={{ width: 76, height: 76, borderRadius: '50%', margin: '0 auto 18px', background: 'rgba(52,211,153,0.12)', border: '1.5px solid rgba(52,211,153,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'nlp-pop 0.5s ease-out both' }}>
                    <CheckCircle size={38} color="#34d399" />
                  </div>
                  <h2 className="nlp-title" style={{ fontSize: 23, marginBottom: 9 }}>You&apos;re in! 🎉</h2>
                  <p style={{ margin: '0 0 6px', fontSize: 14, color: '#94a3b8', lineHeight: 1.55 }}>Check your email to verify your subscription.</p>
                  <p style={{ margin: 0, fontSize: 12.5, color: '#56657c' }}>Welcome to the MyWeatherUK community!</p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
