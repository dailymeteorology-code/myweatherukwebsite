/* The visitor's language (lib/preferences) on every page: its dictionary is loaded when it is
   chosen (each language is its own small file, so English visitors download none) and handed to
   the translator, which keeps the page in that language until the choice changes. */
import { useEffect } from 'react';
import { usePreferences, LANGUAGES } from '@/lib/preferences';
import { applyLanguage } from './translator';

const dictionaries = import.meta.glob('./strings/*.json');

export function LanguageSync() {
  const { prefs } = usePreferences();
  const code = prefs.language;
  useEffect(() => {
    const load = dictionaries[`./strings/${code}.json`];
    if (code === 'en' || !load) { applyLanguage(null, 'en'); return undefined; }
    let alive = true;
    load().then((m) => { if (alive) applyLanguage(m.default, code); }).catch(() => { if (alive) applyLanguage(null, 'en'); });
    return () => { alive = false; };
  }, [code]);
  return null;
}

/** The language on show, and a way to change it. */
export function useLanguage() {
  const { prefs, setPref } = usePreferences();
  return { lang: prefs.language, setLanguage: (c) => setPref('language', c), languages: LANGUAGES };
}
