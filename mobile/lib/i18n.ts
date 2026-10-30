import { Platform, Settings } from 'react-native';
import { redrawAll } from '@/lib/theme';
import { es } from '@/lib/translations/es';

// English or Spanish. Text in the app is written in English and wrapped in
// t(): t('Sign in'), t('Clocked in to {org}', { org: name }). In Spanish the
// English is looked up in lib/translations/es.ts; anything not translated
// yet stays English rather than showing a key. The choice follows the phone
// unless set in Settings → Language (kept like the appearance choice, in
// iOS's own preferences, so it's known before the first screen draws).

export type Language = 'en' | 'es';
export type LanguagePref = 'system' | Language;

const KEY = 'safecircle.language';

export const LANGUAGE_OPTIONS: { value: LanguagePref; label: string }[] = [
  { value: 'system', label: 'Match phone' },
  { value: 'en', label: 'English' },
  // each language is named in itself, so it's findable by its speakers
  { value: 'es', label: 'Español' },
];

export const canChooseLanguage = Platform.OS === 'ios';

export function phoneLanguage(): Language {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('es') ? 'es' : 'en';
  } catch {
    return 'en';
  }
}

export function getLanguagePref(): LanguagePref {
  if (!canChooseLanguage) return 'system';
  try {
    const value = Settings.get(KEY);
    return value === 'en' || value === 'es' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function resolveLanguage(pref: LanguagePref, phone: Language): Language {
  return pref === 'system' ? phone : pref;
}

let current: Language = resolveLanguage(getLanguagePref(), phoneLanguage());

export function language(): Language {
  return current;
}

// Save the choice and switch every screen to it now.
export function applyLanguagePref(pref: LanguagePref): void {
  if (canChooseLanguage) {
    try {
      Settings.set({ [KEY]: pref });
    } catch {
      // not saved: the app follows the phone next time
    }
  }
  const next = resolveLanguage(pref, phoneLanguage());
  if (next === current) return;
  current = next;
  redrawAll();
}

export function t(english: string, vars?: Record<string, string | number>): string {
  const text = current === 'es' ? (es[english] ?? english) : english;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
