import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX, Settings2, Repeat, Bell, BellOff, MapPin, Locate, X, Loader2 } from 'lucide-react';
import { SEV, SEV_ORDER, aiwGet, fmtAt } from './aiwClient';

const PREFS_KEY = 'aiw_voice_prefs_v1';
const PLAYED_KEY = 'aiw_played_v1';
const HOME_KEY = 'aiw_home_v1';

const DEFAULT_PREFS = {
  enabled: false, muted: false, voiceURI: '', rate: 1, volume: 1,
  severities: ['yellow', 'amber', 'red'], continent: '', country: '',
  homeOnly: false, homeRadiusKm: 75, repeatEscalations: true, notifications: false,
};

function loadJSON(key, fallback) { try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || 'null') }; } catch { return { ...fallback }; } }
function loadPlayed() { try { return new Set(JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]')); } catch { return new Set(); } }
function savePlayed(set) { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...set].slice(-600))); } catch { /* ignore */ } }

function haversine(a, b, c, d) {
  const R = 6371; const dLat = ((c - a) * Math.PI) / 180; const dLon = ((d - b) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** A short attention tone before speech — distinct per severity, never a siren. */
function chime(ctxRef, severity, volume) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.resolve();
    if (!ctxRef.current || ctxRef.current.state === 'closed') ctxRef.current = new AC();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const notes = severity === 'red' ? [880, 660, 880, 660] : severity === 'amber' ? [784, 587, 784] : [659, 523];
    const t0 = ctx.currentTime + 0.02;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.18 * volume, t0 + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + i * 0.22); o.stop(t0 + i * 0.22 + 0.21);
    });
    return new Promise((r) => setTimeout(r, notes.length * 220 + 150));
  } catch { return Promise.resolve(); }
}

/**
 * Voice announcements for the AI lightning warnings.
 *
 * BROWSER RULES. Browsers refuse to make sound until the user has interacted
 * with the page, so voice is OFF until "Enable voice alerts" is pressed; that
 * press is also used to unlock speech and audio. If the browser has no speech
 * synthesis at all, the control says so instead of pretending.
 *
 * NO REPEATS. Every announcement has a server-issued id. Played ids are kept in
 * localStorage, and only announcements created after this page was opened are
 * ever spoken — so a refresh, a reconnect or a second tab does not replay
 * anything, and nothing issued while the site was closed is spoken late (those
 * appear in the transcript, marked "not spoken").
 *
 * PRIORITY. Red announcements jump the queue and interrupt a lower-severity
 * one already speaking.
 */
function VoiceAlerts({ subscribe, lightMode, coverage, onShowWarning }) {
  const [prefs, setPrefs] = useState(() => loadJSON(PREFS_KEY, DEFAULT_PREFS));
  const [voices, setVoices] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [speaking, setSpeaking] = useState(null);
  const [home, setHome] = useState(() => loadJSON(HOME_KEY, { name: '', lat: null, lon: null }));
  const [homeStatus, setHomeStatus] = useState(null);
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const openedAt = useRef(Date.now());
  const sinceRef = useRef(Date.now());
  const played = useRef(loadPlayed());
  const seenHere = useRef(new Set()); // this tab only — see poll()
  const queue = useRef([]);
  const busy = useRef(false);
  const audioCtx = useRef(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const homeRef = useRef(home);
  homeRef.current = home;

  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);
  useEffect(() => { try { localStorage.setItem(HOME_KEY, JSON.stringify(home)); } catch { /* ignore */ } }, [home]);

  useEffect(() => {
    if (!supported) return undefined;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)));
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, [supported]);

  /* ── which announcements this user wants ── */
  const wants = useCallback((a) => {
    const p = prefsRef.current;
    if (!p.severities.includes(a.severity)) return false;
    if (a.kind === 'escalated' && !p.repeatEscalations) return false;
    if (p.continent && a.continent !== p.continent) return false;
    if (p.country && a.country !== p.country) return false;
    if (p.homeOnly) {
      const h = homeRef.current;
      if (h.lat == null || !a.centroid) return false;
      if (haversine(h.lat, h.lon, a.centroid[0], a.centroid[1]) > p.homeRadiusKm) return false;
    }
    return true;
  }, []);

  const speakNext = useCallback(async () => {
    if (busy.current) return;
    const p = prefsRef.current;
    const next = queue.current.shift();
    if (!next) return;
    busy.current = true;
    setSpeaking(next);
    await chime(audioCtx, next.severity, p.volume);
    await new Promise((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(next.text);
        const v = window.speechSynthesis.getVoices().find((x) => x.voiceURI === p.voiceURI)
          || window.speechSynthesis.getVoices().find((x) => /en-GB/i.test(x.lang)) || null;
        if (v) u.voice = v;
        u.lang = v?.lang || 'en-GB';
        u.rate = p.rate; u.volume = p.volume; u.pitch = 1;
        u.onend = resolve; u.onerror = resolve;
        window.speechSynthesis.speak(u);
      } catch { resolve(); }
    });
    busy.current = false;
    setSpeaking(null);
    speakNext();
  }, []);

  const enqueue = useCallback((a) => {
    const p = prefsRef.current;
    if (!p.enabled || p.muted || !supported) return false;
    if (a.priority >= 3 || a.severity === 'red') {
      // Red goes first, and interrupts anything less serious already speaking.
      queue.current.unshift(a);
      if (busy.current && speaking && SEV[speaking.severity]?.level < 3) window.speechSynthesis.cancel();
    } else {
      queue.current.push(a);
    }
    queue.current.sort((x, y) => (y.priority || 0) - (x.priority || 0));
    speakNext();
    return true;
  }, [speakNext, speaking, supported]);

  const notify = useCallback((a) => {
    const p = prefsRef.current;
    if (!p.notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(`${SEV[a.severity].label} lightning warning`, { body: a.text, tag: a.warningId, renotify: a.kind === 'escalated' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* some browsers only allow notifications from a service worker */ }
  }, []);

  /* ── fetch new announcements whenever the server says something changed ── */
  const poll = useCallback(async () => {
    try {
      const j = await aiwGet('/announcements', { since: sinceRef.current - 1 });
      /* Two separate "seen" records:
           - THIS TAB's, in memory: drives the pop-up and the transcript, so
             every open tab shows every new warning;
           - the SHARED one, in localStorage: drives only the VOICE, so two
             open tabs never both speak the same warning.
         These used to be one shared list, so a background tab could claim
         an announcement first and the tab you were looking at showed
         nothing at all. */
      const items = (j.items || []).filter((a) => !seenHere.current.has(a.id));
      if (!items.length) return;
      sinceRef.current = Math.max(sinceRef.current, ...items.map((a) => a.at));
      const sharedPlayed = loadPlayed();
      const entries = [];
      for (const a of items) {
        seenHere.current.add(a.id);
        const fresh = a.at >= openedAt.current - 5000; // created while this page was open
        const wanted = wants(a);
        let spoken = false;
        if (fresh && wanted && !sharedPlayed.has(a.id)) {
          sharedPlayed.add(a.id); savePlayed(sharedPlayed); // claim it before speaking
          spoken = enqueue(a);
          notify(a);
        }
        played.current.add(a.id);
        // On-screen pop-up for every new or upgraded warning the user wants —
        // independent of whether voice is on.
        if (fresh && wanted && (a.kind === 'issued' || a.kind === 'escalated')) {
          setToasts((ts) => [a, ...ts.filter((x) => x.warningId !== a.warningId)].slice(0, 3));
          if (a.severity !== 'red') setTimeout(() => dismiss(a.id), a.severity === 'amber' ? 20000 : 14000);
        }
        entries.push({ ...a, spoken, fresh, wanted });
      }
      setTranscript((t) => [...entries.reverse(), ...t].slice(0, 60));
    } catch { /* the live hook already surfaces connectivity problems */ }
  }, [enqueue, notify, wants, dismiss]);

  /* Seed the transcript ONCE, with history from before this page opened
     (marked "not spoken" — it is never played). This used to share an effect
     with the live subscription, so it re-ran whenever a callback changed and
     marked brand-new announcements as already seen — silencing exactly the
     pop-ups and voice it existed to deliver. Only announcements created
     before the page opened are seeded now. */
  useEffect(() => {
    const opened = openedAt.current;
    aiwGet('/announcements', { since: opened - 45 * 60e3 }).then((j) => {
      const items = (j.items || []).filter((a) => a.at < opened - 5000).slice(-15).reverse()
        .map((a) => ({ ...a, spoken: false, fresh: false, wanted: wants(a) }));
      for (const a of items) seenHere.current.add(a.id);
      setTranscript((t) => [...t, ...items.filter((x) => !t.some((y) => y.id === x.id))]);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live: always call the LATEST poll, without re-subscribing.
  const pollRef = useRef(poll);
  pollRef.current = poll;
  useEffect(() => {
    const off = subscribe?.((msg) => { if (msg.type === 'cycle') pollRef.current(); });
    const iv = setInterval(() => pollRef.current(), 90000); // belt and braces if the stream drops
    return () => { off?.(); clearInterval(iv); };
  }, [subscribe]);

  /* ── home location ── */
  const checkHome = useCallback(async () => {
    const h = homeRef.current;
    if (h.lat == null) { setHomeStatus(null); return; }
    try { setHomeStatus(await aiwGet('/check', { lat: h.lat, lon: h.lon })); } catch { /* ignore */ }
  }, []);
  useEffect(() => { checkHome(); const off = subscribe?.((m) => { if (m.type === 'cycle') checkHome(); }); return () => off?.(); }, [checkHome, subscribe, home.lat, home.lon]);

  /* ── controls ── */
  const enable = () => {
    if (!supported) return;
    // This click is the user gesture browsers require: prime speech and audio.
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance('Voice alerts are on.'); u.volume = prefs.volume; u.rate = prefs.rate; window.speechSynthesis.speak(u); } catch { /* ignore */ }
    chime(audioCtx, 'yellow', prefs.volume * 0.6);
    setPrefs((p) => ({ ...p, enabled: true, muted: false }));
  };
  const toggleMute = () => {
    setPrefs((p) => ({ ...p, muted: !p.muted }));
    if (!prefs.muted) { queue.current = []; try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
  };
  const repeatLast = () => {
    const last = transcript.find((t) => t.wanted) || transcript[0];
    if (!last) return;
    queue.current.unshift({ ...last, id: `${last.id}-repeat-${Date.now()}` });
    speakNext();
  };
  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    setPrefs((p) => ({ ...p, notifications: perm === 'granted' && !p.notifications }));
  };

  // Indicator: one clear state.
  let state; let stateColor;
  if (!supported) { state = 'Voice unavailable in this browser'; stateColor = 'var(--ink-3)'; }
  else if (!prefs.enabled) { state = 'Voice alerts off'; stateColor = 'var(--ink-3)'; }
  else if (prefs.muted) { state = 'Voice muted'; stateColor = lightMode ? '#B05E00' : '#FF9800'; }
  else if (speaking) { state = `Speaking: ${SEV[speaking.severity].label} warning`; stateColor = lightMode ? '#047857' : '#34d399'; }
  else { state = 'Voice alerts on'; stateColor = lightMode ? '#047857' : '#34d399'; }

  const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700, background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)' };

  return (
    <div className="lg-pane" style={{ borderRadius: 20, padding: '12px 15px' }}>
      <WarningToasts toasts={toasts} dismiss={dismiss} onShowWarning={onShowWarning} lightMode={lightMode} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {!prefs.enabled ? (
          <button type="button" onClick={enable} disabled={!supported}
            style={{ ...btn, background: supported ? '#FF9800' : 'var(--glass-fill)', color: supported ? '#1F1200' : 'var(--ink-3)', border: 'none', cursor: supported ? 'pointer' : 'not-allowed' }}>
            <Volume2 style={{ width: 14, height: 14 }} /> Enable voice alerts
          </button>
        ) : (
          <button type="button" onClick={toggleMute} aria-pressed={prefs.muted} style={btn}>
            {prefs.muted ? <VolumeX style={{ width: 14, height: 14 }} /> : <Volume2 style={{ width: 14, height: 14 }} />}
            {prefs.muted ? 'Unmute' : 'Mute'}
          </button>
        )}
        <span role="status" aria-live="polite" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 700, color: stateColor }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: stateColor }} aria-hidden="true" /> {state}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={repeatLast} disabled={!transcript.length || !prefs.enabled || prefs.muted} style={{ ...btn, opacity: !transcript.length || !prefs.enabled || prefs.muted ? 0.5 : 1 }}>
          <Repeat style={{ width: 13, height: 13 }} /> Repeat last
        </button>
        <button type="button" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings} style={btn}>
          <Settings2 style={{ width: 13, height: 13 }} /> Alert settings
        </button>
      </div>

      {/* Home location */}
      <HomeLocation home={home} setHome={setHome} status={homeStatus} lightMode={lightMode} coverage={coverage} />

      {showSettings && (
        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 13, background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)', display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 5 }}>Announce</legend>
            {SEV_ORDER.slice().reverse().map((k) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', color: 'var(--ink-1)', marginBottom: 3 }}>
                <input type="checkbox" checked={prefs.severities.includes(k)}
                  onChange={(e) => setPrefs((p) => ({ ...p, severities: e.target.checked ? [...p.severities, k] : p.severities.filter((x) => x !== k) }))} />
                {SEV[k].label} warnings
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', color: 'var(--ink-1)' }}>
              <input type="checkbox" checked={prefs.repeatEscalations} onChange={(e) => setPrefs((p) => ({ ...p, repeatEscalations: e.target.checked }))} />
              Announce upgrades (e.g. yellow → amber)
            </label>
          </fieldset>
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 5 }}>Where</legend>
            <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--ink-2)', marginBottom: 4 }}>Continent
              <select value={prefs.continent} onChange={(e) => setPrefs((p) => ({ ...p, continent: e.target.value }))} style={{ display: 'block', width: '100%', marginTop: 2, padding: '5px 7px', borderRadius: 8, background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)', fontFamily: 'inherit' }}>
                <option value="">Anywhere</option>
                {['Europe', 'North America', 'South America', 'Asia', 'Africa', 'Oceania'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', color: 'var(--ink-1)', marginTop: 4 }}>
              <input type="checkbox" checked={prefs.homeOnly} disabled={home.lat == null} onChange={(e) => setPrefs((p) => ({ ...p, homeOnly: e.target.checked }))} />
              Only within
              <input type="number" min={10} max={500} step={5} value={prefs.homeRadiusKm} onChange={(e) => setPrefs((p) => ({ ...p, homeRadiusKm: Math.max(10, Math.min(500, Number(e.target.value) || 75)) }))}
                style={{ width: 56, padding: '2px 4px', borderRadius: 6, background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)' }} aria-label="Radius in kilometres" />
              km of my location
            </label>
          </fieldset>
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 5 }}>Voice</legend>
            <select value={prefs.voiceURI} onChange={(e) => setPrefs((p) => ({ ...p, voiceURI: e.target.value }))} aria-label="Voice"
              style={{ width: '100%', padding: '5px 7px', borderRadius: 8, background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)', fontFamily: 'inherit', marginBottom: 6 }}>
              <option value="">Default English voice</option>
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
            <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--ink-2)' }}>Speed {prefs.rate.toFixed(1)}×
              <input type="range" min={0.6} max={1.5} step={0.1} value={prefs.rate} onChange={(e) => setPrefs((p) => ({ ...p, rate: Number(e.target.value) }))} style={{ width: '100%' }} />
            </label>
            <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--ink-2)' }}>Volume {Math.round(prefs.volume * 100)}%
              <input type="range" min={0.1} max={1} step={0.05} value={prefs.volume} onChange={(e) => setPrefs((p) => ({ ...p, volume: Number(e.target.value) }))} style={{ width: '100%' }} />
            </label>
          </fieldset>
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 5 }}>Notifications</legend>
            <button type="button" onClick={requestNotifications} style={{ ...btn, width: '100%', justifyContent: 'center' }}
              disabled={typeof Notification === 'undefined'}>
              {prefs.notifications ? <Bell style={{ width: 13, height: 13 }} /> : <BellOff style={{ width: 13, height: 13 }} />}
              {typeof Notification === 'undefined' ? 'Not supported here' : prefs.notifications ? 'Browser notifications on' : 'Turn on browser notifications'}
            </button>
            <p style={{ margin: '6px 0 0', fontSize: '0.62rem', lineHeight: 1.45, color: 'var(--ink-3)' }}>
              Voice and notifications only work while this page is open. Nothing is spoken or sent while the site is closed.
            </p>
            {prefs.enabled && (
              <button type="button" onClick={() => { setPrefs((p) => ({ ...p, enabled: false })); queue.current = []; try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }}
                style={{ ...btn, marginTop: 6, width: '100%', justifyContent: 'center' }}>Turn voice alerts off</button>
            )}
          </fieldset>
        </div>
      )}

      {/* Transcript — every announcement as text, for accessibility and for anyone with sound off. */}
      {!!transcript.length && (
        <details style={{ marginTop: 9 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, color: 'var(--ink-2)' }}>Announcement transcript ({transcript.length})</summary>
          <ol style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, maxHeight: 220, overflowY: 'auto' }} aria-live="polite">
            {transcript.map((t) => (
              <li key={t.id} style={{ display: 'flex', gap: 8, padding: '5px 0', borderTop: '1px solid var(--glass-hairline)', fontSize: '0.72rem', color: 'var(--ink-1)' }}>
                <span style={{ flexShrink: 0, width: 6, borderRadius: 3, background: SEV[t.severity]?.color }} aria-hidden="true" />
                <span style={{ flexShrink: 0, fontFamily: 'ui-monospace, monospace', color: 'var(--ink-3)' }}>{fmtAt(t.at)}</span>
                <span style={{ flex: 1 }}>
                  {t.text}
                  <span style={{ color: 'var(--ink-3)' }}> {t.spoken ? '· spoken' : t.fresh ? (t.wanted ? '· not spoken (voice off/muted)' : '· filtered by your settings') : '· issued before this page opened — not spoken'}</span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/**
 * Pop-ups for new and upgraded warnings. Top-right, below the navigation,
 * stacking up to three. Red stays until dismissed (and is announced as an
 * alert to screen readers); yellow and amber dismiss themselves.
 */
function WarningToasts({ toasts, dismiss, onShowWarning, lightMode }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position: 'fixed', top: 'calc(70px + env(safe-area-inset-top, 0px))', right: 14, zIndex: 10050, display: 'flex', flexDirection: 'column', gap: 8, width: 'min(360px, calc(100vw - 28px))' }}>
      {toasts.map((t) => {
        const s = SEV[t.severity];
        return (
          <div key={t.id} role={t.severity === 'red' ? 'alert' : 'status'}
            style={{
              display: 'flex', gap: 10, padding: '11px 12px', borderRadius: 16,
              background: 'var(--glass-fill-strong)', border: `1.5px solid ${s.color}`, borderLeft: `6px solid ${s.color}`,
              backdropFilter: 'blur(22px) saturate(180%)', WebkitBackdropFilter: 'blur(22px) saturate(180%)',
              boxShadow: 'var(--glass-shadow)', animation: 'aiwToastIn .28s ease-out',
            }}>
            <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 9, background: s.color, color: s.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
              <s.Icon style={{ width: 17, height: 17 }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, color: 'var(--ink-1)' }}>
                {t.isTest ? 'TEST — ' : ''}{s.label} lightning warning {t.kind === 'escalated' ? 'upgraded' : 'issued'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '0.72rem', lineHeight: 1.45, color: 'var(--ink-2)' }}>{t.text}</p>
              <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                {onShowWarning && (
                  <button type="button" onClick={() => { onShowWarning(t.warningId); dismiss(t.id); }}
                    style={{ padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 700, background: s.color, color: s.ink, border: 'none' }}>
                    Show on map
                  </button>
                )}
                <button type="button" onClick={() => dismiss(t.id)}
                  style={{ padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 700, background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)' }}>
                  Dismiss
                </button>
              </div>
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Close" style={{ alignSelf: 'flex-start', padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}><X style={{ width: 14, height: 14 }} /></button>
          </div>
        );
      })}
      <style>{'@keyframes aiwToastIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion: reduce){@keyframes aiwToastIn{from{opacity:1}to{opacity:1}}}'}</style>
      {void lightMode}
    </div>
  );
}

/** Pick a home location and see whether any warning covers it or is heading for it. */
function HomeLocation({ home, setHome, status, lightMode, coverage }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [geoErr, setGeoErr] = useState(null);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => aiwGet('/places', { q }).then((j) => setResults(j.items || [])).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  const locate = () => {
    if (!navigator.geolocation) { setGeoErr('Location is not available in this browser.'); return; }
    setBusy(true); setGeoErr(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { setHome({ name: 'My location', lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) }); setBusy(false); },
      (e) => { setGeoErr(e.code === 1 ? 'Location permission was declined.' : 'Could not get your location.'); setBusy(false); },
      { timeout: 10000, maximumAge: 600000 },
    );
  };
  const over = status?.over || []; const approaching = status?.approaching || [];
  const top = over[0] || approaching[0];
  return (
    <div style={{ marginTop: 9, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <MapPin style={{ width: 14, height: 14, color: 'var(--ink-3)' }} aria-hidden="true" />
      {home.lat == null ? (
        <>
          <div style={{ position: 'relative', flex: '1 1 200px' }}>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Set your location — search a town…" aria-label="Search for your location"
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: 9, fontSize: '0.74rem', fontFamily: 'inherit', background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)' }} />
            {!!results.length && (
              <ul role="listbox" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', margin: '3px 0 0', padding: 4, listStyle: 'none', borderRadius: 10, background: 'var(--glass-fill-strong)', border: '1px solid var(--glass-hairline)', boxShadow: 'var(--glass-shadow)', backdropFilter: 'blur(18px)' }}>
                {results.map((p) => (
                  <li key={`${p.name}${p.lat}`}>
                    <button type="button" onClick={() => { setHome({ name: `${p.name}, ${p.admin1 || p.country}`, lat: p.lat, lon: p.lon }); setQ(''); setResults([]); }}
                      style={{ width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 7, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.74rem', color: 'var(--ink-1)' }}>
                      {p.name} <span style={{ color: 'var(--ink-3)' }}>{[p.admin2, p.admin1, p.country].filter(Boolean).join(', ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" onClick={locate} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700, background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)' }}>
            {busy ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 0.9s linear infinite' }} /> : <Locate style={{ width: 12, height: 12 }} />} Use my location
          </button>
          {geoErr && <span style={{ fontSize: '0.68rem', color: 'var(--ink-3)' }}>{geoErr}</span>}
        </>
      ) : (
        <>
          <span style={{ fontSize: '0.74rem', color: 'var(--ink-1)', fontWeight: 700 }}>{home.name}</span>
          <span role="status" style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 9px', borderRadius: 99,
            background: top ? SEV[top.severity].color : 'var(--glass-fill)', color: top ? SEV[top.severity].ink : 'var(--ink-2)', border: top ? 'none' : '1px solid var(--glass-hairline)' }}>
            {over.length ? `${SEV[over[0].severity].label} warning in force here until ${fmtAt(over[0].expiresAt, over[0].tz)}`
              : approaching.length ? `${SEV[approaching[0].severity].label} warning forecast to reach here in ~${approaching[0].arrivesInMin} min`
              : status?.coverage === 'none' ? 'Not covered by AI warnings here'
              : status ? 'No AI lightning warning here' : 'Checking…'}
          </span>
          {status?.coverage === 'partial' && <span style={{ fontSize: '0.66rem', color: 'var(--ink-3)' }}>partial lightning-network coverage</span>}
          <button type="button" onClick={() => setHome({ name: '', lat: null, lon: null })} aria-label="Clear my location"
            style={{ padding: 4, borderRadius: 7, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}><X style={{ width: 13, height: 13 }} /></button>
        </>
      )}
    </div>
  );
}

/* Memoised: the Lightning page re-renders every second with fresh counters;
   this panel only needs to when its own props change. */
export default React.memo(VoiceAlerts);
