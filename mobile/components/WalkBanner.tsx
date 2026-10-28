import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useNow } from '@/hooks/useNow';
import { supabase } from '@/lib/supabase';
import { cancelWalkReminder } from '@/lib/walkReminder';
import { formatClockTime, formatTimeLeft } from '@/lib/format';
import type { Walk } from '@/lib/types';
import { colors, radius, spacing, themed } from '@/lib/theme';

// Shows who is on a walk. Your own tap-through to the walk screen; other
// people's are informational. A circle-mate's overdue walk is deliberately
// not repeated here — it has already raised a normal SOS, which the SOS
// banner right above this shows with their last known location.
export function WalkBanner({ walks, onChanged }: { walks: Walk[]; onChanged: () => void }) {
  const { session } = useAuth();
  const router = useRouter();
  const now = useNow(20_000);
  const [endingId, setEndingId] = useState<string | null>(null);

  const visible = walks.filter((w) => w.user_id === session?.user.id || w.status === 'active');
  if (visible.length === 0) return null;

  async function handleSafe(walk: Walk) {
    setEndingId(walk.id);
    await supabase.rpc('end_walk', { p_walk_id: walk.id });
    await cancelWalkReminder();
    setEndingId(null);
    onChanged();
  }

  return (
    <View style={styles.container}>
      {visible.map((walk) => {
        const isMine = walk.user_id === session?.user.id;
        const overdue = walk.status === 'overdue';
        return (
          <Pressable
            key={walk.id}
            style={[styles.banner, overdue && styles.bannerOverdue]}
            onPress={isMine ? () => router.push('/walk') : undefined}
            disabled={!isMine}
          >
            <View style={styles.text}>
              <Text style={styles.title}>
                {overdue
                  ? '⏰ Your walk timer ran out'
                  : isMine
                    ? `🚶 Walking to ${walk.place_name}`
                    : `🚶 ${walk.profiles?.full_name ?? 'Someone'} is walking to ${walk.place_name}`}
              </Text>
              <Text style={styles.detail}>
                {overdue
                  ? 'Your circle was alerted. Tap "I\'m safe" if you\'re okay.'
                  : `Due ${formatClockTime(walk.expected_by)} · ${formatTimeLeft(walk.expected_by, now)}`}
              </Text>
            </View>
            {isMine && (
              <Pressable style={styles.button} onPress={() => handleSafe(walk)} disabled={endingId === walk.id}>
                {endingId === walk.id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>I'm safe</Text>
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
