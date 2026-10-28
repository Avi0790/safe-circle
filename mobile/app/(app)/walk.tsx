import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useActiveWalks } from '@/hooks/useActiveWalks';
import { useNow } from '@/hooks/useNow';
import { supabase } from '@/lib/supabase';
import { formatClockTime, formatTimeLeft } from '@/lib/format';
import { placeIcon } from '@/lib/places';
import { ensureSharingFor } from '@/lib/sharingWindow';
import { cancelWalkReminder, scheduleWalkReminder } from '@/lib/walkReminder';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

interface PlaceRow {
  id: string;
  name: string;
}

const DURATIONS = [10, 15, 20, 30, 45, 60];

// Walk me home. Pick a saved place and how long you expect to take: your
// circle sees you're on your way and is told when you arrive. If you neither
// arrive nor tap "I'm safe" in time, an SOS goes out on its own with your
// last known location (see migration ...000026_walk_me_home.sql).
export default function WalkScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const router = useRouter();
  const { session } = useAuth();
  const { selectedCircle } = useCircles();
  const { walks, refresh } = useActiveWalks();
  const now = useNow(15_000);
  const [places, setPlaces] = useState<PlaceRow[]>([]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myWalk = walks.find((w) => w.user_id === session?.user.id) ?? null;

  const loadPlaces = useCallback(async () => {
    if (!selectedCircle) return;
    const { data } = await supabase
      .from('places')
      .select('id, name')
      .eq('circle_id', selectedCircle.id)
      .order('name');
    setPlaces(data ?? []);
    setPlaceId((current) => current ?? data?.[0]?.id ?? null);
  }, [selectedCircle]);

  useEffect(() => {
    loadPlaces();
  }, [loadPlaces]);

  async function handleStart() {
    if (!placeId) return;
    setBusy(true);
    setError(null);
    // The walk is only "arrived" when a location ping lands inside the
    // destination, so something has to be sharing for its whole length.
    const sharing = await ensureSharingFor(minutes);
    if (!sharing.ok) {
      setError(sharing.reason);
      setBusy(false);
      return;
    }
    const { error: rpcError } = await supabase.rpc('start_walk', {
      p_place_id: placeId,
      p_minutes: minutes,
    });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      await scheduleWalkReminder(new Date(Date.now() + minutes * 60_000));
      await refresh();
    }
    setBusy(false);
  }

  async function handleSafe() {
    if (!myWalk) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('end_walk', { p_walk_id: myWalk.id });
    if (rpcError) setError(rpcError.message);
    else await cancelWalkReminder();
    await refresh();
    setBusy(false);
  }

  async function handleExtend() {
    if (!myWalk) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('extend_walk', {
      p_walk_id: myWalk.id,
      p_minutes: 10,
    });
    if (rpcError) setError(rpcError.message);
    else if (data) await scheduleWalkReminder(new Date(data as string));
    await refresh();
    setBusy(false);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Walk me home' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {myWalk ? (
          <View style={styles.section}>
            <Text style={typography.heading}>
              {myWalk.status === 'overdue'
                ? '⏰ Your timer ran out'
                : `🚶 Walking to ${myWalk.place_name}`}
            </Text>
            {myWalk.status === 'overdue' ? (
              <Text style={typography.body}>
                Your circle was alerted with your last known location. Tap "I'm safe" if you're
                okay — or just arrive and it clears on its own.
              </Text>
            ) : (
              <Text style={typography.body}>
                Due {formatClockTime(myWalk.expected_by)} · {formatTimeLeft(myWalk.expected_by, now)}{' '}
                left. Your circle is told when you arrive; if you haven't by then, an SOS goes out
                automatically.
              </Text>
            )}
            <Button title="I'm safe" onPress={handleSafe} loading={busy} />
            {myWalk.status === 'active' && (
              <Button title="Need 10 more minutes" variant="secondary" onPress={handleExtend} disabled={busy} />
            )}
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={typography.body}>
                Your circle sees you're on your way and hears when you arrive. If you don't get
                there — or tap "I'm safe" — before the timer ends, an SOS goes out automatically
                with your last known location.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Where to</Text>
              {places.length === 0 ? (
                <>
                  <Text style={typography.caption}>
                    Add a place first (like Home) — a walk needs a destination to arrive at.
                  </Text>
                  <Button title="Manage places" variant="secondary" onPress={() => router.push('/places')} />
                </>
              ) : (
                places.map((place) => {
                  const selected = place.id === placeId;
                  return (
                    <Pressable
                      key={place.id}
                      style={[styles.placeRow, selected && styles.placeRowSelected]}
                      onPress={() => setPlaceId(place.id)}
                      accessibilityState={{ selected }}
                    >
                      <Text style={styles.placeText}>
                        {placeIcon(place.name)} {place.name}
                      </Text>
                      {selected && <Text style={styles.check}>✓</Text>}
                    </Pressable>
                  );
                })
              )}
            </View>

            {places.length > 0 && (
              <>
                <View style={styles.section}>
                  <Text style={styles.label}>How long will it take?</Text>
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
                            {m} min
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={typography.caption}>
                    Turns on location sharing for the walk if it isn't already on.
                  </Text>
                </View>
                <Button title="Start walking" onPress={handleStart} loading={busy} disabled={!placeId} />
              </>
            )}
          </>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
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
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  placeRowSelected: { borderColor: colors.accent, backgroundColor: colors.bgElevated },
  placeText: { fontSize: 16, color: colors.textHeading, fontWeight: '500' },
  check: { color: colors.accent, fontWeight: '700', fontSize: 16 },
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
}));
