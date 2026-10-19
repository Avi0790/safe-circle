import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useActiveTrips } from '@/hooks/useActiveTrips';
import { useNow } from '@/hooks/useNow';
import { formatClockTime } from '@/lib/format';
import { getShareUntil } from '@/lib/locationTracking';
import {
  defaultTripMinutes,
  endSharedTrip,
  formatTripDuration,
  MANUAL_MODES,
  myManualTrips,
  startSharedTrip,
  stepTripMinutes,
  TRIP_PRESET_MINUTES,
  tripEtaText,
  updateSharedTrip,
  type ManualMode,
} from '@/lib/sharedTrips';
import { colors, radius, spacing, typography } from '@/lib/theme';

const LABEL: Record<ManualMode, string> = { bus: '🚌 Bus', train: '🚆 Train', flight: '✈️ Flight' };
const PLACEHOLDER: Record<ManualMode, string> = { bus: 'Campus', train: 'Chicago Union Station', flight: 'Denver' };
const RUNNING_LATE_MS = 15 * 60_000;

// Tell your circle about a bus, train or flight. Nothing is navigating, so
// this is manual: where you're going and when you expect to arrive. The trip
// stays up until that time plus a grace period for delays (backend migration
// ...000060), because a phone on a plane can't report in. Only the
// destination's name and the time are shared: not a route, and not where you
// are along the way (your live location is a separate setting).
export default function ShareTripScreen() {
  const { session } = useAuth();
  const { circles, selectedCircle } = useCircles();
  const { trips, refresh } = useActiveTrips();
  const now = useNow(30_000);
  const [mode, setMode] = useState<ManualMode>('bus');
  const [destination, setDestination] = useState('');
  const [minutes, setMinutes] = useState(defaultTripMinutes('bus'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowEnded, setWindowEnded] = useState(false);

  const mine = myManualTrips(trips, session?.user.id, now)[0] ?? null;
  const mineCircle = mine ? circles.find((c) => c.id === mine.circle_id)?.name : undefined;

  // The server hides a trip from the circle once a temporary sharing window
  // has ended; say so instead of letting someone think it's being seen.
  useEffect(() => {
    getShareUntil().then((until) => setWindowEnded(until != null && until.getTime() < Date.now()));
  }, []);

  function chooseMode(next: ManualMode) {
    setMode(next);
    setMinutes(defaultTripMinutes(next));
  }

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    if (!result.ok) setError(result.error);
    await refresh();
    setBusy(false);
  }

  const handleStart = () =>
    run(async () => {
      if (!selectedCircle) return { ok: false, error: 'Pick a circle first.' };
      const name = destination.trim();
      if (!name) return { ok: false, error: 'Say where you are going.' };
      const res = await startSharedTrip(selectedCircle.id, name, Date.now() + minutes * 60_000, mode);
      return res.ok ? { ok: true } : res;
    });

  const handleLate = () =>
    run(async () => {
      if (!mine) return { ok: true };
      // From the later of the current ETA and now, so a trip that is already
      // past its time moves to 15 minutes from now rather than still in the past.
      const base = Math.max(new Date(mine.eta).getTime(), Date.now());
      await updateSharedTrip(mine.id, base + RUNNING_LATE_MS);
      return { ok: true };
    });

  const handleDone = (arrived: boolean) =>
    run(async () => {
      if (mine) await endSharedTrip(mine.id, arrived);
      return { ok: true };
    });

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Share a trip' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {mine ? (
          <View style={styles.section}>
            <Text style={typography.heading}>
              {LABEL[mine.mode as ManualMode]} to {mine.destination}
            </Text>
            <Text style={typography.body}>
              {mineCircle ? `${mineCircle} can see` : 'Your circle can see'} that you're on your way,{' '}
              {tripEtaText(mine.eta, now, mine.mode)}.
            </Text>
            <Button title="I've arrived" onPress={() => handleDone(true)} loading={busy} />
            <Button title="Running late (+15 min)" variant="secondary" onPress={handleLate} disabled={busy} />
            <Button title="Stop sharing" variant="secondary" onPress={() => handleDone(false)} disabled={busy} />
          </View>
        ) : !selectedCircle ? (
          <Text style={typography.body}>Join or create a circle first, then you can share trips with it.</Text>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={typography.body}>
                Let {selectedCircle.name} know where you're headed and when you expect to arrive.
                They see only the place's name and the time: not a route.
              </Text>
            </View>

            <View style={styles.chipRow} accessibilityRole="tablist">
              {MANUAL_MODES.map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === m }}
                  style={[styles.modeBtn, mode === m && styles.chipSelected]}
                  onPress={() => chooseMode(m)}
                >
                  <Text style={[styles.modeText, mode === m && styles.chipTextSelected]}>{LABEL[m]}</Text>
                </Pressable>
              ))}
            </View>

            <TextField
              label="Where to?"
              value={destination}
              onChangeText={setDestination}
              placeholder={PLACEHOLDER[mode]}
              maxLength={80}
              autoCapitalize="words"
            />

            <View style={styles.section}>
              <Text style={styles.label}>{mode === 'flight' ? 'Landing in' : 'Arriving in'}</Text>
              <View style={styles.stepper}>
                <Pressable
                  accessibilityLabel="Earlier"
                  style={styles.stepBtn}
                  onPress={() => setMinutes((v) => stepTripMinutes(mode, v, -1))}
                >
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <View style={styles.stepValue}>
                  <Text style={styles.stepMain}>{formatTripDuration(minutes)}</Text>
                  <Text style={typography.caption}>about {formatClockTime(new Date(now + minutes * 60_000).toISOString())}</Text>
                </View>
                <Pressable
                  accessibilityLabel="Later"
                  style={styles.stepBtn}
                  onPress={() => setMinutes((v) => stepTripMinutes(mode, v, 1))}
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
              <View style={styles.chipRow}>
                {TRIP_PRESET_MINUTES[mode].map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.chip, m === minutes && styles.chipSelected]}
                    onPress={() => setMinutes(m)}
                    accessibilityState={{ selected: m === minutes }}
                  >
                    <Text style={[styles.chipText, m === minutes && styles.chipTextSelected]}>{formatTripDuration(m)}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={typography.caption}>
                {mode === 'flight'
                  ? "A phone on a plane can't send updates, so it stays up until about 2 hours after this time (for delays), or until you tap I've arrived."
                  : 'It stays up until this time plus a little for delays, or until you tap I\'ve arrived.'}
              </Text>
            </View>

            {windowEnded && (
              <Text style={styles.warning}>
                Your sharing window has ended, so your circle can't see trips until you start sharing again.
              </Text>
            )}
            <Button title="Share trip" onPress={handleStart} loading={busy} />
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
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  modeText: { fontSize: 15, fontWeight: '600', color: colors.textHeading },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs + 2,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
  },
  stepText: { fontSize: 24, fontWeight: '600', color: colors.textHeading },
  stepValue: { flex: 1, alignItems: 'center' },
  stepMain: { fontSize: 22, fontWeight: '700', color: colors.textHeading },
  warning: { color: colors.stale, fontWeight: '600', fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
});
