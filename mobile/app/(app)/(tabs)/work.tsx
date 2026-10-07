import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { useAccount } from '@/contexts/AccountContext';
import { useAuth } from '@/contexts/AuthContext';
import { clockInTo, clockOutOf } from '@/lib/clockIn';
import { formatClockTime, timeAgo } from '@/lib/format';
import { activeOrgs, type OrgMembership } from '@/lib/orgInfo';
import { describeOrgAudit, formatShiftElapsed, shiftAutoEndsAt } from '@/lib/shift';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface ViewRow {
  viewer_name: string;
  viewer_role: string | null;
  action: string;
  created_at: string;
}

// The work-crew home: clock in and out, see exactly who can see you right
// now, and see who has looked. Visibility is enforced in the database
// (migration ...000048): managers and admins see a worker only while
// clocked in, only positions recorded during the shift, and every look is
// logged — which is the list at the bottom.
export default function WorkScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { orgs, refresh } = useAccount();
  const [busyOrg, setBusyOrg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, ViewRow[]>>({});
  const [newCode, setNewCode] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());

  const mine = activeOrgs(orgs);
  const onShiftElsewhere = (orgId: string) =>
    mine.some((o) => o.on_shift && o.org_id !== orgId);
  const anyOnShift = mine.some((o) => o.on_shift);

  useEffect(() => {
    if (!anyOnShift) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [anyOnShift]);

  const loadViews = useCallback(async () => {
    const workerOrgs = activeOrgs(orgs).filter((o) => o.role === 'worker');
    const entries = await Promise.all(
      workerOrgs.map(async (o) => {
        const { data } = await supabase.rpc('org_my_views', { p_org: o.org_id, p_limit: 10 });
        return [o.org_id, (data as ViewRow[] | null) ?? []] as const;
      }),
    );
    setViews(Object.fromEntries(entries));
  }, [orgs]);

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  async function doClockIn(org: OrgMembership) {
    if (!session) return;
    setError(null);
    setNotice(null);
    setBusyOrg(org.org_id);
    const result = await clockInTo(org.org_id, session.user.id);
    setBusyOrg(null);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    if (!result.background) {
      setNotice(
        'Your location is sent only while Safe Circle is open on this phone. Keep it open during your shift.',
      );
    }
    await refresh();
  }

  function handleClockIn(org: OrgMembership) {
    Alert.alert(
      `Clock in to ${org.name}?`,
      'Your admins and managers can see your location until you clock out. Nobody can see you off shift.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clock in', onPress: () => doClockIn(org) },
      ],
    );
  }

  async function handleClockOut(org: OrgMembership) {
    if (!session) return;
    setError(null);
    setNotice(null);
    setBusyOrg(org.org_id);
    const result = await clockOutOf(session.user.id);
    setBusyOrg(null);
    if (!result.ok) {
      setError(
        `Your location has stopped sending, but we couldn't record your clock-out (${result.reason}). Tap Clock out again when you have a connection.`,
      );
    }
    await refresh();
    loadViews();
  }

  async function handleNewCode(org: OrgMembership) {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('regenerate_org_invite_code', {
      p_org: org.org_id,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setNewCode((prev) => ({ ...prev, [org.org_id]: data as string }));
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>Work</Text>

        {mine.map((org) => {
          const isWorker = org.role === 'worker';
          const isAdmin = org.role === 'owner' || org.role === 'admin';
          const busy = busyOrg === org.org_id;

          return (
            <View key={org.org_id} style={styles.card}>
              <Text style={styles.orgName}>{org.name}</Text>
              <Text style={typography.caption}>You are {org.role === 'admin' ? 'an admin' : `a${org.role === 'owner' ? 'n' : ''} ${org.role}`}</Text>

              {isWorker && (
                <>
                  <View style={[styles.status, org.on_shift ? styles.statusOn : styles.statusOff]}>
                    <Text style={styles.statusTitle}>
                      {org.on_shift ? '🟢 On shift' : '⚪ Off shift'}
                    </Text>
                    {org.on_shift && org.shift_started_at ? (
                      <Text style={typography.body}>
                        Since {formatClockTime(org.shift_started_at)} ·{' '}
                        {formatShiftElapsed(org.shift_started_at, now)}
                      </Text>
                    ) : (
                      <Text style={typography.body}>Nobody at work can see your location.</Text>
                    )}
                  </View>

                  {org.on_shift && (
                    <Text style={typography.caption}>
                      Your admins and managers can see your location until you clock out.
                      {org.shift_started_at
                        ? ` If you forget, this shift ends by itself at ${formatClockTime(shiftAutoEndsAt(org.shift_started_at))}.`
                        : ''}
                    </Text>
                  )}

                  {org.on_shift ? (
                    <Button
                      title="Clock out"
                      variant="secondary"
                      onPress={() => handleClockOut(org)}
                      loading={busy}
                    />
                  ) : (
                    <Button
                      title={onShiftElsewhere(org.org_id) ? 'Clock out of your other job first' : 'Clock in'}
                      onPress={() => handleClockIn(org)}
                      loading={busy}
                      disabled={onShiftElsewhere(org.org_id)}
                    />
                  )}

                  <View style={styles.views}>
                    <Text style={styles.sectionLabel}>Who's looked at you</Text>
                    {(views[org.org_id] ?? []).length === 0 ? (
                      <Text style={typography.caption}>
                        No one yet. Every time a manager or admin looks at your location, it
                        shows up here.
                      </Text>
                    ) : (
                      views[org.org_id].map((v, i) => (
                        <Text key={`${v.created_at}-${i}`} style={typography.body}>
                          {v.viewer_name}
                          {v.viewer_role ? ` (${v.viewer_role})` : ''} {describeOrgAudit(v.action)} ·{' '}
                          {timeAgo(v.created_at)}
                        </Text>
                      ))
                    )}
                  </View>
                </>
              )}

              {!isWorker && (
                <>
                  <Text style={typography.body}>
                    {isAdmin
                      ? 'See everyone on your crew who is clocked in.'
                      : 'See the workers on the teams you lead who are clocked in.'}
                  </Text>
                  <Button
                    title="Open crew view"
                    onPress={() =>
                      router.push({ pathname: '/crew', params: { orgId: org.org_id, orgName: org.name } })
                    }
                  />
                </>
              )}

              {isAdmin && (
                <View style={styles.views}>
                  <Text style={styles.sectionLabel}>Invite your crew</Text>
                  {newCode[org.org_id] ? (
                    <Text selectable style={styles.code}>
                      {newCode[org.org_id]}
                    </Text>
                  ) : (
                    <Text style={typography.caption}>
                      Codes expire after 48 hours and are shown once. Making a new one
                      replaces the old one.
                    </Text>
                  )}
                  <Button title="Get a new invite code" variant="secondary" onPress={() => handleNewCode(org)} />
                </View>
              )}
            </View>
          );
        })}

        {notice && <Text style={styles.notice}>{notice}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          title="How your privacy works"
          variant="secondary"
          onPress={() => router.push('/privacy')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  orgName: typography.heading,
  status: { borderRadius: radius.md, padding: spacing.md, gap: 2 },
  statusOn: { backgroundColor: '#dcfce7' },
  statusOff: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  statusTitle: { fontSize: 18, fontWeight: '700', color: colors.textHeading },
  views: { gap: spacing.xs, marginTop: spacing.sm },
  sectionLabel: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  code: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    color: colors.accent,
    paddingVertical: spacing.sm,
  },
  notice: { ...typography.caption, color: colors.stale },
  error: { color: colors.danger, fontSize: 14 },
});
