import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CrewMap } from '@/components/CrewMap';
import type { CrewShift, TrackPoint } from '@/lib/crew';
import { formatClockTime } from '@/lib/format';
import { formatShiftElapsed } from '@/lib/shift';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

// One worker's recent shifts and the path they covered during them. The
// track comes from org_worker_track, which only returns positions recorded
// inside a shift — personal time before clock-in or after clock-out is never
// part of it — and opening this logs the look for the worker to see.
export default function CrewWorkerScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { orgId, userId, name } = useLocalSearchParams<{ orgId: string; userId: string; name?: string }>();
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [shifts, setShifts] = useState<CrewShift[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !userId) return;
    let cancelled = false;
    (async () => {
      const to = new Date();
      const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
      const [trackRes, shiftRes] = await Promise.all([
        supabase.rpc('org_worker_track', {
          p_org: orgId,
          p_user: userId,
          p_from: from.toISOString(),
          p_to: to.toISOString(),
        }),
        supabase.rpc('org_shifts', { p_org: orgId, p_days: 7, p_limit: 200 }),
      ]);
      if (cancelled) return;
      if (trackRes.error || shiftRes.error) {
        setError((trackRes.error ?? shiftRes.error)!.message);
      } else {
        setTrack((trackRes.data as TrackPoint[]) ?? []);
        setShifts(((shiftRes.data as CrewShift[]) ?? []).filter((s) => s.user_id === userId));
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, userId]);

  const path = track.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  const last = track[track.length - 1];

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: name ? String(name) : 'Worker' }} />
      <ScrollView>
        <CrewMap
          path={path}
          markers={
            last
              ? [{ id: 'last', title: 'Last position', latitude: last.latitude, longitude: last.longitude }]
              : []
          }
        />
        <View style={styles.body}>
          <Text style={typography.caption}>
            Showing the last 24 hours, and only time spent on shift. Nothing before they clocked in
            or after they clocked out is ever shown. {name ? `${name} can` : 'They can'} see that you
            looked.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
          {loaded && !error && track.length === 0 && (
            <Text style={typography.body}>No on-shift positions in the last 24 hours.</Text>
          )}
          {track.length > 0 && (
            <Text style={typography.body}>{track.length} positions recorded on shift.</Text>
          )}

          <Text style={styles.sectionLabel}>Recent shifts</Text>
          {loaded && shifts.length === 0 && <Text style={typography.caption}>No shifts in the last 7 days.</Text>}
          {shifts.map((s) => (
            <View key={s.shift_id} style={styles.card}>
              <Text style={styles.shiftTitle}>
                {new Date(s.clocked_in_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
              </Text>
              <Text style={typography.caption}>
                {formatClockTime(s.clocked_in_at)} – {s.is_open ? 'now' : formatClockTime(s.ended_at)} ·{' '}
                {formatShiftElapsed(s.clocked_in_at, new Date(s.ended_at).getTime())}
                {s.is_open ? ' (on shift)' : ''}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.sm },
  sectionLabel: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
  },
  shiftTitle: { fontSize: 15, fontWeight: '600', color: colors.textHeading },
  error: { color: colors.danger, fontSize: 14 },
}));
