import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { t } from '@/lib/i18n';
import { colors, radius, spacing, themed, useThemeVersion } from '@/lib/theme';
import { markTourSeen, onShowTour, TOUR_PAGES, tourSeen } from '@/lib/tour';

// Four short pages the first time the app opens signed in (lib/tour.ts):
// what Safe Circle is, SOS, work mode, and privacy. Skippable at every step.
export function WelcomeTour() {
  useThemeVersion(); // redraw on a theme or language switch (lib/theme.ts)
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    tourSeen().then((seen) => {
      if (!seen) setOpen(true);
    });
    return onShowTour(() => {
      setPage(0);
      setOpen(true);
    });
  }, []);

  function finish() {
    setOpen(false);
    markTourSeen();
  }

  if (!open) return null;
  const p = TOUR_PAGES[page];
  const last = page === TOUR_PAGES.length - 1;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={finish}>
      <SafeAreaView style={styles.page}>
        <View style={styles.top}>
          <Pressable accessibilityRole="button" onPress={finish} hitSlop={12}>
            <Text style={styles.skip}>{t('Skip')}</Text>
          </Pressable>
        </View>
        <View style={styles.middle} accessibilityLiveRegion="polite">
          <Text allowFontScaling={false} style={styles.emoji}>{p.emoji}</Text>
          <Text accessibilityRole="header" style={styles.title}>{t(p.title)}</Text>
          <Text style={styles.body}>{t(p.body)}</Text>
        </View>
        <View
          style={styles.dots}
          accessible
          accessibilityLabel={t('Page {n} of {total}', { n: page + 1, total: TOUR_PAGES.length })}
        >
          {TOUR_PAGES.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>
        <View style={styles.buttons}>
          {page > 0 && (
            <View style={{ flex: 1 }}>
              <Button title={t('Back')} variant="secondary" onPress={() => setPage((n) => n - 1)} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Button title={last ? t('Get started') : t('Next')} onPress={() => (last ? finish() : setPage((n) => n + 1))} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  top: { alignItems: 'flex-end', paddingTop: spacing.md },
  skip: { color: colors.accent, fontWeight: '700', fontSize: 16 },
  middle: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
  emoji: { fontSize: 72 },
  title: { fontSize: 28, fontWeight: '800', color: colors.textHeading, textAlign: 'center' },
  body: { fontSize: 17, color: colors.text, textAlign: 'center', lineHeight: 25 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.accent, width: 22 },
  buttons: { flexDirection: 'row', gap: spacing.sm },
}));
