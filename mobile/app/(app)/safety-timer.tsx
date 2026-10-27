import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useActiveSafetyTimers } from '@/hooks/useActiveSafetyTimers';
import { useNow } from '@/hooks/useNow';
import { supabase } from '@/lib/supabase';
import { formatClockTime, formatTimeLeft } from '@/lib/format';
import { ensureSharingFor } from '@/lib/sharingWindow';
import { colors, radius, spacing, typography } from '@/lib/theme';

const DURATIONS = [15, 30, 60, 120];

// "Check on me" — Walk me home's sibling for when there's no destination:
// studying alone, a first date, a solo hike. Set a timer and an optional
// note; your circle is told, and if you don't tap "I'm safe" in time, an
// SOS goes out automatically at your last known location (see migration
// ...000040_safety_timer.sql).
export default function SafetyTimerScreen() {
  const { session } = useAuth();
  const { selectedCircle } = useCircles();
  const { timers, refresh } = useActiveSafetyTimers();
  const now = useNow(15_000);
  const [label, setLabel] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = timers.find((t) => t.user_id === session?.user.id) ?? null;

  async function handleStart() {
    if (!selectedCircle) return;
    setBusy(true);
    setError(null);
    // So there's an actual last-known location for the SOS to use if the
    // timer runs out.
    const sharing = await ensureSharingFor(minutes);
    if (!sharing.ok) {
      setError(sharing.reason);
      setBusy(false);
      return;
    }
    const { error: rpcError } = await supabase.rpc('start_safety_timer', {
      p_circle_id: selectedCircle.id,
      p_label: label.trim() || null,
      p_minutes: minutes,
    });
    if (rpcError) setError(rpcError.message);
    else await refresh();
    setBusy(false);
  }

  async function handleSafe() {
    if (!mine) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('end_safety_timer', { p_id: mine.id });
    if (rpcError) setError(rpcError.message);
    await refresh();
    setBusy(false);
  }

  async function handleExtend() {
    if (!mine) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('extend_safety_timer', { p_id: mine.id, p_minutes: 30 });
    if (rpcError) setError(rpcError.message);
    await refresh();
    setBusy(false);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Check on me' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {mine ? (
          <View style={styles.section}>
            <Text style={typography.heading}>
              {mine.status === 'overdue' ? '⏰ Your timer ran out' : `⏱️ ${mine.label ?? 'Timer running'}`}
            </Text>
            {mine.status === 'overdue' ? (
              <Text style={typography.body}>
                Your circle was alerted with your last known location. Tap "I'm safe" if you're
                okay.
              </Text>
            ) : (
              <Text style={typography.body}>
                Due {formatClockTime(mine.expected_by)} · {formatTimeLeft(mine.expected_by, now)} left.
                If you don't check in by then, an SOS goes out automatically with your last known
                location.
              </Text>
            )}
            <Button title="I'm safe" onPress={handleSafe} loading={busy} />
            {mine.status === 'active' && (
              <Button title="Need 30 more minutes" variant="secondary" onPress={handleExtend} disabled={busy} />
            )}
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={typography.body}>
                For when there's no destination to arrive at — studying alone, a first date, a
                solo hike. Your circle is told you asked to be checked on; if you don't check in,
                an SOS goes out automatically with your last known location.
              </Text>
            </View>

            <View style={styles.section}>
              <TextField
                label="Note (optional)"
                value={label}
                onChangeText={setLabel}
                placeholder="Studying at the library"
                maxLength={60}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Check on me in</Text>
              <View style={styles.chipRow}>
                {DURATIONS.map((m) => {
                  const selected = m === minutes;
                  return (
                    <Pressable
                      key={m}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setMinutes(m)}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {m < 60 ? `${m} min` : `${m / 60} h`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={typography.caption}>
                Turns on location sharing for the timer if it isn't already on.
              </Text>
            </View>

            <Button title="Start timer" onPress={handleStart} loading={busy} />
          </>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.sm },
  label: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs + 2,
  },
  chipSelected: { backgroundColor: colors.accentFill, borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  error: { color: colors.danger, fontSize: 14 },
});
