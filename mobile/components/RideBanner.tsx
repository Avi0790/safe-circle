import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useNow } from '@/hooks/useNow';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/format';
import type { RideRequest } from '@/lib/types';
import { colors, radius, spacing } from '@/lib/theme';
import { t } from '@/lib/i18n';

// Open requests older than this are dead (accept_ride refuses them too).
const OPEN_TTL_MS = 30 * 60_000;

// Ride requests from the circle, plus the state of your own. Everyone in a
// circle can see an open request and claim it; only people who were driving
// nearby got the push (see request_ride in migration ...000027).
export function RideBanner({
  requests,
  onChanged,
  onAskEveryone,
}: {
  requests: RideRequest[];
  onChanged: () => void;
  onAskEveryone: () => void;
}) {
  const { session } = useAuth();
  const now = useNow(30_000);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Other people's open requests you've waved off on this device. Only
  // hides them here — the request itself stays open for everyone else.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const me = session?.user.id;

  const visible = requests.filter((r) => {
    if (r.status === 'open') {
      if (r.user_id !== me && dismissed.has(r.id)) return false;
      return now - new Date(r.created_at).getTime() < OPEN_TTL_MS;
    }
    // Accepted: matters to the requester and the driver, not to bystanders.
    return r.user_id === me || r.accepted_by === me;
  });
  if (visible.length === 0) return null;

  async function run(id: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusyId(id);
    const { error } = await fn();
    setBusyId(null);
    if (error) Alert.alert(t("Couldn't do that"), error.message);
    onChanged();
  }

  return (
    <View style={styles.container}>
      {visible.map((r) => {
        const isMine = r.user_id === me;
        const name = r.requester?.full_name ?? 'Someone';
        const busy = busyId === r.id;

        let title: string;
        let detail: string | null = null;
        let actions: { label: string; onPress: () => void }[] = [];

        if (isMine && r.status === 'open') {
          title = '🚗 Looking for a ride…';
          detail =
            r.notified_count > 0
              ? `Sent to ${r.notified_count} ${r.notified_count === 1 ? 'person' : 'people'} driving nearby.`
              : "Nobody's driving near you right now.";
          actions = [
            ...(r.notified_count === 0 ? [{ label: 'Ask everyone', onPress: onAskEveryone }] : []),
            { label: 'Cancel', onPress: () => run(r.id, () => supabase.rpc('cancel_ride', { p_request_id: r.id })) },
          ];
        } else if (isMine) {
          title = `🚗 ${r.driver?.full_name ?? 'Someone'} is on the way`;
          actions = [
            { label: 'Got my ride', onPress: () => run(r.id, () => supabase.rpc('cancel_ride', { p_request_id: r.id })) },
          ];
        } else if (r.status === 'accepted') {
          // You're the driver.
          title = `🚗 Picking up ${name}`;
          actions = [
            {
              label: 'Directions',
              onPress: () =>
                Linking.openURL(
                  `https://www.google.com/maps/dir/?api=1&destination=${r.latitude},${r.longitude}`,
                ).catch(() => {}),
            },
          ];
        } else {
          title = `🚗 ${name} needs a ride`;
          detail = `Asked ${timeAgo(r.created_at)}`;
          actions = [
            { label: "I'll go", onPress: () => run(r.id, () => supabase.rpc('accept_ride', { p_request_id: r.id })) },
            { label: 'Not now', onPress: () => setDismissed((prev) => new Set(prev).add(r.id)) },
          ];
        }

        return (
          <View key={r.id} style={styles.banner}>
            <View style={styles.text}>
              <Text style={styles.title}>{title}</Text>
              {detail && <Text style={styles.detail}>{detail}</Text>}
            </View>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.actions}>
                {actions.map((a) => (
                  <Pressable accessibilityRole="button" key={a.label} style={styles.button} onPress={a.onPress}>
                    <Text style={styles.buttonText}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#0ea5e9',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  text: { flex: 1, gap: 2 },
  title: { color: '#fff', fontWeight: '700', fontSize: 15 },
  detail: { color: '#fff', fontSize: 13, opacity: 0.9 },
  actions: { gap: spacing.xs },
  button: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
