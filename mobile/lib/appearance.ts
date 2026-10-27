import { Platform, Settings } from 'react-native';

// Light, dark, or match the phone (the default), chosen in Settings →
// Appearance. Kept in iOS's own preferences (NSUserDefaults, through React
// Native's Settings), which can be read synchronously: lib/theme.ts needs the
// answer while the app is still loading, before any screen is styled, and
// AsyncStorage can't answer that early. Elsewhere (Android, web) it's always
// "match the phone".

export type AppearancePref = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

const KEY = 'safecircle.appearance';

export const APPEARANCE_OPTIONS: { value: AppearancePref; label: string }[] = [
  { value: 'system', label: 'Match iPhone' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export const canChooseAppearance = Platform.OS === 'ios';

export function getAppearancePref(): AppearancePref {
  if (!canChooseAppearance) return 'system';
  try {
    const value = Settings.get(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function setAppearancePref(pref: AppearancePref): void {
  if (!canChooseAppearance) return;
  try {
    Settings.set({ [KEY]: pref });
  } catch {
    // not saved: the app keeps matching the phone
  }
}

// What the app should look like, given the choice and the phone's setting.
export function resolveScheme(pref: AppearancePref, phone: string | null | undefined): Scheme {
  if (pref === 'light' || pref === 'dark') return pref;
  return phone === 'dark' ? 'dark' : 'light';
}
