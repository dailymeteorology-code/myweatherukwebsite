/* Newsletter: signing up to MyWeatherUK's newsletter.

   Sign-up and verification are the server's (server/publicFlows.js), since the subscriber list is
   the admin's to read: the page posts a name and email, the server emails a 6-digit code and a link,
   and either confirms the subscription. Following the emailed link
   (/NewsletterSignup?verify=<code>&sub=<id>) confirms it straight away. */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mail, CloudLightning, BarChart3, Bell, ArrowRight, Loader2, RefreshCw, CheckCircle2, ShieldCheck, Pencil, Newspaper, Home } from 'lucide-react';
import NewsShell from '@/components/news/NewsShell';

const BENEFITS = [
  { icon: CloudLightning, color: '#facc15', title: 'Storm outlooks', text: 'Where thunderstorms are likely in the days ahead, before they happen.' },
  { icon: BarChart3, color: '#38bdf8', title: 'Forecast stories', text: 'The analysis behind our forecasts, and how the models did.' },
  { icon: Bell, color: '#f87171', title: 'High-risk alerts', text: 'A heads-up when severe weather is on the way.' },
];
const STEPS = ['Your details', 'Confirm', 'Done'];
const RESEND_WAIT = 30;

const CSS = `
/* the introduction and the benefits on the left, the form on the right; on a phone the form comes second */
.nl-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(340px, 1fr); grid-template-areas: 'intro card' 'perks card'; gap: 16px; align-items: start; }
.nl-about { grid-area: intro; padding: clamp(22px, 3.6vw, 40px); overflow: hidden; }
.nl-perks { grid-area: perks; padding: clamp(16px, 2.4vw, 22px); }
.nl-about::before { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: radial-gradient(110% 90% at 0% 0%, color-mix(in srgb, var(--ad-sky) 16%, transparent), transparent 55%), radial-gradient(90% 80% at 100% 100%, color-mix(in srgb, var(--ad-violet) 14%, transparent), transparent 60%); }
.nl-about > * { position: relative; }
.nl-benefits { display: flex; flex-direction: column; gap: 10px; }
.nl-benefit { display: flex; gap: 14px; align-items: flex-start; padding: 14px 16px; border-radius: 18px; background: var(--ad-surface3); border: 1px solid var(--ad-border); }
.nl-benefit > span { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 13px; color: var(--k); background: color-mix(in srgb, var(--k) 15%, transparent); }
.nl-benefit > span svg { width: 20px; height: 20px; }
.nl-benefit b { display: block; font-size: 15px; }
.nl-benefit p { margin: 3px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--ad-text-mid); }
.nl-promise { display: flex; gap: 10px; align-items: flex-start; margin-top: 18px; font-size: 13px; line-height: 1.5; color: var(--ad-text-dim); }
.nl-promise svg { width: 17px; height: 17px; color: var(--ad-green); margin-top: 1px; }
.nl-card { grid-area: card; padding: clamp(20px, 3vw, 30px); position: sticky; top: 78px; }
.nl-steps { display: flex; align-items: center; gap: 8px; margin-bottom: 22px; }
.nl-step { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; color: var(--ad-text-faint); white-space: nowrap; }
.nl-step i { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-style: normal; font-size: 11.5px; font-weight: 800; background: var(--ad-surface3); border: 1px solid var(--ad-border2); }
.nl-step.on { color: var(--ad-text); }
.nl-step.on i { color: #fff; background: linear-gradient(135deg, #0ea5e9, #6366f1); border-color: transparent; }
.nl-step.past { color: var(--ad-text-mid); }
.nl-step.past i { color: var(--ad-green); border-color: color-mix(in srgb, var(--ad-green) 45%, transparent); background: var(--ad-green-low); }
.nl-steps hr { flex: 1; min-width: 10px; height: 1px; border: 0; background: var(--ad-border2); margin: 0; }
.nl-card h2 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -.02em; }
.nl-card .nl-sub { margin: 6px 0 0; font-size: 14px; line-height: 1.55; color: var(--ad-text-mid); overflow-wrap: anywhere; }
.nl-card .nl-sub b { color: var(--ad-text); }
.nl-form { display: flex; flex-direction: column; gap: 16px; margin-top: 22px; }
.nl-form .nw-btn.is-primary { padding: 13px 18px; font-size: 15px; }
.nl-fine { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--ad-text-dim); text-align: center; }
.nl-code { position: relative; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; max-width: 360px; }
.nl-code input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; font-size: 16px; border: 0; padding: 0; cursor: text; }
.nl-box { display: grid; place-items: center; aspect-ratio: 5 / 6; border-radius: 14px; font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums;
  color: var(--ad-text); background: var(--ad-surface3); border: 1.5px solid var(--ad-border2); transition: border-color .15s, box-shadow .15s; }
.nl-box.full { border-color: color-mix(in srgb, var(--ad-sky) 45%, var(--ad-border2)); }
.nl-code:focus-within .nl-box.cur { border-color: var(--ad-sky); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ad-sky) 16%, transparent); }
.nl-code:focus-within .nl-box.cur:empty::after { content: ''; width: 2px; height: 26px; border-radius: 2px; background: var(--ad-sky); animation: nl-blink 1s steps(2) infinite; }
@keyframes nl-blink { 50% { opacity: 0; } }
.nl-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; }
.nl-done { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 8px 0 4px; }
.nl-done > svg { width: 54px; height: 54px; color: var(--ad-green); }
.nl-done .nl-links { margin-top: 12px; }
.nl-wait { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 30px 0; color: var(--ad-text-mid); font-size: 14px; }
.nl-wait svg { width: 30px; height: 30px; color: var(--ad-sky); }
@media (max-width: 900px) { .nl-grid { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'intro' 'card' 'perks'; } .nl-card { position: static; } }
@media (max-width: 420px) { .nl-step span { display: none; } .nl-box { font-size: 22px; border-radius: 12px; } .nl-code { gap: 6px; } }
`;

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
  return j;
}

/* The emailed link's check, made once per code: a page change can mount this page twice (the
   page leaving renders the new one while it animates out), and both share the one answer. */
const linkChecks = new Map();
const checkLink = (code, id) => {
  if (!linkChecks.has(code)) linkChecks.set(code, post('/api/newsletter/verify', { code, id }));
  return linkChecks.get(code);
};

/* Six boxes over one real input: typing, pasting and a phone's code suggestion all go into the
   input, so nothing depends on which key a phone keyboard reports. */
function CodeInput({ value, onChange, disabled }) {
  const ref = useRef(null);
  /* ready to type into whenever it is not busy: at first, and again after a wrong code */
  useEffect(() => { if (!disabled) ref.current?.focus(); }, [disabled]);
  return (
    <div className="nl-code">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`nl-box${value[i] ? ' full' : ''}${i === Math.min(value.length, 5) ? ' cur' : ''}`}>{value[i] || ''}</span>
      ))}
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={disabled}
        inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} aria-label="The 6-digit code from the email" />
    </div>
  );
}

function Steps({ at }) {
  return (
    <div className="nl-steps" aria-label={`Step ${at + 1} of 3: ${STEPS[at]}`}>
      {STEPS.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <hr />}
          <span className={`nl-step${i === at ? ' on' : i < at ? ' past' : ''}`}><i>{i < at ? '✓' : i + 1}</i><span>{s}</span></span>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function NewsletterSignup() {
  const [params, setParams] = useSearchParams();
  const [step, setStep] = useState(params.get('verify') ? 'linking' : 'form');   // form | verify | linking | done | already
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [subId, setSubId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const tried = useRef('');

  /* the emailed link confirms straight away; the code leaves the address bar once it is checked */
  useEffect(() => {
    const c = params.get('verify');
    if (!c) return undefined;
    let alive = true;
    checkLink(c, params.get('sub') || undefined)
      .then(() => { if (alive) setStep('done'); })
      .catch((e) => { if (alive) { setError(`${e.message} Sign up again below for a new code.`); setStep('form'); } })
      .finally(() => { if (alive) setParams({}, { replace: true }); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* the resend countdown */
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const subscribe = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await post('/api/newsletter/subscribe', { email: email.trim(), name: name.trim() });
      if (r.already) { setStep('already'); return; }
      setSubId(r.id); setCode(''); tried.current = ''; setWait(RESEND_WAIT); setStep('verify');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (c = code) => {
    if (c.length !== 6 || busy) return;
    tried.current = c;
    setBusy(true); setError('');
    try {
      await post('/api/newsletter/verify', { id: subId, code: c });
      setStep('done');
    } catch (err) {
      setError(err.message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  /* a full code is checked as soon as it is in (once: a wrong one waits for a change) */
  useEffect(() => { if (step === 'verify' && code.length === 6 && code !== tried.current) verify(code); }, [code, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const resend = async () => {
    setBusy(true); setError('');
    try {
      const r = await post('/api/newsletter/subscribe', { email: email.trim(), name: name.trim() });
      if (r.already) { setStep('already'); return; }
      setSubId(r.id); setCode(''); tried.current = ''; setWait(RESEND_WAIT);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const at = step === 'verify' ? 1 : step === 'done' || step === 'already' ? 2 : 0;

  return (
    <NewsShell title="Newsletter" css={CSS}>
      <div className="nl-grid">
        <section className="nw-glass nl-about">
          <p className="nw-eyebrow"><Mail />Free newsletter</p>
          <h1 className="nw-h1"><span>The MyWeatherUK newsletter</span></h1>
          <p className="nw-lede">The weather that matters across the UK and Ireland, written by our forecasters and sent straight to your inbox.</p>
        </section>

        <section className="nw-glass nl-perks" aria-label="What you get">
          <div className="nl-benefits">
            {BENEFITS.map(({ icon: Icon, color, title, text }) => (
              <div key={title} className="nl-benefit" style={{ '--k': color }}>
                <span><Icon /></span>
                <div><b>{title}</b><p>{text}</p></div>
              </div>
            ))}
          </div>
          <p className="nl-promise"><ShieldCheck />Free, and no spam. Your email is only used for the newsletter, and you can leave any time by replying “unsubscribe” to any issue.</p>
        </section>

        <section className="nw-glass nl-card" aria-live="polite">
          <Steps at={at} />

          {step === 'linking' && <div className="nl-wait"><Loader2 className="nw-spin" />Confirming your subscription…</div>}

          {step === 'form' && (
            <>
              <h2>Sign up</h2>
              <p className="nl-sub">We will email you a 6-digit code to make sure the address is yours.</p>
              <form className="nl-form" onSubmit={subscribe}>
                <div>
                  <label className="nw-label" htmlFor="nl-name">Your name (optional)</label>
                  <input id="nl-name" className="nw-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" autoComplete="given-name" maxLength={80} />
                </div>
                <div>
                  <label className="nw-label" htmlFor="nl-email">Email address</label>
                  <input id="nl-email" className="nw-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required maxLength={200} />
                </div>
                {error && <div className="nw-error" role="alert">{error}</div>}
                <button type="submit" className="nw-btn is-primary" disabled={busy || !email.trim()}>
                  {busy ? <><Loader2 className="nw-spin" />Sending your code…</> : <>Subscribe, it’s free<ArrowRight /></>}
                </button>
                <p className="nl-fine">By subscribing you agree to receive the MyWeatherUK newsletter by email.</p>
              </form>
            </>
          )}

          {step === 'verify' && (
            <>
              <h2>Check your email</h2>
              <p className="nl-sub">We sent a 6-digit code to <b>{email.trim()}</b>. Enter it here, or open the link in the email.</p>
              <div className="nl-form">
                <CodeInput value={code} onChange={setCode} disabled={busy} />
                {error && <div className="nw-error" role="alert">{error}</div>}
                <button type="button" className="nw-btn is-primary" onClick={() => verify()} disabled={busy || code.length !== 6}>
                  {busy ? <><Loader2 className="nw-spin" />Checking…</> : <>Confirm my subscription<ArrowRight /></>}
                </button>
                <div className="nl-links">
                  <button type="button" className="nw-btn is-quiet" onClick={resend} disabled={busy || wait > 0}><RefreshCw />{wait > 0 ? `Send a new code in ${wait} s` : 'Send a new code'}</button>
                  <button type="button" className="nw-btn is-quiet" onClick={() => { setStep('form'); setError(''); setCode(''); }} disabled={busy}><Pencil />Use a different email</button>
                </div>
                <p className="nl-fine">Nothing there? Look in your spam or junk folder. The code works for 24 hours.</p>
              </div>
            </>
          )}

          {(step === 'done' || step === 'already') && (
            <div className="nl-done">
              <CheckCircle2 />
              <h2>{step === 'done' ? 'You’re subscribed' : 'You’re already subscribed'}</h2>
              <p className="nl-sub">{step === 'done'
                ? 'Welcome to the MyWeatherUK newsletter. The next issue will come to your inbox.'
                : `${email.trim()} is already on the list, so there is nothing more to do.`}</p>
              <div className="nl-links">
                <Link to="/News" className="nw-btn"><Newspaper />Read the latest news</Link>
                <Link to="/" className="nw-btn is-quiet"><Home />Home</Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </NewsShell>
  );
}
