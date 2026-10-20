import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
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
import { getWebBaseUrl, isLocalUrl } from '@/lib/shareLink';
import { ensureSharingFor } from '@/lib/sharingWindow';
import { supabase } from '@/lib/supabase';
import { createTripLink, finishTripLink, tripShareMessage } from '@/lib/tripLink';
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
  // A live link sent for this trip (it follows the trip on the server).
  const [link, setLink] = useState<{ id: string; expires_at: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mine = myManualTrips(trips, session?.user.id, now)[0] ?? null;
  const mineCircle = mine ? circles.find((c) => c.id === mine.circle_id)?.name : undefined;

  // The server hides a trip from the circle once a temporary sharing window
  // has ended; say so instead of letting someone think it's being seen.
  useEffect(() => {
    getShareUntil().then((until) => setWindowEnded(until != null && until.getTime() < Date.now()));
  }, []);

  const mineId = mine?.id ?? null;
  const loadLink = useCallback(async () => {
    if (!mineId) {
      setLink(null);
      return;
    }
    const { data } = await supabase
      .from('share_links')
      .select('id, expires_at')
      .eq('shared_trip_id', mineId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1);
    setLink((data as { id: string; expires_at: string }[] | null)?.[0] ?? null);
  }, [mineId]);

  useEffect(() => {
    loadLink();
  }, [loadLink]);

  // Share ETA with anyone, as on the Directions screen: just a message, or a
  // live link that follows this trip until you arrive.
  function shareWithAnyone() {
    if (!mine) return;
    Alert.alert('Share your ETA', "Send it to anyone, even if they don't have Safe Circle.", [
      { text: 'Live link (until I arrive)', onPress: () => sendLiveLink() },
      { text: 'Just the ETA as a message', onPress: () => sendMessage() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function sendMessage() {
    if (!mine) return;
    try {
      await Share.share({ message: tripShareMessage(mine.destination, new Date(mine.eta).getTime(), mine.mode) });
    } catch {
      // Closing the share sheet isn't an error.
    }
  }

  async function sendLiveLink() {
    if (!mine) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const etaMs = new Date(mine.eta).getTime();
    // The page shows your latest location, so make sure something is sending
    // it (a no-op if sharing is already on; a sharing window is at most a day).
    const sharing = await ensureSharingFor(Math.min(1430, Math.max(15, Math.ceil((etaMs - Date.now()) / 60_000))));
    if (!sharing.ok) {
      setError(sharing.reason);
      setBusy(false);
      return;
    }
    const res = await createTripLink(mine.destination, etaMs, mine.mode, mine.id);
    await loadLink();
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (isLocalUrl(getWebBaseUrl())) {
      setNotice("The web page isn't deployed, so this link only opens on this network.");
    }
    try {
      await Share.share({ message: tripShareMessage(mine.destination, etaMs, mine.mode, res.url) });
    } catch {
      // The link stays on until the trip ends or you stop it.
    }
  }

  async function stopLink() {
    if (!link) return;
    setBusy(true);
    await finishTripLink(link.id, false);
    await loadLink();
    setBusy(false);
  }

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
      // Its live link, if any, ended with it on the server.
      setLink(null);
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
            {link ? (
              <>
                <Text style={typography.caption}>
                  🔗 A live link is out for this trip. Whoever has it sees your ETA and where you are
                  until you arrive or stop sharing.
                </Text>
                <Button title="Stop the live link" variant="secondary" onPress={stopLink} disabled={busy} />
              </>
            ) : (
              <Button title="📤 Share ETA with anyone…" variant="secondary" onPress={shareWithAnyone} disabled={busy} />
            )}
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
        {notice && <Text style={typography.caption}>{notice}</Text>}
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
