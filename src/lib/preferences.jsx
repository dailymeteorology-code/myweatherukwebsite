/* A visitor's display preferences, in one place: the language, the theme and the units.

   They are kept in this browser (localStorage 'mwuk_prefs') so they apply at once on every page
   and every visit, and, for a signed-in user, with the account too (PUT /api/auth/me/preferences),
   so they follow the user to any device. On load the account's copy wins; a change is saved to
   both. Other open tabs follow along.

   Everything that shows a temperature, a speed or an amount reads the units from here (useUnits),
   the theme reads its choice from here (ThemeContext), and the language drives the site's
   translator (lib/i18n). */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const KEY = 'mwuk_prefs';
const TOKEN_KEY = 'base44_access_token';

/* the choices (server/auth.js checks against the same lists) */
export const LANGUAGES = [
  { code: 'en', label: 'English', english: 'English' },
  { code: 'es', label: 'Español', english: 'Spanish' },
  { code: 'pl', label: 'Polski', english: 'Polish' },
  { code: 'zh', label: '中文', english: 'Chinese' },
  { code: 'fr', label: 'Français', english: 'French' },
  { code: 'de', label: 'Deutsch', english: 'German' },
];
export const THEMES = ['system', 'light', 'dark'];
export const UNIT_CHOICES = {
  temperature: ['celsius', 'fahrenheit'],
  windSpeed: ['mph', 'kmh', 'knots', 'ms'],
  precipitation: ['mm', 'inches'],
  hail: ['mm', 'inches'],
};
export const DEFAULTS = {
  language: 'en',
  theme: 'dark',
  units: { temperature: 'celsius', windSpeed: 'mph', precipitation: 'mm', hail: 'mm' },
};

/** Only the known keys and values, over the defaults. */
function clean(p) {
  const out = { ...DEFAULTS, units: { ...DEFAULTS.units } };
  if (!p || typeof p !== 'object') return out;
  if (LANGUAGES.some((l) => l.code === p.language)) out.language = p.language;
  if (THEMES.includes(p.theme)) out.theme = p.theme;
  for (const [k, ok] of Object.entries(UNIT_CHOICES)) if (ok.includes(p.units?.[k])) out.units[k] = p.units[k];
  return out;
}

/* Saved before this store existed, under four separate keys: read once, then removed. */
function fromOldKeys() {
  const ls = window.localStorage;
  const old = {};
  try { const u = JSON.parse(ls.getItem('weatherUnits') || 'null'); if (u) old.units = u; } catch { /* unreadable */ }
  const lang = ls.getItem('mwuk_lang');
  if (lang) old.language = lang;
  const theme = ls.getItem('theme');
  if (theme === 'true' || theme === 'dark') old.theme = 'dark';
  else if (theme === 'false' || theme === 'light') old.theme = 'light';
  if (!old.units && ls.getItem('lw-unit') === 'F') old.units = { temperature: 'fahrenheit' };
  for (const k of ['weatherUnits', 'mwuk_lang', 'theme', 'lw-unit']) ls.removeItem(k);
  return old;
}

function readLocal() {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved) return clean(JSON.parse(saved));
    const migrated = clean(fromOldKeys());
    window.localStorage.setItem(KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return clean(null);
  }
}
const writeLocal = (p) => { try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ } };
const token = () => { try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; } };

const PreferencesContext = createContext(null);

export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(readLocal);
  const current = useRef(prefs);
  current.current = prefs;
  /* 'local' (this browser only), 'account' (also saved with the account), 'saving', 'error' */
  const [sync, setSync] = useState('local');
  const signedIn = useRef(false);
  const timer = useRef(null);

  /* signed in: the account's preferences win; an account without any takes this browser's */
  useEffect(() => {
    const t = token();
    if (!t) return;
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (!me) return;
        signedIn.current = true;
        if (me.preferences) {
          const p = clean(me.preferences);
          setPrefs(p);
          writeLocal(p);
          setSync('account');
        } else {
          save(readLocal());
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* another tab changed them */
  useEffect(() => {
    const onStorage = (e) => { if (e.key === KEY && e.newValue) { try { setPrefs(clean(JSON.parse(e.newValue))); } catch { /* unreadable */ } } };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const save = useCallback((p) => {
    if (!signedIn.current) return;
    clearTimeout(timer.current);
    setSync('saving');
    timer.current = setTimeout(() => {
      fetch('/api/auth/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ preferences: p }),
      }).then((r) => setSync(r.ok ? 'account' : 'error')).catch(() => setSync('error'));
    }, 350);
  }, []);

  /** Change one preference: 'language', 'theme', or a unit as 'units.windSpeed'. */
  const setPref = useCallback((key, value) => {
    const prev = current.current;
    const next = key.startsWith('units.')
      ? clean({ ...prev, units: { ...prev.units, [key.slice(6)]: value } })
      : clean({ ...prev, [key]: value });
    current.current = next;
    setPrefs(next);
    writeLocal(next);
    save(next);
  }, [save]);

  const value = useMemo(() => ({ prefs, setPref, sync }), [prefs, setPref, sync]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const c = useContext(PreferencesContext);
  if (!c) throw new Error('usePreferences must be used inside PreferencesProvider');
  return c;
}
