/* Settings: the visitor's language, look, units and emails, and their account.

   Language, theme and units are the visitor's preferences (lib/preferences): they apply on every
   page at once, are kept in this browser, and for a signed-in user with the account as well, so
   they stay put across visits and devices. Email alerts are the user's EmailNotificationPref row;
   deleting the account is DELETE /api/auth/me (server/auth.js). */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Settings as SettingsIcon, Languages, Palette, Ruler, Bell, Mail, User, Monitor, Sun, Moon, Check, Loader2, Cloud, CloudOff,
  LogOut, LogIn, UserPlus, Trash2, AlertTriangle, ArrowRight, HardDrive,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/components/ThemeContext';
import { usePreferences, LANGUAGES } from '@/lib/preferences';
import { useUnits } from '@/components/useUnits';
import { adTokens, ADMIN_FONT } from '@/components/admin/adminTheme';

const SECTIONS = [
  { id: 'language', label: 'Language', icon: Languages },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'units', label: 'Units', icon: Ruler },
  { id: 'emails', label: 'Emails', icon: Bell },
  { id: 'account', label: 'Account', icon: User },
];
const THEME_OPTIONS = [
  { id: 'system', label: 'Match my device', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];
const UNIT_ROWS = [
  { key: 'temperature', label: 'Temperature', options: [['celsius', '°C'], ['fahrenheit', '°F']] },
  { key: 'windSpeed', label: 'Wind speed', options: [['mph', 'mph'], ['kmh', 'km/h'], ['knots', 'knots'], ['ms', 'm/s']] },
  { key: 'precipitation', label: 'Rain and snow', options: [['mm', 'mm'], ['inches', 'inches']] },
  { key: 'hail', label: 'Hail size', options: [['mm', 'mm'], ['inches', 'inches']] },
];
const ALERT_LEVELS = [
  { value: 'any', label: 'Every outlook', desc: 'Any new outlook, low risk included' },
  { value: 'Marginal', label: 'Marginal or higher', desc: 'Marginal, Slight, Moderate, High, Severe' },
  { value: 'Slight', label: 'Slight or higher', desc: 'Slight, Moderate, High, Severe' },
  { value: 'Moderate', label: 'Moderate or higher', desc: 'Moderate, High, Severe' },
  { value: 'High', label: 'High or higher', desc: 'Only High and Severe' },
  { value: 'Severe', label: 'Severe only', desc: 'Only the most extreme outlooks' },
];

const CSS = `
${adTokens('.st-root', '.st-root.is-light')}
.st-root { position: relative; min-height: 100vh; min-height: 100dvh; background: var(--ad-bg); color: var(--ad-text); font-family: ${ADMIN_FONT};
  -webkit-font-smoothing: antialiased; transition: background .4s ease; overflow-x: clip; padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
.st-root *, .st-root *::before, .st-root *::after { box-sizing: border-box; }
.st-root svg { display: inline-block; flex-shrink: 0; }
.st-ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.st-ambient i { position: absolute; display: block; border-radius: 50%; }
.st-ambient i:nth-child(1) { width: 70vw; height: 70vw; top: -26vw; left: -18vw; background: radial-gradient(circle, var(--ad-orb-a), transparent 62%); }
.st-ambient i:nth-child(2) { width: 60vw; height: 60vw; top: 18vh; right: -24vw; background: radial-gradient(circle, var(--ad-orb-b), transparent 62%); }
.st-ambient i:nth-child(3) { width: 56vw; height: 56vw; bottom: -24vw; left: 18vw; background: radial-gradient(circle, var(--ad-orb-c), transparent 62%); }
.st-wrap { position: relative; z-index: 1; width: min(1080px, 100%); margin: 0 auto; padding: clamp(14px, 3vw, 28px) clamp(12px, 2.6vw, 24px) 40px; }
.st-glass { position: relative; background: var(--ad-surface); border: 1px solid var(--ad-border); border-radius: 24px;
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%); box-shadow: var(--ad-shadow), inset 0 1px 0 var(--ad-highlight); }
.st-hero { padding: clamp(20px, 3.4vw, 32px); overflow: hidden; margin-bottom: 16px; }
.st-hero::before { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: radial-gradient(110% 90% at 0% 0%, color-mix(in srgb, var(--ad-sky) 16%, transparent), transparent 55%), radial-gradient(90% 80% at 100% 0%, color-mix(in srgb, var(--ad-violet) 13%, transparent), transparent 60%); }
.st-hero > * { position: relative; }
.st-eyebrow { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--ad-sky); }
.st-eyebrow svg { width: 13px; height: 13px; }
.st-hero h1 { margin: 10px 0 0; font-size: clamp(30px, 5vw, 44px); font-weight: 800; letter-spacing: -.035em; line-height: 1.04; }
.st-hero p { margin: 10px 0 0; max-width: 640px; font-size: 15px; line-height: 1.6; color: var(--ad-text-mid); }
.st-sync { display: inline-flex; align-items: center; gap: 7px; margin-top: 16px; padding: 7px 12px; border-radius: 99px; font-size: 12.5px; font-weight: 700;
  color: var(--k); background: color-mix(in srgb, var(--k) 12%, transparent); border: 1px solid color-mix(in srgb, var(--k) 32%, transparent); }
.st-sync svg { width: 14px; height: 14px; }
.st-grid { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 16px; align-items: start; }
.st-nav { position: sticky; top: 78px; display: flex; flex-direction: column; gap: 4px; padding: 10px; }
.st-nav a { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; font-size: 14px; font-weight: 650; color: var(--ad-text-mid); text-decoration: none; }
.st-nav a svg { width: 17px; height: 17px; }
.st-nav a:hover { color: var(--ad-text); background: var(--ad-surface3); }
.st-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.st-sec { padding: clamp(18px, 2.8vw, 26px); scroll-margin-top: 80px; }
.st-sec-head { display: flex; align-items: flex-start; gap: 13px; margin-bottom: 18px; }
.st-sec-head > span { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 13px; color: var(--ad-sky); background: color-mix(in srgb, var(--ad-sky) 14%, transparent); }
.st-sec-head > span svg { width: 20px; height: 20px; }
.st-sec-head h2 { margin: 0; font-size: 19px; font-weight: 800; letter-spacing: -.015em; }
.st-sec-head p { margin: 3px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--ad-text-mid); }
.st-langs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.st-pick { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 13px 14px; border-radius: 16px; font: inherit; text-align: left; cursor: pointer;
  color: var(--ad-text); background: var(--ad-surface3); border: 1px solid var(--ad-border); transition: border-color .15s, background .15s, box-shadow .15s; }
.st-pick:hover { border-color: var(--ad-border3); }
.st-pick.on { border-color: color-mix(in srgb, var(--ad-sky) 60%, transparent); background: color-mix(in srgb, var(--ad-sky) 11%, var(--ad-surface2)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ad-sky) 45%, transparent); }
.st-pick b { font-size: 15.5px; font-weight: 750; }
.st-pick small { font-size: 12.5px; color: var(--ad-text-dim); }
.st-pick .st-tick { position: absolute; top: 10px; right: 10px; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; color: #fff; background: var(--ad-sky); }
.st-pick .st-tick svg { width: 13px; height: 13px; }
.st-themes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.st-themes .st-pick { padding: 10px; gap: 9px; }
.st-swatch { width: 100%; height: 64px; border-radius: 11px; overflow: hidden; display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--ad-border2); }
.st-swatch i { display: flex; flex-direction: column; gap: 5px; padding: 9px; }
.st-swatch i::before, .st-swatch i::after { content: ''; display: block; height: 7px; border-radius: 4px; background: currentColor; opacity: .35; }
.st-swatch i::after { width: 60%; }
.st-swatch .l { background: #eef3fb; color: #0b1220; }
.st-swatch .d { background: #0b1322; color: #e2e8f0; }
.st-pick-row { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 700; }
.st-pick-row svg { width: 15px; height: 15px; color: var(--ad-text-mid); }
.st-units { display: flex; flex-direction: column; }
.st-unit { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 0; border-top: 1px solid var(--ad-border); }
.st-unit:first-child { border-top: 0; padding-top: 0; }
.st-unit > span { font-size: 14.5px; font-weight: 650; }
.st-seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 13px; background: var(--ad-surface3); border: 1px solid var(--ad-border); flex-wrap: wrap; }
.st-seg button { font: inherit; font-size: 13px; font-weight: 700; min-width: 54px; padding: 7px 12px; border-radius: 10px; border: 0; cursor: pointer; color: var(--ad-text-mid); background: transparent; }
.st-seg button:hover { color: var(--ad-text); }
.st-seg button.on { color: #fff; background: linear-gradient(135deg, #0ea5e9, #6366f1); box-shadow: 0 6px 16px -8px rgba(14,165,233,.8); }
.st-example { margin-top: 14px; padding: 11px 14px; border-radius: 14px; font-size: 13.5px; color: var(--ad-text-mid); background: var(--ad-surface3); border: 1px dashed var(--ad-border2); }
.st-example b { color: var(--ad-text); }
.st-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.st-row b { display: block; font-size: 14.5px; }
.st-row small { display: block; margin-top: 2px; font-size: 13px; color: var(--ad-text-dim); overflow-wrap: anywhere; }
.st-switch { position: relative; width: 50px; height: 30px; flex-shrink: 0; border-radius: 99px; border: 0; cursor: pointer; background: var(--ad-border3); transition: background .2s; }
.st-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); transition: transform .2s; }
.st-switch[aria-checked='true'] { background: linear-gradient(135deg, #0ea5e9, #6366f1); }
.st-switch[aria-checked='true']::after { transform: translateX(20px); }
.st-switch:disabled { opacity: .6; cursor: wait; }
.st-levels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 16px; }
.st-levels .st-pick { padding: 10px 12px; }
.st-levels .st-pick b { font-size: 13.5px; }
.st-levels .st-pick small { font-size: 12px; }
.st-saved { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; font-size: 12.5px; font-weight: 700; color: var(--ad-green); }
.st-saved svg { width: 14px; height: 14px; }
.st-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: 13px; font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer;
  text-decoration: none; color: var(--ad-text); background: var(--ad-surface2); border: 1px solid var(--ad-border2); white-space: nowrap; transition: border-color .15s, background .15s; }
.st-btn:hover:not(:disabled) { border-color: var(--ad-border3); background: var(--ad-surface); }
.st-btn:disabled { opacity: .55; cursor: default; }
.st-btn svg { width: 16px; height: 16px; }
.st-btn.is-primary { color: #fff; border-color: transparent; background: linear-gradient(135deg, #0ea5e9, #6366f1); }
.st-btn.is-danger { color: #fff; border-color: transparent; background: #dc2626; }
.st-btn.is-danger-soft { color: var(--ad-red); background: var(--ad-red-low); border-color: color-mix(in srgb, var(--ad-red) 30%, transparent); }
.st-btns { display: flex; flex-wrap: wrap; gap: 8px; }
.st-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.st-fact { padding: 12px 14px; border-radius: 16px; background: var(--ad-surface3); border: 1px solid var(--ad-border); min-width: 0; }
.st-fact small { display: block; font-size: 10.5px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; color: var(--ad-text-dim); }
.st-fact b { display: block; margin-top: 4px; font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-danger { margin-top: 18px; padding: 16px; border-radius: 18px; background: color-mix(in srgb, var(--ad-red) 6%, transparent); border: 1px solid color-mix(in srgb, var(--ad-red) 24%, transparent); }
.st-danger b { color: var(--ad-red); font-size: 14.5px; }
.st-danger p { margin: 4px 0 12px; font-size: 13.5px; line-height: 1.5; color: var(--ad-text-mid); }
.st-note { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--ad-text-mid); }
.st-error { margin-top: 12px; padding: 10px 12px; border-radius: 12px; font-size: 13px; color: var(--ad-red); background: var(--ad-red-low); }
.st-modal { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; padding: 16px; background: rgba(2,6,15,.55); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
.st-modal .st-glass { width: min(460px, 100%); padding: 24px; background: var(--ad-bg-alt); }
.st-modal h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; font-size: 19px; }
.st-modal h3 svg { width: 22px; height: 22px; color: var(--ad-red); }
.st-modal ul { margin: 0 0 12px; padding-left: 20px; font-size: 13.5px; line-height: 1.7; color: var(--ad-text-mid); }
.st-modal .st-btns { margin-top: 18px; justify-content: flex-end; }
@media (max-width: 860px) { .st-grid { grid-template-columns: minmax(0, 1fr); } .st-nav { position: static; flex-direction: row; overflow-x: auto; padding: 6px; } .st-nav a { flex-shrink: 0; padding: 8px 12px; } }
@media (max-width: 600px) { .st-langs, .st-themes { grid-template-columns: repeat(2, minmax(0, 1fr)); } .st-levels { grid-template-columns: minmax(0, 1fr); } .st-facts { grid-template-columns: minmax(0, 1fr); } .st-unit { align-items: flex-start; flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { .st-root * { transition: none !important; } }
`;

function Section({ id, icon: Icon, title, desc, aside = null, children }) {
  return (
    <section id={id} className="st-glass st-sec" aria-labelledby={`${id}-h`}>
      <div className="st-sec-head">
        <span><Icon /></span>
        <div style={{ flex: 1 }}><h2 id={`${id}-h`}>{title}</h2>{desc && <p>{desc}</p>}</div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function SyncChip({ signedIn, sync }) {
  const [k, Icon, text] = !signedIn ? ['var(--ad-text-mid)', HardDrive, 'Saved on this device. Sign in to keep them with your account.']
    : sync === 'saving' ? ['var(--ad-sky)', Loader2, 'Saving to your account…']
      : sync === 'error' ? ['var(--ad-amber)', CloudOff, 'Saved on this device; your account could not be reached. It will try again on your next change.']
        : ['var(--ad-green)', Cloud, 'Saved to your account, on every device you sign in on.'];
  return <span className="st-sync" style={{ '--k': k }} role="status"><Icon className={sync === 'saving' && signedIn ? 'animate-spin' : undefined} />{text}</span>;
}

/* email alerts when a new severe weather outlook is published (sent by sendOutlookEmailAlert) */
function EmailAlerts({ user }) {
  const [pref, setPref] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    base44.entities.EmailNotificationPref.filter({ user_email: user.email })
      .then((rows) => { if (alive) setPref(rows?.[0] || null); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user.email]);

  const update = async (patch) => {
    setSaving(true); setError(null);
    try {
      const row = pref?.id
        ? { ...pref, ...(await base44.entities.EmailNotificationPref.update(pref.id, patch)), ...patch }
        : await base44.entities.EmailNotificationPref.create({ user_email: user.email, outlook_alerts_enabled: false, min_risk_level: 'Moderate', ...patch });
      setPref(row);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch {
      setError('That could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader2 className="animate-spin" style={{ width: 20, height: 20, color: 'var(--ad-text-dim)' }} />;
  const on = pref?.outlook_alerts_enabled ?? false;
  const level = pref?.min_risk_level ?? 'Moderate';
  return (
    <>
      <div className="st-row">
        <div><b>Outlook email alerts</b><small>Sent to {user.email} when a new severe weather outlook is published.</small></div>
        {saved && <span className="st-saved"><Check />Saved</span>}
        <button type="button" role="switch" aria-checked={on} aria-label="Outlook email alerts" className="st-switch" disabled={saving} onClick={() => update({ outlook_alerts_enabled: !on })} />
      </div>
      {on && (
        <div className="st-levels" role="radiogroup" aria-label="Which outlooks to email">
          {ALERT_LEVELS.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={level === o.value} className={`st-pick${level === o.value ? ' on' : ''}`} disabled={saving}
              onClick={() => update({ min_risk_level: o.value })}>
              <b>{o.label}</b><small>{o.desc}</small>
            </button>
          ))}
        </div>
      )}
      {error && <div className="st-error" role="alert">{error}</div>}
    </>
  );
}

function DeleteDialog({ onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [busy, onClose]);
  const remove = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/me', { method: 'DELETE', headers: { Authorization: `Bearer ${base44.auth.getToken()}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The account could not be deleted.');
      base44.auth.logout('/');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="st-modal" role="dialog" aria-modal="true" aria-labelledby="st-del-h" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="st-glass">
        <h3 id="st-del-h"><AlertTriangle />Delete your account?</h3>
        <p className="st-note">This permanently removes:</p>
        <ul><li>your account and sign-in</li><li>your email alerts and saved graphics</li><li>your saved places and search history</li></ul>
        <p className="st-note"><b>This cannot be undone.</b></p>
        {error && <div className="st-error" role="alert">{error}</div>}
        <div className="st-btns">
          <button type="button" className="st-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="st-btn is-danger" onClick={remove} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Trash2 />}Yes, delete my account</button>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { isDark } = useTheme();
  const { user, isLoadingAuth } = useAuth();
  const { prefs, setPref, sync } = usePreferences();
  const U = useUnits();
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { document.title = 'Settings · MyWeatherUK'; }, []);

  const jump = (e, id) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  return (
    <div className={`st-root${isDark ? '' : ' is-light'}`}>
      <style>{CSS}</style>
      <div className="st-ambient" aria-hidden="true"><i /><i /><i /></div>
      <main className="st-wrap">
        <header className="st-glass st-hero">
          <p className="st-eyebrow"><SettingsIcon />MyWeatherUK</p>
          <h1>Settings</h1>
          <p>Your language, look and units apply on every page straight away, and stay as you set them.</p>
          <SyncChip signedIn={!!user} sync={sync} />
        </header>

        <div className="st-grid">
          <nav className="st-glass st-nav" aria-label="Settings sections">
            {SECTIONS.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} onClick={(e) => jump(e, id)}><Icon />{label}</a>)}
          </nav>

          <div className="st-main">
            <Section id="language" icon={Languages} title="Language" desc="The whole site, in the language you choose.">
              <div className="st-langs" role="radiogroup" aria-label="Language">
                {LANGUAGES.map((l) => {
                  const on = prefs.language === l.code;
                  return (
                    <button key={l.code} type="button" role="radio" aria-checked={on} className={`st-pick${on ? ' on' : ''}`} onClick={() => setPref('language', l.code)} lang={l.code}>
                      <b translate="no" className="notranslate">{l.label}</b>
                      <small>{l.english}</small>
                      {on && <span className="st-tick"><Check /></span>}
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section id="appearance" icon={Palette} title="Appearance" desc="Light, dark, or the same as your device.">
              <div className="st-themes" role="radiogroup" aria-label="Theme">
                {THEME_OPTIONS.map(({ id, label, icon: Icon }) => {
                  const on = prefs.theme === id;
                  return (
                    <button key={id} type="button" role="radio" aria-checked={on} className={`st-pick${on ? ' on' : ''}`} onClick={() => setPref('theme', id)}>
                      <span className="st-swatch" aria-hidden="true">
                        <i className={id === 'dark' ? 'd' : 'l'} /><i className={id === 'light' ? 'l' : 'd'} />
                      </span>
                      <span className="st-pick-row"><Icon />{label}</span>
                      {on && <span className="st-tick"><Check /></span>}
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section id="units" icon={Ruler} title="Units" desc="Used for every temperature, wind speed and amount on the site.">
              <div className="st-units">
                {UNIT_ROWS.map((row) => (
                  <div key={row.key} className="st-unit">
                    <span>{row.label}</span>
                    <div className="st-seg" role="radiogroup" aria-label={row.label}>
                      {row.options.map(([value, label]) => (
                        <button key={value} type="button" role="radio" aria-checked={U.units[row.key] === value} className={U.units[row.key] === value ? 'on' : ''}
                          onClick={() => U.updateUnit(row.key, value)}>{label}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="st-example">For example: <b>{U.fmtTemp(18)}</b>, wind <b>{U.fmtWind(12)}</b> gusting <b>{U.fmtWind(31)}</b>, <b>{U.fmtRain(4.6)}</b> of rain and hail up to <b>{U.fmtHail(25)}</b>.</div>
            </Section>

            <Section id="emails" icon={Bell} title="Emails" desc="Outlook alerts and the newsletter.">
              {isLoadingAuth ? <Loader2 className="animate-spin" style={{ width: 20, height: 20, color: 'var(--ad-text-dim)' }} />
                : user ? <EmailAlerts user={user} />
                  : <p className="st-note">Sign in to get an email when a new severe weather outlook is published.</p>}
              <div className="st-row" style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--ad-border)' }}>
                <div><b>The MyWeatherUK newsletter</b><small>Storm outlooks, forecast stories and high-risk alerts. Free.</small></div>
                <Link to="/NewsletterSignup" className="st-btn"><Mail />Newsletter<ArrowRight /></Link>
              </div>
            </Section>

            <Section id="account" icon={User} title="Account" desc={user ? 'Signed in.' : 'Sign in to keep your settings with your account and get email alerts.'}>
              {isLoadingAuth ? <Loader2 className="animate-spin" style={{ width: 20, height: 20, color: 'var(--ad-text-dim)' }} />
                : user ? (
                  <>
                    <div className="st-facts">
                      <div className="st-fact"><small>Name</small><b>{user.full_name || '—'}</b></div>
                      <div className="st-fact"><small>Email</small><b translate="no">{user.email}</b></div>
                      <div className="st-fact"><small>Account</small><b>{user.role === 'admin' ? 'Administrator' : 'Member'}</b></div>
                    </div>
                    <div className="st-btns">
                      <button type="button" className="st-btn" onClick={() => base44.auth.logout('/')}><LogOut />Sign out</button>
                    </div>
                    {user.role !== 'admin' && (
                      <div className="st-danger">
                        <b>Delete your account</b>
                        <p>Removes your account, your email alerts and your saved graphics and places for good.</p>
                        <button type="button" className="st-btn is-danger-soft" onClick={() => setDeleting(true)}><Trash2 />Delete my account</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="st-btns">
                    <Link to="/login" className="st-btn is-primary"><LogIn />Sign in</Link>
                    <Link to="/register" className="st-btn"><UserPlus />Create an account</Link>
                  </div>
                )}
            </Section>
          </div>
        </div>
      </main>
      {deleting && <DeleteDialog onClose={() => setDeleting(false)} />}
    </div>
  );
}
