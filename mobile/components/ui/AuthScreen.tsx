import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { GradientFill } from '@/components/ui/AppUI';
import { colors, themed } from '@/lib/theme';

// The Safe Circle mark: you at the centre, your circle around you.
export function LogoMark({ size = 72 }: { size?: number }) {
  return (
    <View style={[styles.logo, { width: size, height: size, borderRadius: size * 0.3 }]}>
      <Svg width={size * 0.7} height={size * 0.7} viewBox="0 0 100 100">
        <Circle cx="50" cy="50" r="44" stroke="#fff" strokeOpacity={0.35} strokeWidth="6" fill="none" />
        <Circle cx="50" cy="50" r="29" stroke="#fff" strokeOpacity={0.7} strokeWidth="6" fill="none" />
        <Circle cx="50" cy="50" r="13" fill="#fff" />
      </Svg>
    </View>
  );
}

// The sign-in, sign-up and reset screens: a violet gradient with the mark,
// the form in a white card, and the links to the other screens below it.
export function AuthScreen({
  title,
  subtitle,
  tagline = 'Family location sharing that respects your battery and your privacy.',
  children,
  footer,
}: {
  title?: string;
  subtitle?: string;
  tagline?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <View style={styles.root}>
      <GradientFill from="#1e1b4b" to="#7c3aed" />
      <View style={[styles.orb, { width: 320, height: 320, top: -120, right: -140 }]} pointerEvents="none" />
      <View style={[styles.orb, { width: 220, height: 220, bottom: -80, left: -90 }]} pointerEvents="none" />
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.brand}>
              <LogoMark />
              <Text maxFontSizeMultiplier={1.3} style={styles.appName} accessibilityRole="header">
                Safe Circle
              </Text>
              <Text style={styles.tagline}>{tagline}</Text>
            </View>
            <View style={styles.card}>
              {title ? (
                <Text style={styles.title} accessibilityRole="header">
                  {title}
                </Text>
              ) : null}
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              {children}
            </View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// A setup step opened from inside the app (under a normal header): the same
// white card, on the app's grey background.
export function CardScreen({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={{ backgroundColor: colors.page }}
      contentContainerStyle={styles.cardScreen}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>{children}</View>
    </ScrollView>
  );
}

// For links and text sitting on the gradient, under the card.
export const authStyles = themed(() => StyleSheet.create({
  footerText: { fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  footerLink: { fontSize: 14, color: '#fff', fontWeight: '800' },
  cardLink: { fontSize: 14, color: colors.accent, fontWeight: '700', textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14 },
  form: { gap: 14 },
}));

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1e1b4b' },
  flex: { flex: 1 },
  orb: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 20 },
  brand: { alignItems: 'center', gap: 8, marginBottom: 4 },
  logo: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    marginBottom: 6,
  },
  appName: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  tagline: { fontSize: 15, color: 'rgba(255,255,255,0.8)', textAlign: 'center', lineHeight: 21, paddingHorizontal: 12 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 28,
    padding: 22,
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  title: { fontSize: 24, fontWeight: '800', color: colors.ink },
  subtitle: { fontSize: 15, color: colors.muted, lineHeight: 21, marginTop: -6 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  cardScreen: { flexGrow: 1, justifyContent: 'center', padding: 16 },
}));
