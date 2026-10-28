import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { SosBanner } from '@/components/SosBanner';
import { SosButton } from '@/components/SosButton';
import { ErrorText } from '@/components/ErrorText';
import {
  ActionTile,
  Card,
  Chip,
  HeroButton,
  HeroCard,
  Initials,
  LiveElapsed,
  Pill,
  SeatMeter,
  SectionTitle,
  ui,
  appColors,
} from '@/components/ui/AppUI';
import { useAccount } from '@/contexts/AccountContext';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveSosEvents } from '@/hooks/useActiveSosEvents';
import { announce } from '@/lib/announce';
import { checkInNow, clockInTo, clockOutOf } from '@/lib/clockIn';
import { formatClockTime, timeAgo } from '@/lib/format';
import { jobSiteRemindersOn, setJobSiteReminders } from '@/lib/jobSiteReminders';
import { activeOrgs, ORG_DISCLOSURE, type OrgMembership } from '@/lib/orgInfo';
import { DEMO_SEAT_OPTIONS, planSummary, seatsFull, workerPlanNotice } from '@/lib/orgPlan';
import { describeOrgAudit, shiftAutoEndsAt } from '@/lib/shift';
import { supabase } from '@/lib/supabase';
import { colors, isDark, themed, useThemeVersion } from '@/lib/theme';

// How often a lone worker wants to be asked "are you OK?" — and the people
// who oversee them alerted if they don't answer (migration ...000053).
const CHECKIN_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: 'No check-ins', minutes: null },
  { label: 'Every 30 min', minutes: 30 },
  { label: 'Every hour', minutes: 60 },
  { label: 'Every 2 hours', minutes: 120 },
];

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', worker: 'Worker' };

function youAre(role: string): string {
  return `You are ${role === 'admin' || role === 'owner' ? 'an' : 'a'} ${role}`;
}

// The plan in a word or two, for the crew card's stat.
function planWord(org: OrgMembership): string | null {
  switch (org.plan_state) {
    case 'trial':
      return 'Trial';
    case 'active':
      return 'Active';
    case 'grace':
      return 'Payment due';
    case 'ended':
      return 'Ended';
    default:
      return null;
  }
}

function todayLabel(now: number): string {
  return new Date(now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
}

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
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const router = useRouter();
  const { session } = useAuth();
  const { orgs, refresh } = useAccount();
  const { events: sosEvents, refresh: refreshSos } = useActiveSosEvents();
  const [busyOrg, setBusyOrg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, ViewRow[]>>({});
  const [newCode, setNewCode] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const [checkinChoice, setCheckinChoice] = useState<number | null>(null);
  const [siteReminders, setSiteReminders] = useState(false);
  const [siteNote, setSiteNote] = useState<string | null>(null);

  useEffect(() => {
    jobSiteRemindersOn().then(setSiteReminders);
  }, []);

  async function toggleSiteReminders(on: boolean) {
    setSiteNote(null);
    const result = await setJobSiteReminders(on);
    if (!result.ok) {
      setSiteReminders(false);
      setSiteNote(result.reason);
      return;
    }
    setSiteReminders(on);
    if (on) {
      setSiteNote(
        result.sites === 0
          ? 'On. Your organizations have no job sites yet; reminders start when they add some.'
          : `On. Watching ${result.sites} job ${result.sites === 1 ? 'site' : 'sites'}.`,
      );
    }
  }

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
    const result = await clockInTo(org.org_id, session.user.id, checkinChoice);
    setBusyOrg(null);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    announce(`Clocked in to ${org.name}`);
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
      'Your admins and managers can see your location until you clock out. Nobody can see you off shift.' +
        (checkinChoice != null
          ? ` If you miss a check-in (every ${checkinChoice} min), they're alerted with your last location.`
          : ''),
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
    } else {
      announce(`Clocked out of ${org.name}`);
    }
    await refresh();
    loadViews();
  }

  async function handleAcceptUpdate(org: OrgMembership) {
    setError(null);
    setBusyOrg(org.org_id);
    const { error: rpcError } = await supabase.rpc('accept_org_consent', { p_org: org.org_id });
    setBusyOrg(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refresh();
  }

  async function handleCheckIn(org: OrgMembership) {
    setError(null);
    setBusyOrg(org.org_id);
    const result = await checkInNow();
    setBusyOrg(null);
    if (!result.ok) {
      setError(result.reason);
    } else {
      announce('Checked in');
    }
    await refresh();
    refreshSos();
  }

  // Demo billing (migration ...000064): owner only, no money moves. A real
  // payment provider would change the plan from its webhook instead.
  async function doBilling(org: OrgMembership, action: string, seats?: number) {
    setError(null);
    setBusyOrg(org.org_id);
    const { error: rpcError } = await supabase.rpc('org_demo_billing', {
      p_org: org.org_id,
      p_action: action,
      p_seats: seats ?? null,
    });
    setBusyOrg(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refresh();
  }

  function confirmBilling(org: OrgMembership, action: 'cancel' | 'end_trial') {
    Alert.alert(
      action === 'cancel' ? `Cancel ${org.name}'s plan?` : 'End the trial now?',
      "Workers won't be able to start new shifts and nobody new can join. Shifts already running, clocking out and SOS keep working.",
      [
        { text: 'Keep it', style: 'cancel' },
        { text: action === 'cancel' ? 'Cancel plan' : 'End trial', style: 'destructive', onPress: () => doBilling(org, action) },
      ],
    );
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

  function renderWorker(org: OrgMembership) {
    const busy = busyOrg === org.org_id;
    const ended = !org.on_shift && !!workerPlanNotice(org);
    const elsewhere = onShiftElsewhere(org.org_id);
    const heroColors = org.on_shift ? appColors.onShift : ended ? appColors.ended : appColors.offShift;
    const tint = heroColors[0];
    const overdue = !!org.next_checkin_due && new Date(org.next_checkin_due).getTime() < now;
    const looks = views[org.org_id] ?? [];

    if (org.needs_reconsent) {
      return (
        <View key={org.org_id} style={styles.org}>
          <Card tone="warn">
            <Text style={ui.rowTitle}>{org.name}</Text>
            <Text style={styles.body}>
              What {org.name} can see about you has changed. Until you review and accept it, you can't clock in and
              nobody at work can see you.
            </Text>
            <View style={styles.list}>
              {ORG_DISCLOSURE.map((line) => (
                <Text key={line} style={styles.body}>
                  •  {line}
                </Text>
              ))}
            </View>
            <Button title="I understand — keep working here" onPress={() => handleAcceptUpdate(org)} loading={busy} />
          </Card>
        </View>
      );
    }

    return (
      <View key={org.org_id} style={styles.org}>
        <HeroCard colors={heroColors}>
          <View style={ui.heroTop}>
            <Text maxFontSizeMultiplier={1.5} style={ui.heroOrg} numberOfLines={2}>
              {org.name}
            </Text>
            <Pill>{org.on_shift ? '🟢 On shift' : '⚪ Off shift'}</Pill>
          </View>
          <Text style={ui.heroRole}>{youAre(org.role)}</Text>

          {org.on_shift && org.shift_started_at ? (
            <>
              <LiveElapsed since={org.shift_started_at} style={ui.heroBig} />
              <Text style={ui.heroBody}>
                Since {formatClockTime(org.shift_started_at)} · this shift ends by itself at{' '}
                {formatClockTime(shiftAutoEndsAt(org.shift_started_at))}
              </Text>
              <Text style={ui.heroSmall}>Your admins and managers can see your location until you clock out.</Text>
            </>
          ) : (
            <>
              <Text maxFontSizeMultiplier={1.3} style={[ui.heroBig, styles.heroWords]}>{ended ? 'Plan ended' : 'Off the clock'}</Text>
              <Text style={ui.heroBody}>Nobody at work can see your location.</Text>
              {ended && <Text style={ui.heroSmall}>{workerPlanNotice(org)}</Text>}
            </>
          )}

          {org.on_shift ? (
            <HeroButton title="Clock out" icon="⏹" outline tint={tint} onPress={() => handleClockOut(org)} loading={busy} />
          ) : (
            <HeroButton
              title={ended ? 'Plan ended — ask your owner' : elsewhere ? 'Clock out of your other job first' : 'Clock in'}
              icon={ended || elsewhere ? undefined : '⏱'}
              tint={tint}
              onPress={() => handleClockIn(org)}
              loading={busy}
              disabled={elsewhere || ended}
            />
          )}
        </HeroCard>

        {org.on_shift && org.checkin_minutes != null && org.next_checkin_due && (
          <Card tone={overdue ? 'danger' : undefined}>
            <View style={ui.row}>
              <Text allowFontScaling={false} style={styles.bigEmoji}>{overdue ? '⏰' : '✅'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[ui.rowTitle, overdue && { color: colors.danger }]}>
                  {overdue ? "Check-in overdue — tap I'm OK now." : `Next check-in due at ${formatClockTime(org.next_checkin_due)}.`}
                </Text>
                <Text style={ui.rowSub}>Every {org.checkin_minutes} min while you're on shift</Text>
              </View>
            </View>
            <Button title="I'm OK" onPress={() => handleCheckIn(org)} loading={busy} />
          </Card>
        )}

        {!org.on_shift && !ended && (
          <Card>
            <SectionTitle>Check-in reminders</SectionTitle>
            <Text style={styles.caption}>
              Working alone? Choose how often to check in. Miss one and your admins and managers are alerted with your
              last location.
            </Text>
            <View style={ui.chips}>
              {CHECKIN_OPTIONS.map((o) => (
                <Chip key={o.label} label={o.label} selected={checkinChoice === o.minutes} onPress={() => setCheckinChoice(o.minutes)} />
              ))}
            </View>
          </Card>
        )}

        <Card>
          <SectionTitle>Who's looked at you</SectionTitle>
          {looks.length === 0 ? (
            <Text style={styles.caption}>
              No one yet. Every time a manager or admin looks at your location, it shows up here.
            </Text>
          ) : (
            looks.map((v, i) => (
              <View key={`${v.created_at}-${i}`}>
                {i > 0 && <View style={ui.divider} />}
                <View style={ui.row}>
                  <Initials name={v.viewer_name} />
                  <View style={{ flex: 1 }}>
                    <Text style={ui.rowTitle}>
                      {v.viewer_name}
                      {v.viewer_role ? ` (${v.viewer_role})` : ''}
                    </Text>
                    <Text style={ui.rowSub}>
                      {describeOrgAudit(v.action)} · {timeAgo(v.created_at)}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </Card>
      </View>
    );
  }

  function renderOverseer(org: OrgMembership) {
    const busy = busyOrg === org.org_id;
    const isAdmin = org.role === 'owner' || org.role === 'admin';
    const summary = org.plan_state != null ? planSummary(org, now) : null;
    const word = planWord(org);

    return (
      <View key={org.org_id} style={styles.org}>
        <HeroCard colors={appColors.crew}>
          <View style={ui.heroTop}>
            <Text maxFontSizeMultiplier={1.5} style={ui.heroOrg} numberOfLines={2}>
              {org.name}
            </Text>
            <Pill>{ROLE_LABEL[org.role] ?? org.role}</Pill>
          </View>
          <Text style={ui.heroRole}>{youAre(org.role)}</Text>
          {isAdmin && (
            <View style={styles.stats}>
              <View style={ui.stat}>
                <Text maxFontSizeMultiplier={1.4} style={ui.statValue}>{org.seats_used ?? '–'}</Text>
                <Text maxFontSizeMultiplier={1.4} style={ui.statLabel}>{org.seats_used === 1 ? 'Worker' : 'Workers'}</Text>
              </View>
              <View style={ui.stat}>
                <Text maxFontSizeMultiplier={1.4} style={ui.statValue}>
                  {org.seats_used != null && org.seat_limit != null ? `${org.seats_used}/${org.seat_limit}` : '–'}
                </Text>
                <Text maxFontSizeMultiplier={1.4} style={ui.statLabel}>Seats</Text>
              </View>
              {word && (
                <View style={ui.stat}>
                  <Text maxFontSizeMultiplier={1.4} style={ui.statValue} numberOfLines={1} adjustsFontSizeToFit>
                    {word}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={ui.statLabel}>Plan</Text>
                </View>
              )}
            </View>
          )}
          <Text style={ui.heroBody}>
            {isAdmin
              ? 'See everyone on your crew who is clocked in.'
              : 'See the workers on the teams you lead who are clocked in.'}
          </Text>
          <HeroButton
            title="Open crew view"
            icon="🗺"
            tint={appColors.crew[1]}
            onPress={() => router.push({ pathname: '/crew', params: { orgId: org.org_id, orgName: org.name } })}
          />
        </HeroCard>

        <View style={ui.tiles}>
          <ActionTile
            icon="🕒"
            title="Timesheets"
            caption="Hours and payroll CSV"
            onPress={() => router.push({ pathname: '/timesheets', params: { orgId: org.org_id, orgName: org.name } })}
          />
          <ActionTile
            icon="📍"
            title="Job sites"
            caption="Clock-in reminders"
            onPress={() => router.push({ pathname: '/job-sites', params: { orgId: org.org_id } })}
          />
          {isAdmin && (
            <ActionTile
              icon="👥"
              title="People & teams"
              caption="Roles, teams and leads"
              accessibilityLabel="Manage people & teams"
              onPress={() => router.push({ pathname: '/crew-manage', params: { orgId: org.org_id, orgName: org.name } })}
            />
          )}
          {isAdmin && (
            <ActionTile
              icon="⚙️"
              title="Settings"
              caption="Rename or delete"
              accessibilityLabel="Organization settings"
              onPress={() => router.push({ pathname: '/org-settings', params: { orgId: org.org_id } })}
            />
          )}
        </View>

        {/* plan_state is missing from a server without migration ...000064 */}
        {isAdmin && summary && (
          <Card tone={summary.tone === 'warn' ? 'warn' : summary.tone === 'ended' ? 'danger' : undefined}>
            <SectionTitle>Plan</SectionTitle>
            <Text style={[styles.planTitle, summary.tone === 'ended' && { color: colors.danger }]}>{summary.title}</Text>
            {org.seats_used != null && org.seat_limit != null && org.seat_limit > 0 && (
              <SeatMeter used={org.seats_used} limit={org.seat_limit} />
            )}
            <Text style={styles.body}>{summary.detail}</Text>
            {org.role === 'owner' ? (
              <>
                <Text style={styles.caption}>
                  Demo billing: no real money moves. Family circles are always free; work organizations are paid per
                  worker seat.
                </Text>
                <Text style={styles.subLabel}>Pay for seats</Text>
                <View style={ui.chips}>
                  {DEMO_SEAT_OPTIONS.map((n) => (
                    <Chip
                      key={n}
                      label={`${n} seats`}
                      accessibilityLabel={`Pay for ${n} seats (demo)`}
                      selected={org.plan_state === 'active' && org.seat_limit === n}
                      onPress={() => doBilling(org, 'activate', n)}
                      disabled={busy}
                    />
                  ))}
                </View>
                <View style={ui.chips}>
                  {org.plan_state === 'trial' && (
                    <Chip
                      label="End trial"
                      accessibilityLabel="End the trial now (demo)"
                      onPress={() => confirmBilling(org, 'end_trial')}
                      disabled={busy}
                    />
                  )}
                  {org.plan_state === 'active' && (
                    <Chip
                      label="Fail a payment"
                      accessibilityLabel="Simulate a failed payment (demo)"
                      onPress={() => doBilling(org, 'payment_failed')}
                      disabled={busy}
                    />
                  )}
                  {(org.plan_state === 'active' || org.plan_state === 'grace') && (
                    <Chip label="Cancel plan" onPress={() => confirmBilling(org, 'cancel')} disabled={busy} />
                  )}
                </View>
              </>
            ) : (
              <Text style={styles.caption}>Only the owner can change the plan.</Text>
            )}
          </Card>
        )}

        {isAdmin && (
          <Card>
            <SectionTitle>Invite your crew</SectionTitle>
            {seatsFull(org) && (
              <Text style={styles.warnText}>
                {org.plan_state === 'ended'
                  ? 'The plan has ended, so nobody new can join.'
                  : 'Every seat is taken. Add seats before inviting more workers, or they won’t be able to join.'}
              </Text>
            )}
            {newCode[org.org_id] ? (
              <View style={styles.codeBox}>
                <Text selectable style={styles.code}>
                  {newCode[org.org_id]}
                </Text>
                <Text style={styles.caption}>Shown once · expires in 48 hours</Text>
              </View>
            ) : (
              <Text style={styles.caption}>
                Codes expire after 48 hours and are shown once. Making a new one replaces the old one.
              </Text>
            )}
            <Button title="Get a new invite code" variant="secondary" onPress={() => handleNewCode(org)} />
          </Card>
        )}
      </View>
    );
  }

  const hasWorker = mine.some((o) => o.role === 'worker');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <SosBanner events={sosEvents} onChanged={refreshSos} />
      <ScrollView contentContainerStyle={[styles.content, hasWorker && { paddingBottom: 120 }]}>
        <View>
          <Text style={styles.date}>{todayLabel(now)}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.title} accessibilityRole="header">Work</Text>
        </View>

        {mine.map((org) => (org.role === 'worker' ? renderWorker(org) : renderOverseer(org)))}

        {hasWorker && (
          <Card>
            <View style={ui.row}>
              <View style={styles.rowIcon}>
                <Text allowFontScaling={false} style={styles.rowEmoji}>📍</Text>
              </View>
              <Text style={[ui.rowTitle, { flex: 1 }]}>Job site reminders</Text>
              <Switch
                value={siteReminders}
                onValueChange={toggleSiteReminders}
                accessibilityLabel="Job site reminders"
                trackColor={{ true: colors.accentFill, false: colors.chip }}
              />
            </View>
            <Text style={styles.caption}>
              When you arrive at one of your organization&apos;s job sites and aren&apos;t clocked in, your phone reminds
              you. Only your phone knows: nobody at work is told you were there.
            </Text>
            {siteNote && <Text style={styles.noteText}>{siteNote}</Text>}
          </Card>
        )}

        {notice && (
        <Text style={styles.noteText} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      )}
        {error && <ErrorText style={styles.error}>{error}</ErrorText>}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/privacy')}
          style={({ pressed }) => [ui.card, ui.row, pressed && { opacity: 0.8 }]}
        >
          <View style={styles.rowIcon}>
            <Text allowFontScaling={false} style={styles.rowEmoji}>🔒</Text>
          </View>
          <Text style={[ui.rowTitle, { flex: 1 }]}>How your privacy works</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </ScrollView>
      {hasWorker && <SosButton onSent={refreshSos} />}
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: appColors.page },
  content: { padding: 16, gap: 16 },
  date: { fontSize: 13, fontWeight: '700', color: appColors.muted, letterSpacing: 0.6 },
  title: { fontSize: 34, fontWeight: '800', color: appColors.ink, letterSpacing: -0.5 },
  org: { gap: 12 },
  heroWords: { fontSize: 38 },
  stats: { flexDirection: 'row', gap: 8, marginVertical: 4 },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  caption: { fontSize: 13, color: appColors.muted, lineHeight: 18 },
  subLabel: { fontSize: 13, fontWeight: '600', color: appColors.ink, marginTop: 4 },
  list: { gap: 6 },
  bigEmoji: { fontSize: 26 },
  planTitle: { fontSize: 22, fontWeight: '800', color: appColors.ink },
  warnText: { fontSize: 13, fontWeight: '600', color: colors.danger },
  noteText: { fontSize: 13, color: isDark ? colors.stale : '#92400e' },
  codeBox: {
    alignItems: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: isDark ? '#4c3a85' : '#d8ccfb',
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: colors.tint,
  },
  code: { fontSize: 32, fontWeight: '800', letterSpacing: 4, color: colors.accent },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEmoji: { fontSize: 18 },
  chevron: { fontSize: 24, color: colors.chevron, fontWeight: '300' },
  error: { color: colors.danger, fontSize: 14 },
}));
