import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';

interface HistoryPing {
  id: number;
  latitude: number;
  longitude: number;
  battery_level: number | null;
  recorded_at: string;
}

const HISTORY_LIMIT = 100;

// Web fallback: react-native-maps has no web renderer (see the Map tab's
// own index.web.tsx). Same data, list-only instead of a map trail.
export default function MemberHistoryScreenWeb() {
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
          .select('id, latitude, longitude, battery_level, recorded_at')
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
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: fullName || 'History' }} />
      <FlatList
        contentContainerStyle={styles.listContent}
        data={pings}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={
          <Text style={styles.sectionLabel}>
            Last {pings.length} location{pings.length === 1 ? '' : 's'}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={typography.body}>{timeAgo(item.recorded_at)}</Text>
            <Text style={typography.caption}>
              {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
              {item.battery_level != null ? ` · ${Math.round(item.battery_level * 100)}%` : ''}
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
  listContent: { padding: spacing.lg, gap: spacing.xs },
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
