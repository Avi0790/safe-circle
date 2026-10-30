import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CrewMap, type CrewMapMarker } from '@/components/CrewMap';
import { SosBanner } from '@/components/SosBanner';
import { ErrorText } from '@/components/ErrorText';
import { useActiveSosEvents } from '@/hooks/useActiveSosEvents';
import {
  crewSummary,
  hasPosition,
  splitCrew,
  workerFlags,
  type LiveWorker,
  type RosterMember,
} from '@/lib/crew';
import { formatClockTime, timeAgo } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';
import { t } from '@/lib/i18n';

const POLL_MS = 30_000;

// The crew view for owners, admins and managers: who's clocked in, where
// they were last heard from, and who's gone quiet. It only polls while the
// screen is open. Each worker you can see is logged as having been looked
// at (deduped to once per 15 minutes) and they can read that in their Work
// tab — which is also why this screen says so.
export default function CrewScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const router = useRouter();
  const { orgId, orgName } = useLocalSearchParams<{ orgId: string; orgName?: string }>();
  const { events: sosEvents, refresh: refreshSos } = useActiveSosEvents();
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [live, setLive] = useState<LiveWorker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [rosterRes, liveRes] = await Promise.all([
      supabase.rpc('org_roster', { p_org: orgId }),
      supabase.rpc('org_live_roster', { p_org: orgId }),
    ]);
    if (rosterRes.error || liveRes.error) {
      setError((rosterRes.error ?? liveRes.error)!.message);
    } else {
      setError(null);
      setRoster((rosterRes.data as RosterMember[]) ?? []);
      setLive((liveRes.data as LiveWorker[]) ?? []);
    }
    setLoaded(true);
  }, [orgId]);

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, POLL_MS);
      return () => clearInterval(id);
    }, [load]),
  );

  const split = splitCrew(roster, live);
  const markers: CrewMapMarker[] = split.onShift.filter(hasPosition).map((w) => ({
    id: w.user_id,
    title: w.full_name,
    description: w.recorded_at ? `Updated ${timeAgo(w.recorded_at)}` : undefined,
    latitude: w.latitude,
    longitude: w.longitude,
    stale: workerFlags(w).stale,
  }));

  function openWorker(userId: string, name: string) {
    router.push({ pathname: '/crew-worker', params: { orgId, userId, name } });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: orgName ? String(orgName) : 'Crew', headerBackTitle: 'Work' }} />
      <SosBanner events={sosEvents} onChanged={refreshSos} />
      <ScrollView>
        <CrewMap markers={markers} />

        <View style={styles.body}>
          <Text style={styles.summary}>{loaded ? crewSummary(split) : 'Loading…'}</Text>
          <Text style={typography.caption}>
            {t("Workers can see when you look at their location, in their Work tab. You only ever see people while they're clocked in.")}
          </Text>
          {error && <ErrorText style={styles.error}>{error}</ErrorText>}

          {split.onShift.length > 0 && <Text style={styles.sectionLabel} accessibilityRole="header">{t('On shift')}</Text>}
          {split.onShift.map((w) => {
            const f = workerFlags(w);
            return (
              <Pressable accessibilityRole="button" key={w.user_id} style={styles.card} onPress={() => openWorker(w.user_id, w.full_name)}>
                <Text style={styles.name}>{w.full_name}</Text>
                <Text style={typography.caption}>
                  On since {formatClockTime(w.clocked_in_at)}
                  {w.team_names ? ` · ${w.team_names}` : ''}
                </Text>
                <Text style={f.stale || f.noFix ? styles.warn : typography.caption}>
                  {f.noFix
                    ? 'No location yet'
                    : `Last heard from ${timeAgo(w.recorded_at as string)}${f.stale ? ' — may be offline' : ''}`}
                  {f.driving && f.mph != null ? ` · 🚗 ${Math.round(f.mph)} mph` : ''}
                  {f.lowBattery ? ' · 🪫 low battery' : ''}
                </Text>
              </Pressable>
            );
          })}

          {split.offShift.length > 0 && <Text style={styles.sectionLabel} accessibilityRole="header">{t('Off shift')}</Text>}
          {split.offShift.map((m) => (
            <View key={m.user_id} style={styles.cardQuiet}>
              <Text style={styles.name}>{m.full_name}</Text>
              <Text style={typography.caption}>{t('Off shift — no location is shown.')}</Text>
            </View>
          ))}

          {split.pending.length > 0 && <Text style={styles.sectionLabel} accessibilityRole="header">{t('Waiting to accept')}</Text>}
          {split.pending.map((m) => (
            <View key={m.user_id} style={styles.cardQuiet}>
              <Text style={styles.name}>{m.full_name}</Text>
              <Text style={typography.caption}>
                {t("Joined with your code but hasn't accepted the disclosure yet.")}
              </Text>
            </View>
          ))}

          {loaded && !error && roster.filter((m) => m.role === 'worker').length === 0 && (
            <Text style={typography.body}>
              {t('No crew members to show yet. Admins can invite people from the Work tab; managers see the workers on teams they lead.')}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.sm },
  summary: typography.heading,
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
  cardQuiet: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.textHeading },
  warn: { fontSize: 13, color: colors.stale },
  error: { color: colors.danger, fontSize: 14 },
}));
