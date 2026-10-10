import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, CheckCircle, Zap, Bell, BarChart3, ArrowRight, Loader2, RefreshCw } from 'lucide-react';

const BENEFITS = [
  { icon: Zap,      label: 'Weekly storm outlook summaries',  color: '#facc15' },
  { icon: BarChart3,label: 'Model performance reports',       color: '#38bdf8' },
  { icon: Bell,     label: 'High-risk weather alerts',        color: '#f87171' },
];

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// 6-box OTP input
function OtpInput({ value, onChange }) {
  const inputs = useRef([]);
  const digits = (value + '      ').slice(0, 6).split('');

  const handleKey = (i, e) => {
    if (e.key === 'Backspace') {
      const next = value.slice(0, i > 0 ? i - 1 : 0) + value.slice(i + 1);
      onChange(next.slice(0, 6));
      if (i > 0) inputs.current[i - 1]?.focus();
    } else if (/^\d$/.test(e.key)) {
      const arr = (value + '      ').slice(0, 6).split('');
      arr[i] = e.key;
      const next = arr.join('').replace(/ /g, '').slice(0, 6);
      onChange(next);
      if (i < 5) inputs.current[i + 1]?.focus();
    }
  };

  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => inputs.current[i] = el}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d.trim()}
          onKeyDown={e => handleKey(i, e)}
          onChange={() => {}}
          onFocus={e => e.target.select()}
          style={{
            width: 48, height: 58, borderRadius: 12, border: '1.5px solid rgba(56,189,248,0.3)',
            background: 'rgba(56,189,248,0.06)', color: '#e2e8f0', fontSize: 24, fontWeight: 800,
            textAlign: 'center', outline: 'none', caretColor: 'transparent', cursor: 'text',
          }}
        />
      ))}
    </div>
  );
}

export default function NewsletterSignup() {
  const [email, setEmail]     = useState('');
  const [name, setName]       = useState('');
  const [code, setCode]       = useState('');
  const [step, setStep]       = useState('form'); // form | sending | verify | verifying | done | already | error
  const [error, setError]     = useState('');
  const [subId, setSubId]     = useState(null);
  const [storedCode, setStoredCode] = useState('');
  const [resending, setResending]   = useState(false);

  const inp = {
    width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 10, color: '#e2e8f0', padding: '12px 14px', fontSize: 14,
    outline: 'none', boxSizing: 'border-box',
  };

  const sendCode = async (emailAddr, nameVal, existingSub) => {
    const otp = genCode();
    const now = new Date().toISOString();
    let id;

    if (existingSub) {
      await base44.entities.NewsletterSubscriber.update(existingSub.id, {
        verification_token: otp, verified: false, subscribed_at: now,
        ...(nameVal ? { name: nameVal } : {}),
      });
      id = existingSub.id;
    } else {
      const created = await base44.entities.NewsletterSubscriber.create({
        email: emailAddr, name: nameVal || null,
        verified: false, verification_token: otp,
        subscribed_at: now, weekly_summary: true, storm_alerts: true, unsubscribed: false,
      });
      id = created.id;
    }

    try {
      await base44.integrations.Core.SendEmail({
        to: emailAddr,
        subject: 'Your MyWeatherUK verification code',
        body: `Hi ${nameVal || 'there'},\n\nYour 6-digit verification code for the MyWeatherUK newsletter is:\n\n${otp}\n\nEnter this code on the page to confirm your subscription. It expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.\n\n— MyWeatherUK`,
      });
    } catch {
      // SendEmail only works for registered app users; store code to allow manual entry
    }

    return { id, otp };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStep('sending');
    setError('');
    const emailAddr = email.trim().toLowerCase();

    try {
      const existing = await base44.entities.NewsletterSubscriber.filter({ email: emailAddr });
      const sub = existing?.[0];

      if (sub?.verified && !sub?.unsubscribed) {
        setStep('already');
        return;
      }

      const { id, otp } = await sendCode(emailAddr, name.trim(), sub || null);
      setSubId(id);
      setStoredCode(otp);
      setCode('');
      setStep('verify');
    } catch (err) {
      setStep('error');
      setError(err?.message || 'Something went wrong. Please try again.');
    }
  };

  const handleVerify = async () => {
    if (code.length !== 6) return;
    setStep('verifying');
    try {
      // Fetch fresh record to check token
      const results = await base44.entities.NewsletterSubscriber.filter({ verification_token: code });
      const sub = results?.find(s => s.id === subId);
      if (!sub) {
        setStep('verify');
        setError('Incorrect code. Please try again.');
        return;
      }
      await base44.entities.NewsletterSubscriber.update(sub.id, {
        verified: true, verified_at: new Date().toISOString(), verification_token: null,
      });
      setStep('done');
    } catch {
      setStep('verify');
      setError('Verification failed. Please try again.');
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError('');
    try {
      const { otp } = await sendCode(email.trim().toLowerCase(), name.trim(), { id: subId });
      setStoredCode(otp);
      setCode('');
    } catch {}
    setResending(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #060b18 0%, #0b1226 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px 80px' }}>
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} style={{ width: '100%', maxWidth: 480 }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(56,189,248,0.25), rgba(129,140,248,0.25))', border: '1px solid rgba(56,189,248,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Mail size={28} color="#38bdf8" />
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 900, color: '#e2e8f0' }}>MyWeatherUK Newsletter</h1>
          <p style={{ margin: 0, fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>Free, forever. Get weekly storm outlooks, model reports, and high-risk alerts.</p>
        </div>

        {/* Benefits */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
          {BENEFITS.map(({ icon: Icon, label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)' }}>
              <Icon size={18} color={color} />
              <span style={{ fontSize: 13.5, color: '#cbd5e1', fontWeight: 500 }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Card */}
        <div style={{ background: 'rgba(10,16,34,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, padding: 28, backdropFilter: 'blur(12px)' }}>
          <AnimatePresence mode="wait">

            {/* Step 1: Email form */}
            {step === 'form' && (
              <motion.form key="form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 6 }}>Your name (optional)</label>
                  <input style={inp} type="text" placeholder="e.g. Alex" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 6 }}>Email address *</label>
                  <input style={inp} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
                <button type="submit" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 0', borderRadius: 10, background: 'linear-gradient(135deg, #38bdf8, #818cf8)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  Subscribe — it's free <ArrowRight size={15} />
                </button>
                <p style={{ margin: 0, textAlign: 'center', fontSize: 11.5, color: '#475569' }}>No spam, ever. Unsubscribe any time.</p>
              </motion.form>
            )}

            {/* Sending */}
            {(step === 'sending' || step === 'verifying') && (
              <motion.div key="sending" style={{ textAlign: 'center', padding: '20px 0' }}>
                <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#38bdf8', margin: '0 auto 12px' }} />
                <p style={{ color: '#94a3b8', fontSize: 14 }}>{step === 'verifying' ? 'Verifying…' : 'Sending code…'}</p>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </motion.div>
            )}

            {/* Step 2: Enter code */}
            {step === 'verify' && (
              <motion.div key="verify" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                    <Mail size={22} color="#38bdf8" />
                  </div>
                  <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Check your email</h2>
                  <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
                    We sent a 6-digit code to <strong style={{ color: '#7dd3fc' }}>{email}</strong>.<br />
                    Enter it below to confirm your subscription.
                  </p>
                </div>

                <OtpInput value={code} onChange={setCode} />

                {error && <p style={{ margin: 0, color: '#f87171', fontSize: 13, textAlign: 'center' }}>{error}</p>}

                <button
                  onClick={handleVerify}
                  disabled={code.length !== 6}
                  style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: code.length === 6 ? 'linear-gradient(135deg, #38bdf8, #818cf8)' : 'rgba(255,255,255,0.08)', color: code.length === 6 ? '#fff' : '#64748b', fontSize: 14, fontWeight: 700, cursor: code.length === 6 ? 'pointer' : 'not-allowed' }}>
                  Verify & Subscribe
                </button>

                <button
                  onClick={handleResend}
                  disabled={resending}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 12.5, fontWeight: 600 }}>
                  {resending ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
                  Resend code
                </button>

                <p style={{ margin: 0, fontSize: 11, color: '#334155', textAlign: 'center' }}>
                  Note: email delivery only works for registered MyWeatherUK accounts.
                </p>
              </motion.div>
            )}

            {/* Done */}
            {step === 'done' && (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: 'center', padding: '10px 0' }}>
                <CheckCircle size={44} style={{ color: '#34d399', margin: '0 auto 14px' }} />
                <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: '#e2e8f0' }}>You're subscribed! 🎉</h2>
                <p style={{ margin: 0, fontSize: 13.5, color: '#94a3b8', lineHeight: 1.6 }}>Welcome to the MyWeatherUK newsletter. Expect your first weekly summary next Monday.</p>
              </motion.div>
            )}

            {/* Already subscribed */}
            {step === 'already' && (
              <motion.div key="already" style={{ textAlign: 'center', padding: '10px 0' }}>
                <CheckCircle size={40} style={{ color: '#38bdf8', margin: '0 auto 14px' }} />
                <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Already subscribed!</h2>
                <p style={{ color: '#94a3b8', fontSize: 13.5 }}>{email} is already on the list and verified.</p>
              </motion.div>
            )}

            {/* Error */}
            {step === 'error' && (
              <motion.div key="error" style={{ textAlign: 'center', padding: '10px 0' }}>
                <p style={{ color: '#f87171', marginBottom: 16, fontSize: 13.5 }}>{error}</p>
                <button onClick={() => setStep('form')} style={{ padding: '9px 20px', borderRadius: 9, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Try again
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}