import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { formatClockTime, formatTimeLeft, timeAgo } from '@/lib/format';
import { ensureSharingFor } from '@/lib/sharingWindow';
import { buildTrackUrl, getWebBaseUrl, isLocalUrl } from '@/lib/shareLink';
import type { ShareLink } from '@/lib/types';
import { colors, radius, spacing, typography } from '@/lib/theme';

const DURATIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: '24 hours', minutes: 1440 },
];

// A live link for someone who doesn't have Safe Circle — a grandparent, a
// friend picking you up. Works in any browser, shows only your latest
// location and first name, and expires on its own (see migration
// ...000043_share_links.sql). Unlike a circle, they never join anything.
export default function ShareLinkScreen() {
  const [minutes, setMinutes] = useState(DURATIONS[1].minutes);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseUrl = getWebBaseUrl();

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('share_links')
      .select('id, expires_at, revoked_at, created_at, view_count, last_viewed_at')
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    setLinks((data as ShareLink[]) ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    // The link is only as useful as the latest location behind it, so make
    // sure something is sharing for its whole life (a no-op if it already is).
    const sharing = await ensureSharingFor(minutes);
    if (!sharing.ok) {
      setError(sharing.reason);
      setBusy(false);
      return;
    }
    const { data: token, error: rpcError } = await supabase.rpc('create_share_link', { p_minutes: minutes });
    if (rpcError || !token) {
      setError(rpcError?.message ?? "Couldn't create the link.");
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
    // The token exists only in this response — the server keeps a hash — so
    // hand it to the share sheet right now.
    try {
      await Share.share({
        message: `Follow my live location for the next ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}: ${buildTrackUrl(baseUrl, token as string)}`,
      });
    } catch {
      // Dismissing the sheet isn't an error — but the link is now unrecoverable
      // (only its hash is stored), which is why it's revocable from the list.
    }
  }

  async function handleRevoke(id: string) {
    await supabase.rpc('revoke_share_link', { p_id: id });
    await load();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Guest link' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.body}>
          Share your live location with someone who doesn't have Safe Circle. They open the link in
          any browser and see where you are — nothing else, no account — until it expires or you
          revoke it.
        </Text>

        {isLocalUrl(baseUrl) && (
          <Text style={styles.warning}>
            The web dashboard isn't deployed yet ({baseUrl}), so this link only opens on this
            network. Deploy it and set EXPO_PUBLIC_WEB_URL for links that work anywhere.
          </Text>
        )}

        <View style={styles.section}>
          <Text style={styles.label}>Link lasts</Text>
          <View style={styles.chipRow}>
            {DURATIONS.map((option) => {
              const selected = option.minutes === minutes;
              return (
                <Pressable
                  key={option.label}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setMinutes(option.minutes)}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Button title="Create link & share" onPress={handleCreate} loading={busy} />
        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.section}>
          <Text style={styles.label}>Active links</Text>
          {isLoading ? (
            <ActivityIndicator />
          ) : links.length === 0 ? (
            <Text style={typography.caption}>None right now.</Text>
          ) : (
            links.map((link) => (
              <View key={link.id} style={styles.linkRow}>
                <View style={styles.linkText}>
                  <Text style={typography.body}>
                    Expires {formatClockTime(link.expires_at)} · {formatTimeLeft(link.expires_at)} left
                  </Text>
                  <Text style={typography.caption}>
                    {link.view_count === 0
                      ? 'Not opened yet'
                      : `Opened ${link.view_count} ${link.view_count === 1 ? 'time' : 'times'} · last ${timeAgo(link.last_viewed_at!)}`}
                  </Text>
                </View>
                <Pressable onPress={() => handleRevoke(link.id)} hitSlop={8}>
                  <Text style={styles.revoke}>Revoke</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
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
  warning: { color: colors.stale, fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  linkText: { flex: 1, gap: 2 },
  revoke: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14 },
});
