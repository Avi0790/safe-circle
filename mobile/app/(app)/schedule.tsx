import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { ErrorText } from '@/components/ErrorText';
import { TextField } from '@/components/TextField';
import { ShiftRequests } from '@/components/ShiftRequests';
import { Card, Chip, SectionTitle, ui } from '@/components/ui/AppUI';
import { useAccount } from '@/contexts/AccountContext';
import { useAuth } from '@/contexts/AuthContext';
import { announce } from '@/lib/announce';
import type { RosterMember } from '@/lib/crew';
import { formatClockTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import {
  cancelShift,
  dayLabel,
  fetchSchedule,
  NOTE_MAX,
  planShift,
  requestShiftDrop,
  planVsActual,
  SHIFT_LENGTHS,
  shiftTimes,
  startTimes,
  statusInfo,
  timeRange,
  upcomingDays,
  type ScheduleRow,
} from '@/lib/schedule';
import { supabase } from '@/lib/supabase';
import { hours, weekLabel, weekStart } from '@/lib/timesheet';
import { colors, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

// Planned shifts (lib/schedule.ts). A worker sees their own; owners, admins
// and managers see the week for the workers they oversee, plan new shifts and
// see each one against the real clock-in.
export default function ScheduleScreen() {
  useThemeVersion(); // redraw on a theme or language switch (lib/theme.ts)
  const { orgId, orgName } = useLocalSearchParams<{ orgId: string; orgName?: string }>();
  const { session } = useAuth();
  const { orgs } = useAccount();
  const org = orgs.find((o) => o.org_id === orgId);
  const overseer = !!org && org.role !== 'worker';
  const name = orgName ? String(orgName) : org?.name ?? t('Organization');

  const [weeksBack, setWeeksBack] = useState(0); // negative = weeks ahead
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workers, setWorkers] = useState<RosterMember[]>([]);
  const [planning, setPlanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [requestsVersion, setRequestsVersion] = useState(0);

  const start = useMemo(() => weekStart(new Date(), weeksBack), [weeksBack]);
  const end = useMemo(() => new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7), [start]);

  const load = useCallback(async () => {
    if (!orgId) return;
    const result = await fetchSchedule(orgId, start, end);
    setError(result.error ? t(result.error) : null);
    setRows(result.rows);
  }, [orgId, start, end]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!overseer || !orgId) return;
    supabase.rpc('org_roster', { p_org: orgId }).then(({ data }) => {
      const list = ((data as RosterMember[] | null) ?? []).filter(
        (m) => m.role === 'worker' && m.status === 'active' && m.consented_at,
      );
      setWorkers(list.sort((a, b) => a.full_name.localeCompare(b.full_name)));
    });
  }, [overseer, orgId]);

  const mine = useMemo(
    () => (overseer ? rows ?? [] : (rows ?? []).filter((r) => r.user_id === session?.user.id)),
    [rows, overseer, session?.user.id],
  );
  const totals = planVsActual(mine);
  const byDay = useMemo(() => {
    const groups = new Map<string, ScheduleRow[]>();
    for (const r of mine) {
      const k = new Date(r.starts_at).toDateString();
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.entries()];
  }, [mine]);

  function askToDrop(r: ScheduleRow) {
    Alert.alert(t("Can't make this shift?"), `${dayLabel(r.starts_at)}, ${timeRange(r.starts_at, r.ends_at)}`, [
      { text: t('Keep it'), style: 'cancel' },
      {
        text: t('Ask to be taken off'),
        onPress: async () => {
          setBusyId(r.id);
          const result = await requestShiftDrop(r.id);
          setBusyId(null);
          if (!result.ok) setError(t(result.error));
          else {
            announce(t('Asked. Your managers have been told.'));
            setRequestsVersion((v) => v + 1);
          }
        },
      },
    ]);
  }

  function confirmCancel(r: ScheduleRow) {
    Alert.alert(
      t('Cancel this shift?'),
      `${r.worker_name ?? ''} · ${dayLabel(r.starts_at)}, ${timeRange(r.starts_at, r.ends_at)}`,
      [
        { text: t('Keep it'), style: 'cancel' },
        {
          text: t('Cancel shift'),
          style: 'destructive',
          onPress: async () => {
            setBusyId(r.id);
            const result = await cancelShift(r.id);
            setBusyId(null);
            if (!result.ok) setError(t(result.error));
            else {
              announce(t('Shift cancelled'));
              load();
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: t('Schedule'), headerBackTitle: t('Work') }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text maxFontSizeMultiplier={1.3} style={typography.title}>{name}</Text>

        <View style={styles.weekRow}>
          <Button title={t('‹ Earlier')} variant="secondary" onPress={() => setWeeksBack((w) => w + 1)} disabled={weeksBack >= 8} />
          <View style={styles.weekLabel}>
            <Text style={styles.weekText}>{weekLabel({ weekStart: start })}</Text>
            <Text style={typography.caption}>
              {weeksBack === 0 ? t('This week') : weeksBack === -1 ? t('Next week') : weeksBack === 1 ? t('Last week') : ''}
            </Text>
          </View>
          <Button title={t('Later ›')} variant="secondary" onPress={() => setWeeksBack((w) => w - 1)} disabled={weeksBack <= -3} />
        </View>

        {error && <ErrorText style={styles.error}>{error}</ErrorText>}

        {rows && totals.shifts > 0 && (
          <View style={styles.totals} accessible>
            <View style={styles.total}>
              <Text style={styles.totalNumber}>{hours(totals.plannedMinutes)}</Text>
              <Text style={typography.caption}>{t('hours planned')}</Text>
            </View>
            <View style={styles.total}>
              <Text style={styles.totalNumber}>{hours(totals.workedMinutes)}</Text>
              <Text style={typography.caption}>{t('hours worked')}</Text>
            </View>
            <View style={styles.total}>
              <Text style={[styles.totalNumber, totals.late + totals.missed > 0 && { color: colors.danger }]}>
                {totals.late + totals.missed}
              </Text>
              <Text style={typography.caption}>{t('late or missed')}</Text>
            </View>
          </View>
        )}

        {orgId && (
          <ShiftRequests
            orgId={orgId}
            overseer={overseer}
            version={requestsVersion}
            onChanged={() => load()}
          />
        )}

        {overseer && !planning && (
          <Button title={t('Plan a shift')} onPress={() => setPlanning(true)} disabled={workers.length === 0} />
        )}
        {overseer && workers.length === 0 && (
          <Text style={typography.caption}>{t('Once workers have joined and accepted, you can plan their shifts here.')}</Text>
        )}
        {overseer && planning && orgId && (
          <PlanForm
            orgId={orgId}
            workers={workers}
            onDone={(planned) => {
              setPlanning(false);
              if (planned) {
                announce(t('Shift planned'));
                load();
              }
            }}
          />
        )}

        {rows && mine.length === 0 && (
          <Text style={styles.empty}>{overseer ? t('No shifts planned this week.') : t('No shifts planned for you this week.')}</Text>
        )}

        {byDay.map(([day, list]) => (
          <Card key={day}>
            <SectionTitle>{dayLabel(list[0].starts_at)}</SectionTitle>
            {list.map((r, i) => {
              const s = statusInfo(r.status);
              return (
                <View key={r.id}>
                  {i > 0 && <View style={ui.divider} />}
                  <View style={styles.shiftRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={ui.rowTitle}>
                        {overseer ? `${r.worker_name ?? t('Worker')} · ` : ''}
                        {timeRange(r.starts_at, r.ends_at)}
                      </Text>
                      <Text style={ui.rowSub}>
                        {t(s.label)}
                        {r.clocked_in_at ? ` · ${t('clocked in {time}', { time: formatClockTime(r.clocked_in_at) })}` : ''}
                        {r.job_site ? ` · ${r.job_site}` : ''}
                      </Text>
                      {r.note ? <Text style={ui.rowSub}>{r.note}</Text> : null}
                    </View>
                    <View style={[styles.dot, { backgroundColor: toneColor(s.tone) }]} />
                  </View>
                  {overseer && new Date(r.starts_at).getTime() > Date.now() && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('Cancel {name}\'s shift', { name: r.worker_name ?? t('Worker') })}
                      onPress={() => confirmCancel(r)}
                      disabled={busyId === r.id}
                      hitSlop={8}
                    >
                      <Text style={styles.cancel}>{t('Cancel shift')}</Text>
                    </Pressable>
                  )}
                  {!overseer && new Date(r.starts_at).getTime() > Date.now() && (
                    <Pressable accessibilityRole="button" onPress={() => askToDrop(r)} disabled={busyId === r.id} hitSlop={8}>
                      <Text style={styles.askOff}>{t("Can't make it?")}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </Card>
        ))}

        <Text style={typography.caption}>
          {overseer
            ? t('Workers get a notification when a shift is planned or cancelled, and a reminder on their phone half an hour before it starts. Late means clocked in more than 10 minutes after the start; missed means no clock-in within an hour.')
            : t("Your phone reminds you half an hour before each shift, even without signal. A planned shift doesn't clock you in: you still clock in when you start.")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function toneColor(tone: 'muted' | 'good' | 'warn' | 'danger') {
  return tone === 'good' ? colors.online : tone === 'warn' ? colors.stale : tone === 'danger' ? colors.danger : colors.border;
}

function PlanForm({
  orgId,
  workers,
  onDone,
}: {
  orgId: string;
  workers: RosterMember[];
  onDone: (planned: boolean) => void;
}) {
  const days = useMemo(() => upcomingDays(), []);
  const times = useMemo(() => startTimes(), []);
  const [worker, setWorker] = useState<string | null>(workers.length === 1 ? workers[0].user_id : null);
  const [dayIndex, setDayIndex] = useState(1);
  const [timeIndex, setTimeIndex] = useState(times.findIndex((x) => x.hour === 7 && x.minute === 0));
  const [length, setLength] = useState(8);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { starts, ends } = shiftTimes(days[dayIndex], times[timeIndex].hour, times[timeIndex].minute, length);

  async function save() {
    if (!worker) return;
    setBusy(true);
    setError(null);
    const result = await planShift({ orgId, userId: worker, starts, ends, note });
    setBusy(false);
    if (!result.ok) setError(t(result.error));
    else onDone(true);
  }

  return (
    <Card>
      <SectionTitle>{t('Plan a shift')}</SectionTitle>
      <Text style={styles.label}>{t('Who')}</Text>
      <View style={ui.chips}>
        {workers.map((w) => (
          <Chip key={w.user_id} label={w.full_name} selected={worker === w.user_id} onPress={() => setWorker(w.user_id)} />
        ))}
      </View>

      <Text style={styles.label}>{t('Day')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ui.chips}>
        {days.map((d, i) => (
          <Chip key={d.toISOString()} label={i === 0 ? t('Today') : dayLabel(d)} selected={dayIndex === i} onPress={() => setDayIndex(i)} />
        ))}
      </ScrollView>

      <Text style={styles.label}>{t('Starts')}</Text>
      <View style={styles.stepper}>
        <Button title={t('− 30 min')} variant="secondary" onPress={() => setTimeIndex((i) => Math.max(0, i - 1))} />
        <Text style={styles.stepperText} accessibilityLiveRegion="polite">{formatClockTime(starts.toISOString())}</Text>
        <Button title={t('+ 30 min')} variant="secondary" onPress={() => setTimeIndex((i) => Math.min(times.length - 1, i + 1))} />
      </View>

      <Text style={styles.label}>{t('Length')}</Text>
      <View style={ui.chips}>
        {SHIFT_LENGTHS.map((h) => (
          <Chip key={h} label={t('{n} h', { n: h })} selected={length === h} onPress={() => setLength(h)} />
        ))}
      </View>

      <TextField label={t('Note (optional)')} placeholder={t('Where to go, what to bring')} value={note} onChangeText={setNote} maxLength={NOTE_MAX} />

      <Text style={typography.caption}>
        {dayLabel(starts)} · {timeRange(starts.toISOString(), ends.toISOString())}
      </Text>
      {error && <ErrorText style={styles.error}>{error}</ErrorText>}
      <View style={styles.formButtons}>
        <View style={{ flex: 1 }}>
          <Button title={t('Cancel')} variant="secondary" onPress={() => onDone(false)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={t('Save shift')} onPress={save} loading={busy} disabled={!worker} />
        </View>
      </View>
    </Card>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  weekLabel: { flex: 1, alignItems: 'center' },
  weekText: { fontSize: 15, fontWeight: '600', color: colors.textHeading, textAlign: 'center' },
  totals: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm },
  total: { alignItems: 'center' },
  totalNumber: { fontSize: 26, fontWeight: '700', color: colors.textHeading },
  empty: { ...typography.body, textAlign: 'center', paddingVertical: spacing.md },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cancel: { color: colors.danger, fontWeight: '700', fontSize: 14, marginTop: spacing.xs },
  askOff: { color: colors.accent, fontWeight: '700', fontSize: 14, marginTop: spacing.xs },
  label: { fontSize: 13, fontWeight: '700', color: colors.textHeading, marginTop: spacing.xs },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepperText: { fontSize: 20, fontWeight: '700', color: colors.textHeading, minWidth: 100, textAlign: 'center' },
  formButtons: { flexDirection: 'row', gap: spacing.sm },
  error: { color: colors.danger, fontSize: 14 },
}));
