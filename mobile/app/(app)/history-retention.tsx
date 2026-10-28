import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

interface RetentionOption {
  label: string;
  days: number | null;
}

const OPTIONS: RetentionOption[] = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'Forever', days: null },
];

// Auto-delete history: pick how long your own location trail is kept.
// Enforced by a daily job on the server (purge_old_locations, migration
// ...000029_history_retention.sql), not just hidden in the UI — and your
// current pin on the map is never deleted, however old your last update is.
export default function HistoryRetentionScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { session } = useAuth();
  const [days, setDays] = useState<number | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('history_retention_days')
        .eq('id', session.user.id)
        .single();
      setDays(data?.history_retention_days ?? null);
    })();
  }, [session]);

  async function choose(option: RetentionOption) {
    setError(null);
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('set_history_retention', { p_days: option.days });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setDays(option.days);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Location history' }} />
      <View style={styles.content}>
        <Text style={typography.body}>
          How long your location history (the trail on your circle-mates' member screens) is
          kept before it's deleted for good. Your current location is always kept, no matter what
          you choose.
        </Text>
        {days === undefined ? (
          <ActivityIndicator />
        ) : (
          <View style={styles.options}>
            {OPTIONS.map((option) => {
              const selected = option.days === days;
              return (
                <Pressable
                  key={option.label}
                  style={[styles.row, selected && styles.rowSelected]}
                  onPress={() => choose(option)}
                  disabled={saving}
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.rowText}>{option.label}</Text>
                  {selected && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })}
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg },
  options: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowSelected: { borderColor: colors.accent, backgroundColor: colors.bgElevated },
  rowText: { fontSize: 16, color: colors.textHeading, fontWeight: '500' },
  check: { color: colors.accent, fontWeight: '700', fontSize: 16 },
  error: { color: colors.danger, fontSize: 14 },
}));
