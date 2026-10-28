import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';
import { getAppearancePref, resolveScheme, type AppearancePref, type Scheme } from './appearance';

// Shared design tokens (Avi owns the design system, per the proposal).
// Mirrors the web dashboard's palette so the two clients feel related.
//
// Light or dark: the choice in Settings → Appearance (lib/appearance.ts),
// which by default matches the phone, and switches while the app is open.
// How a switch reaches every screen without each one being rewritten:
//  - `colors` is one object whose values are swapped in place, so anything
//    reading `colors.x` while rendering gets the current palette;
//  - style sheets are wrapped in themed(), which rebuilds them the first
//    time they're used after a switch;
//  - each screen calls useThemeVersion(), so it re-renders on a switch (and
//    with it everything it draws).
const initialPref = getAppearancePref();

const light = {
  bg: '#ffffff',
  bgElevated: '#f8fafc',
  border: '#e2e8f0',
  text: '#4b5563',
  textHeading: '#0f172a',
  accent: '#7c3aed',
  accentPressed: '#6d28d9',
  accentFill: '#7c3aed', // behind white text (buttons, selected chips)
  danger: '#dc2626',
  dangerFill: '#dc2626', // behind white text: SOS, overdue banners, destructive buttons
  online: '#22c55e',
  stale: '#f59e0b',
  offline: '#cbd5e1',
  // the 2026 look (components/ui/AppUI.tsx)
  page: '#f3f2f8', // grouped background behind cards
  card: '#ffffff',
  ink: '#0f172a', // headings on cards
  muted: '#64748b', // secondary text
  line: '#e9e7f2', // hairlines inside cards
  chip: '#f1f0f7', // unselected chips, secondary buttons
  tint: '#f1ecff', // icon tiles, soft accent backgrounds
  input: '#f6f5fb',
  inputBorder: '#ebe8f5',
  warnBg: '#fffbeb',
  warnBorder: '#fcd34d',
  dangerBg: '#fef2f2',
  dangerBorder: '#fca5a5',
  chevron: '#cbd5e1',
};

const dark: typeof light = {
  bg: '#0f1115',
  bgElevated: '#171a21',
  border: '#2a2e38',
  text: '#cbd5e1',
  textHeading: '#f8fafc',
  accent: '#a78bfa',
  accentPressed: '#8b5cf6',
  accentFill: '#7c3aed',
  danger: '#f87171',
  dangerFill: '#dc2626', // SOS stays a strong red in the dark
  online: '#4ade80',
  stale: '#fbbf24',
  offline: '#3f4451',
  page: '#0b0c10',
  card: '#171a21',
  ink: '#f8fafc',
  muted: '#94a3b8',
  line: '#2a2e38',
  chip: '#232733',
  tint: '#2a2340',
  input: '#1e212a',
  inputBorder: '#2f3340',
  warnBg: '#2b2410',
  warnBorder: '#a16207',
  dangerBg: '#2b1416',
  dangerBorder: '#b91c1c',
  chevron: '#475569',
};

let dark_ = resolveScheme(initialPref, Appearance.getColorScheme()) === 'dark';
// Live: re-read it while rendering, never copy it into a module constant.
export let isDark = dark_;
export const colors: typeof light = { ...(dark_ ? dark : light) };

let version = 0;
const listeners = new Set<() => void>();

// Switch the palette everywhere. Screens re-render through useThemeVersion().
export function applyColorScheme(scheme: Scheme): void {
  const nextDark = scheme === 'dark';
  if (nextDark === dark_) return;
  dark_ = nextDark;
  isDark = nextDark;
  Object.assign(colors, nextDark ? dark : light);
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function themeVersion(): number {
  return version;
}

// Call at the top of a screen so it redraws when the theme changes.
export function useThemeVersion(): number {
  return useSyncExternalStore(subscribe, themeVersion, themeVersion);
}

// A style sheet (or any object built from colours) that rebuilds itself the
// first time it's read after a theme switch:
//   const styles = themed(() => StyleSheet.create({ ... colors.card ... }));
export function themed<T extends object>(factory: () => T): T {
  let builtFor = -1;
  let current: T;
  const now = (): T => {
    if (builtFor !== version) {
      current = factory();
      builtFor = version;
    }
    return current;
  };
  return new Proxy({} as T, {
    get: (_target, key) => (now() as Record<PropertyKey, unknown>)[key],
    has: (_target, key) => key in now(),
    ownKeys: () => Reflect.ownKeys(now()),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(now(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

// What the phone itself is set to, while "Match iPhone" is chosen.
function phoneScheme(): Scheme {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

// A forced choice also tells iOS, so the keyboard, alerts, the status bar
// and the map match the app rather than the phone.
function tellIos(pref: AppearancePref) {
  try {
    Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
  } catch {
    // older platforms: only Safe Circle's own screens follow the choice
  }
}

if (initialPref !== 'system') tellIos(initialPref);

// Settings → Appearance: apply a new choice right away.
export function applyAppearancePref(pref: AppearancePref): void {
  tellIos(pref);
  applyColorScheme(pref === 'system' ? phoneScheme() : pref);
}

// While "Match iPhone" is chosen, follow the phone switching (at sunset, from
// Control Centre) with the app open. Returns the unsubscribe.
export function followPhoneAppearance(): () => void {
  const subscription = Appearance.addChangeListener(({ colorScheme }) => {
    if (getAppearancePref() === 'system') applyColorScheme(colorScheme === 'dark' ? 'dark' : 'light');
  });
  return () => subscription.remove();
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  full: 999,
};

export const typography = themed(() => ({
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.textHeading },
  heading: { fontSize: 18, fontWeight: '600' as const, color: colors.textHeading },
  body: { fontSize: 15, color: colors.text },
  caption: { fontSize: 13, color: colors.text },
}));
