import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/format';
import type { LocationView } from '@/lib/types';
import { colors, spacing, typography } from '@/lib/theme';

const LIMIT = 100;

// "Who's checked on me" — the privacy half of Life360's always-on
// visibility: a log of when a circle-mate opened your location history
// (record_location_view, called from the member detail screen — see
// migration ...000028_location_views.sql). Deliberately not every glance
// at the live map, which everyone in a circle already sees continuously.
export default function LocationViewsScreen() {
  const [views, setViews] = useState<LocationView[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('location_views')
        .select('id, viewer_id, viewed_id, created_at, profiles!location_views_viewer_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (!cancelled) {
        setViews((data as unknown as LocationView[]) ?? []);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: "Who's checked on me" }} />
      <FlatList
        contentContainerStyle={styles.content}
        data={views}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={
          <Text style={typography.caption}>
            Whenever someone opens your location history, it shows up here.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={typography.body}>{item.profiles?.full_name ?? 'Someone'}</Text>
            <Text style={typography.caption}>{timeAgo(item.created_at)}</Text>
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <Text style={[typography.body, styles.empty]}>No one has checked on you yet.</Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  empty: { marginTop: spacing.lg, textAlign: 'center' },
});
