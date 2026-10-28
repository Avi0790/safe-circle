import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, themed } from '@/lib/theme';

// Safe Circle's shared look (first made for the Work tab): gradient hero cards, white grouped
// cards, icon tiles, pills and a seat meter. Drawn with react-native-svg and
// plain views, so they need no extra native modules.

export const appColors = {
  // getters: read the current theme each time (lib/theme.ts)
  get page() {
    return colors.page;
  },
  get card() {
    return colors.card;
  },
  get ink() {
    return colors.ink;
  },
  get muted() {
    return colors.muted;
  },
  get line() {
    return colors.line;
  },
  // hero gradients: [from, to]
  offShift: ['#3b1f8f', '#7c3aed'] as const,
  onShift: ['#047857', '#10b981'] as const,
  ended: ['#334155', '#64748b'] as const,
  crew: ['#1e1b4b', '#6d28d9'] as const,
};

let gradientSeq = 0;

// A gradient filling its parent (put it first inside a View with
// overflow: 'hidden' and a borderRadius).
export function GradientFill({ from, to }: { from: string; to: string }) {
  const [id] = useState(() => `wg${++gradientSeq}`);
  return (
    <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100" pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
    </Svg>
  );
}

// The coloured card at the top of each organization, with two soft circles
// for depth.
export function HeroCard({ colors: [from, to], children }: { colors: readonly [string, string]; children: ReactNode }) {
  return (
    <View style={ui.hero}>
      <GradientFill from={from} to={to} />
      <View style={[ui.orb, { width: 220, height: 220, top: -90, right: -70 }]} pointerEvents="none" />
      <View style={[ui.orb, { width: 140, height: 140, bottom: -60, left: -40 }]} pointerEvents="none" />
      {children}
    </View>
  );
}

export function Card({ children, tone, style }: { children: ReactNode; tone?: 'warn' | 'danger'; style?: ViewStyle }) {
  return (
    <View style={[ui.card, tone === 'warn' && ui.cardWarn, tone === 'danger' && ui.cardDanger, style]}>{children}</View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text style={ui.sectionTitle} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Pill({ children, light }: { children: ReactNode; light?: boolean }) {
  return (
    <View style={[ui.pill, light && ui.pillLight]}>
      <Text maxFontSizeMultiplier={1.4} style={[ui.pillText, light && ui.pillTextLight]}>
        {children}
      </Text>
    </View>
  );
}

// The big button on a hero card: white and solid, or outlined in white.
export function HeroButton({
  title,
  icon,
  onPress,
  loading,
  disabled,
  outline,
  tint,
  accessibilityLabel,
}: {
  title: string;
  icon?: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  outline?: boolean;
  tint: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        ui.heroButton,
        outline ? ui.heroButtonOutline : ui.heroButtonSolid,
        (disabled || loading) && { opacity: 0.55 },
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={outline ? '#fff' : tint} />
      ) : (
        <Text style={[ui.heroButtonText, { color: outline ? '#fff' : tint }]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

// A square-ish tile with an emoji icon, for the owner's tools.
export function ActionTile({
  icon,
  title,
  caption,
  onPress,
  accessibilityLabel,
}: {
  icon: string;
  title: string;
  caption: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // read as "Walk me home, button. Timer, circle alerted if you're late"
      // rather than the emoji, title and caption as three things
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={caption}
      style={({ pressed }) => [ui.tile, pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 }]}
    >
      <View style={ui.tileIcon}>
        <Text allowFontScaling={false} style={ui.tileEmoji}>{icon}</Text>
      </View>
      <Text style={ui.tileTitle}>{title}</Text>
      <Text style={ui.tileCaption}>{caption}</Text>
    </Pressable>
  );
}

// A small rounded choice, filled when picked.
export function Chip({
  label,
  selected,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [ui.chip, selected && ui.chipOn, disabled && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
    >
      <Text style={[ui.chipText, selected && ui.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

// "3 of 10 seats" as a bar.
export function SeatMeter({ used, limit }: { used: number; limit: number }) {
  const share = limit > 0 ? Math.min(1, used / limit) : 1;
  const full = used >= limit;
  return (
    <View style={ui.meterTrack} accessible accessibilityLabel={`${used} of ${limit} seats used`}>
      <View style={[ui.meterFill, { width: `${Math.max(share * 100, 4)}%` }, full && { backgroundColor: colors.dangerFill }]} />
    </View>
  );
}

// Initials in a soft circle.
export function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <View style={ui.initials}>
      <Text style={ui.initialsText}>{letters || '?'}</Text>
    </View>
  );
}

// H:MM:SS since a moment, ticking every second; only this text re-renders.
export function LiveElapsed({ since, style }: { since: string; style?: object }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return (
    <Text style={style} accessibilityLabel={`On shift for ${h} hours ${m} minutes`}>
      {h}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </Text>
  );
}

export const ui = themed(() => StyleSheet.create({
  hero: {
    borderRadius: 24,
    overflow: 'hidden',
    padding: 20,
    gap: 10,
    shadowColor: '#312e81',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  orb: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heroOrg: { fontSize: 20, fontWeight: '700', color: '#fff', flexShrink: 1 },
  heroRole: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  heroBig: { fontSize: 46, fontWeight: '800', color: '#fff', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  heroBody: { fontSize: 15, color: 'rgba(255,255,255,0.9)', lineHeight: 21 },
  heroSmall: { fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 18 },
  card: {
    backgroundColor: appColors.card,
    borderRadius: 20,
    padding: 16,
    gap: 10,
    shadowColor: '#1e1b4b',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardWarn: { backgroundColor: colors.warnBg, borderWidth: 1, borderColor: colors.warnBorder },
  cardDanger: { backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.dangerBorder },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: appColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  pillLight: { backgroundColor: colors.tint },
  pillText: { fontSize: 12, fontWeight: '700', color: '#fff', letterSpacing: 0.3 },
  pillTextLight: { color: colors.accent },
  heroButton: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  heroButtonSolid: { backgroundColor: '#fff' },
  heroButtonOutline: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' },
  heroButtonText: { fontSize: 17, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: appColors.card,
    borderRadius: 20,
    padding: 14,
    gap: 4,
    shadowColor: '#1e1b4b',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  tileEmoji: { fontSize: 20 },
  tileTitle: { fontSize: 16, fontWeight: '700', color: appColors.ink },
  tileCaption: { fontSize: 12, color: appColors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.chip,
  },
  chipOn: { backgroundColor: colors.accentFill },
  chipText: { fontSize: 14, fontWeight: '600', color: appColors.ink },
  chipTextOn: { color: '#fff' },
  meterTrack: { height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4, backgroundColor: colors.accentFill },
  initials: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: { fontSize: 13, fontWeight: '700', color: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: appColors.ink },
  rowSub: { fontSize: 13, color: appColors.muted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: appColors.line, marginLeft: 48 },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  statValue: { fontSize: 20, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: 0.5 },
}));
