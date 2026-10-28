import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/format';
import { colors, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

interface PendingRequest {
  id: string;
  circle_id: string;
  created_at: string;
  profiles: { full_name: string } | null;
}

// Join approval (migration ...000041_join_approval.sql): for circles you
// created, require your OK before a new member gets in. A leaked or
// forwarded invite code then only ever creates a request you can deny,
// instead of adding a stranger to a group that can see everyone's live
// location.
export default function JoinRequestsScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { session } = useAuth();
  const { circles, refresh: refreshCircles } = useCircles();
  const mine = circles.filter((c) => c.created_by === session?.user.id);
  const [approval, setApproval] = useState<Record<string, boolean>>({});
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (mine.length === 0) {
      setIsLoading(false);
      return;
    }
    const [{ data: circleRows }, { data: requestRows }] = await Promise.all([
      supabase.from('circles').select('id, require_approval').in('id', mine.map((c) => c.id)),
      supabase
        .from('join_requests')
        .select('id, circle_id, created_at, profiles(full_name)')
        .eq('status', 'pending')
        .order('created_at'),
    ]);
    setApproval(Object.fromEntries((circleRows ?? []).map((c) => [c.id, c.require_approval as boolean])));
    setRequests((requestRows as unknown as PendingRequest[]) ?? []);
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.length]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(circleId: string, next: boolean) {
    setBusyId(circleId);
    const { error } = await supabase.rpc('set_circle_approval', { p_circle_id: circleId, p_required: next });
    setBusyId(null);
    if (error) Alert.alert("Couldn't change that", error.message);
    else setApproval((prev) => ({ ...prev, [circleId]: next }));
  }

  async function decide(id: string, approve: boolean) {
    setBusyId(id);
    const { error } = await supabase.rpc('decide_join_request', { p_request_id: id, p_approve: approve });
    setBusyId(null);
    if (error) Alert.alert("Couldn't do that", error.message);
    await load();
    if (approve) await refreshCircles();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Join approvals' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.body}>
          Require your approval before anyone new can join a circle you created, so a leaked invite
          code can't add a stranger.
        </Text>
        {isLoading ? (
          <ActivityIndicator />
        ) : mine.length === 0 ? (
          <Text style={typography.body}>You haven't created a circle yet.</Text>
        ) : (
          mine.map((circle) => {
            const pending = requests.filter((r) => r.circle_id === circle.id);
            return (
              <View key={circle.id} style={styles.card}>
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.name}>{circle.name}</Text>
                    <Text style={typography.caption}>Require approval to join</Text>
                  </View>
                  {busyId === circle.id ? (
                    <ActivityIndicator />
                  ) : (
                    <Switch
                      accessibilityLabel={`Require approval to join ${circle.name}`}
                      value={approval[circle.id] ?? false}
                      onValueChange={(next) => toggle(circle.id, next)}
                      trackColor={{ true: colors.accent }}
                    />
                  )}
                </View>
                {pending.map((request) => (
                  <View key={request.id} style={styles.request}>
                    <Text style={typography.body}>
                      {request.profiles?.full_name ?? 'Someone'} wants to join ·{' '}
                      {timeAgo(request.created_at)}
                    </Text>
                    <View style={styles.actions}>
                      <View style={styles.action}>
                        <Button
                          title="Approve"
                          onPress={() => decide(request.id, true)}
                          loading={busyId === request.id}
                        />
                      </View>
                      <View style={styles.action}>
                        <Button
                          title="Deny"
                          variant="secondary"
                          onPress={() => decide(request.id, false)}
                          disabled={busyId === request.id}
                        />
                      </View>
                    </View>
                  </View>
                ))}
                {pending.length === 0 && (approval[circle.id] ?? false) && (
                  <Text style={typography.caption}>No pending requests.</Text>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg },
  card: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textHeading },
  request: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
}));
