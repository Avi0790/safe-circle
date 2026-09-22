import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { supabase } from '@/lib/supabase';
import { isDriving, speedToMph, timeAgo } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';

interface HistoryPing {
  id: number;
  latitude: number;
  longitude: number;
  battery_level: number | null;
  speed: number | null;
  recorded_at: string;
}

const HISTORY_LIMIT = 100;

// Location history stretch goal (proposal page 3). `locations` is already
// append-only, so this is purely a new read — no backend changes needed.
export default function MemberHistoryScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const [fullName, setFullName] = useState('');
  const [pings, setPings] = useState<HistoryPing[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function load() {
      const [{ data: profile }, { data: locations }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', userId).single(),
        supabase
          .from('locations')
          .select('id, latitude, longitude, battery_level, speed, recorded_at')
          .eq('user_id', userId)
          .order('recorded_at', { ascending: false })
          .limit(HISTORY_LIMIT),
      ]);
      if (cancelled) return;
      setFullName(profile?.full_name ?? 'Member');
      setPings((locations as HistoryPing[]) ?? []);
      setIsLoading(false);
    }

    load();
    // Logs that you looked at this person's location (deduped server-side to
    // once per 15 min) — see migration ...000028_location_views.sql. A no-op
    // when userId is your own id.
    supabase.rpc('record_location_view', { p_viewed_id: userId }).then(() => {}, () => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const chronological = [...pings].reverse();
  const maxSpeedMph = pings.reduce<number | null>((max, p) => {
    const mph = speedToMph(p.speed);
    if (mph == null) return max;
    return max == null || mph > max ? mph : max;
  }, null);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: fullName || 'History' }} />

      {chronological.length > 0 && (
        <MapView
          provider={PROVIDER_DEFAULT}
          style={styles.map}
          initialRegion={{
            latitude: chronological[chronological.length - 1].latitude,
            longitude: chronological[chronological.length - 1].longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
          <Polyline
            coordinates={chronological.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))}
            strokeColor={colors.accent}
            strokeWidth={3}
          />
          <Marker
            coordinate={chronological[0]}
            pinColor="green"
            title="Oldest"
          />
          <Marker
            coordinate={chronological[chronological.length - 1]}
            title="Most recent"
          />
        </MapView>
      )}

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={pings}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.sectionLabel}>
              Last {pings.length} location{pings.length === 1 ? '' : 's'}
            </Text>
            {maxSpeedMph != null && (
              <Text style={typography.caption}>
                🚗 Max speed: {Math.round(maxSpeedMph)} mph
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={typography.body}>{timeAgo(item.recorded_at)}</Text>
            <Text style={typography.caption}>
              {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
              {item.battery_level != null ? ` · ${Math.round(item.battery_level * 100)}%` : ''}
              {isDriving(item.speed)
                ? ` · 🚗 ${Math.round(speedToMph(item.speed)!)} mph`
                : ''}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? <Text style={typography.body}>No location history yet.</Text> : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  map: { height: '40%' },
  list: { flex: 1 },
  listContent: { padding: spacing.lg, gap: spacing.xs },
  header: { gap: 2, marginBottom: spacing.xs },
  sectionLabel: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  row: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
});
