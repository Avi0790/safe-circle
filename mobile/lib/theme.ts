import { Appearance } from 'react-native';
import { getAppearancePref, resolveScheme } from './appearance';

// Shared design tokens (Avi owns the design system, per the proposal).
// Mirrors the web dashboard's palette so the two clients feel related.
//
// Light or dark: the choice in Settings → Appearance (lib/appearance.ts),
// which by default matches the phone. Decided once, when the app starts
// (styles are built at load), so a change applies the next time it opens.
const appearancePref = getAppearancePref();
export const isDark = resolveScheme(appearancePref, Appearance.getColorScheme()) === 'dark';

// A forced choice also tells iOS, so the keyboard, alerts, the status bar
// and the map match the app rather than the phone.
if (appearancePref !== 'system') {
  try {
    Appearance.setColorScheme(appearancePref);
  } catch {
    // older platforms: only Safe Circle's own screens follow the choice
  }
}

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

export const colors = isDark ? dark : light;

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

export const typography = {
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.textHeading },
  heading: { fontSize: 18, fontWeight: '600' as const, color: colors.textHeading },
  body: { fontSize: 15, color: colors.text },
  caption: { fontSize: 13, color: colors.text },
};
