import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '@/lib/i18n';
import { flushOutbox, pendingItems, subscribeOutbox } from '@/lib/outbox';
import { colors, radius, spacing, themed, useThemeVersion } from '@/lib/theme';

// "2 waiting for signal": shown while anything made without signal hasn't
// been sent yet (lib/outbox.ts). Tapping it tries again now.
export function OutboxBanner() {
  useThemeVersion();
  const [count, setCount] = useState(0);
  const [trying, setTrying] = useState(false);

  useEffect(() => {
    let alive = true;
    pendingItems().then((items) => alive && setCount(items.length));
    const unsubscribe = subscribeOutbox((n) => alive && setCount(n));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (count === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t('Tries to send them now')}
      onPress={async () => {
        setTrying(true);
        await flushOutbox();
        setTrying(false);
      }}
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.85 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {t(count === 1 ? '📶 1 waiting for signal' : '📶 {n} waiting for signal', { n: count })}
        </Text>
        <Text style={styles.detail}>
          {trying ? t('Trying now…') : t("Saved on this phone. It's sent as soon as you're back online. Tap to try now.")}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  banner: {
    backgroundColor: colors.warnBg,
    borderColor: colors.warnBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: { fontSize: 15, fontWeight: '700', color: colors.textHeading },
  detail: { fontSize: 13, color: colors.text, marginTop: 2 },
}));
