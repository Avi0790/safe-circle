import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useNow } from '@/hooks/useNow';
import { announce } from '@/lib/announce';
import { supabase } from '@/lib/supabase';
import { formatClockTime, formatTimeLeft } from '@/lib/format';
import type { SafetyTimer } from '@/lib/types';
import { colors, radius, spacing, themed } from '@/lib/theme';
import { t } from '@/lib/i18n';

// Walk me home's WalkBanner, for a destination-less "check on me" timer.
// A circle-mate's overdue timer isn't repeated here — it's already raised
// a normal SOS, shown by the SOS banner above this with their last known
// location.
export function SafetyTimerBanner({
  timers,
  onChanged,
}: {
  timers: SafetyTimer[];
  onChanged: () => void;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const now = useNow(20_000);
  const [endingId, setEndingId] = useState<string | null>(null);

  const visible = timers.filter((t) => t.user_id === session?.user.id || t.status === 'active');
  if (visible.length === 0) return null;

  async function handleSafe(timer: SafetyTimer) {
    setEndingId(timer.id);
    await supabase.rpc('end_safety_timer', { p_id: timer.id });
    setEndingId(null);
    announce(t('Marked safe'));
    onChanged();
  }

  return (
    <View style={styles.container}>
      {visible.map((timer) => {
        const isMine = timer.user_id === session?.user.id;
        const overdue = timer.status === 'overdue';
        return (
          <Pressable
            key={timer.id}
            style={[styles.banner, overdue && styles.bannerOverdue]}
            onPress={isMine ? () => router.push('/safety-timer') : undefined}
            disabled={!isMine}
            // Not one VoiceOver element, or the "I'm safe" button inside
            // would be unreachable: the text and the button are read apart.
            accessible={false}
          >
            <View
              style={styles.text}
              accessible
              accessibilityRole={isMine ? 'button' : 'text'}
              accessibilityHint={isMine ? t('Opens the details') : undefined}
              onAccessibilityTap={isMine ? () => router.push('/safety-timer') : undefined}
            >
              <Text style={styles.title}>
                {overdue
                  ? t('⏰ Your check-on-me timer ran out')
                  : isMine
                    ? `⏱️ ${timer.label ?? t('Asked to be checked on')}`
                    : t('⏱️ {name} asked to be checked on', { name: timer.profiles?.full_name ?? t('Someone') })}
              </Text>
              <Text style={styles.detail}>
                {overdue
                  ? t('Your circle was alerted. Tap "I\'m safe" if you\'re okay.')
                  : t('Due {time} · {left}', { time: formatClockTime(timer.expected_by), left: formatTimeLeft(timer.expected_by, now) })}
              </Text>
            </View>
            {isMine && (
              <Pressable
                style={styles.button}
                accessibilityRole="button"
                accessibilityLabel={t("I'm safe")}
                accessibilityState={{ busy: endingId === timer.id }}
                onPress={() => handleSafe(timer)}
                disabled={endingId === timer.id}
              >
                {endingId === timer.id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>{t("I'm safe")}</Text>
                )}
              </Pressable>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  container: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  bannerOverdue: { backgroundColor: colors.dangerFill },
  text: { flex: 1, gap: 2 },
  title: { color: '#fff', fontWeight: '700', fontSize: 15 },
  detail: { color: '#fff', fontSize: 13, opacity: 0.9 },
  button: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
}));
