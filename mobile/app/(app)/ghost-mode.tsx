import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { Avatar } from '@/components/Avatar';
import { supabase } from '@/lib/supabase';
import { colors, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

// Ghost mode: hide your location from one specific circle-mate while
// everyone else still sees you normally — Life360 has no per-person
// visibility control, only circle-wide. A hidden person's map just shows
// your dot missing, same as if you'd stopped sharing (see migration
// ...000035_ghost_mode.sql) — this screen is the only place that says who,
// on purpose, so it isn't obvious from the outside.
export default function GhostModeScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { session } = useAuth();
  const { selectedCircle } = useCircles();
  const { members, isLoading: membersLoading } = useCircleMembers(selectedCircle?.id ?? null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('hidden_from').select('hidden_from_id');
    setHiddenIds(new Set((data ?? []).map((row) => row.hidden_from_id as string)));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(userId: string, hide: boolean) {
    setError(null);
    setBusyId(userId);
    const { error: rpcError } = await supabase.rpc(hide ? 'hide_from' : 'unhide_from', {
      p_user_id: userId,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (hide) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  const others = members.filter((m) => m.id !== session?.user.id);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Ghost mode' }} />
      <View style={styles.content}>
        <Text style={typography.body}>
          Hide your location from specific people without turning off sharing entirely — everyone
          else in your circles still sees you as usual.
        </Text>
        {isLoading || membersLoading ? (
          <ActivityIndicator />
        ) : (
          <View style={styles.list}>
            {others.map((member) => {
              const hidden = hiddenIds.has(member.id);
              return (
                <View key={member.id} style={styles.row}>
                  <Avatar id={member.id} name={member.full_name} url={member.avatar_url} size={36} />
                  <Text style={styles.name}>{member.full_name}</Text>
                  {busyId === member.id ? (
                    <ActivityIndicator />
                  ) : (
                    <Switch
                      value={hidden}
                      onValueChange={(next) => toggle(member.id, next)}
                      trackColor={{ true: colors.textHeading }}
                    />
                  )}
                </View>
              );
            })}
            {others.length === 0 && (
              <Text style={typography.body}>No one else in this circle yet.</Text>
            )}
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
  list: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  name: { flex: 1, fontSize: 16, color: colors.textHeading, fontWeight: '500' },
  error: { color: colors.danger, fontSize: 14 },
}));
