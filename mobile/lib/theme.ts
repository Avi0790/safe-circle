// Shared design tokens (Avi owns the design system, per the proposal).
// Mirrors the web dashboard's palette so the two clients feel related.
export const colors = {
  bg: '#ffffff',
  bgElevated: '#f8fafc',
  border: '#e2e8f0',
  text: '#4b5563',
  textHeading: '#0f172a',
  accent: '#7c3aed',
  accentPressed: '#6d28d9',
  danger: '#dc2626',
  online: '#22c55e',
  stale: '#f59e0b',
  offline: '#cbd5e1',
};

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
