import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { announce } from '@/lib/announce';
import { FALL_COUNTDOWN_SECONDS, FALL_SOS_MESSAGE } from '@/lib/fallDetector';
import { t } from '@/lib/i18n';
import { colors, spacing, themed, useThemeVersion } from '@/lib/theme';

// "Are you OK?" after a possible fall (lib/fallDetector.ts): a full-screen
// countdown that vibrates the whole time. "I'm OK" stops it; at zero, or on
// "Send SOS now", the SOS goes out with a message saying why. Nothing is sent
// while the person can still answer.
export function FallCheck({
  visible,
  onDismiss,
  onSend,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSend: (message: string) => void;
}) {
  useThemeVersion();
  const [left, setLeft] = useState(FALL_COUNTDOWN_SECONDS);
  const sent = useRef(false);

  useEffect(() => {
    if (!visible) return;
    sent.current = false;
    setLeft(FALL_COUNTDOWN_SECONDS);
    announce(t('It looks like you fell. Are you OK?'));
    Vibration.vibrate([0, 600, 400], true);
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      clearInterval(timer);
      Vibration.cancel();
    };
  }, [visible]);

  useEffect(() => {
    if (visible && left === 0 && !sent.current) {
      sent.current = true;
      Vibration.cancel();
      onSend(FALL_SOS_MESSAGE);
    }
  }, [visible, left, onSend]);

  function sendNow() {
    if (sent.current) return;
    sent.current = true;
    Vibration.cancel();
    onSend(FALL_SOS_MESSAGE);
  }

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={onDismiss}>
      <View style={styles.page}>
        <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
          {t('Are you OK?')}
        </Text>
        <Text style={styles.body}>{t('It looks like you fell, or were in a crash.')}</Text>
        <Text style={styles.count} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.2}>
          {left}
        </Text>
        <Text style={styles.body}>
          {t('Your circle gets an SOS with your location in {n} seconds.', { n: left })}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.ok, pressed && { opacity: 0.85 }]}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t("I'm OK")}
          accessibilityHint={t('Stops the countdown. Nothing is sent.')}
        >
          <Text style={styles.okText} maxFontSizeMultiplier={1.4}>
            {t("I'm OK")}
          </Text>
        </Pressable>
        <Pressable onPress={sendNow} accessibilityRole="button" hitSlop={12}>
          <Text style={styles.sendNow}>{t('Send SOS now')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.dangerFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  title: { fontSize: 40, fontWeight: '800', color: '#fff', textAlign: 'center' },
  body: { fontSize: 18, color: '#fff', textAlign: 'center', lineHeight: 26 },
  count: { fontSize: 96, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  ok: {
    alignSelf: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  okText: { fontSize: 28, fontWeight: '800', color: colors.dangerFill },
  sendNow: { fontSize: 17, fontWeight: '700', color: '#fff', textDecorationLine: 'underline' },
}));
