import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { ErrorText } from '@/components/ErrorText';
import type { CrewShift } from '@/lib/crew';
import { fetchSchedule, planVsActual, type ScheduleRow } from '@/lib/schedule';
import { shareTextFile } from '@/lib/shareFile';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';
import {
  buildTimesheet,
  DAY_LABELS,
  daysToFetch,
  hours,
  MAX_WEEKS_BACK,
  timesheetCsv,
  timesheetFilename,
  weekLabel,
  weekStart,
} from '@/lib/timesheet';
import { t } from '@/lib/i18n';

// Weekly hours for owners, admins and managers (lib/timesheet.ts), with a CSV
// for payroll. Uses org_shifts(), so managers see only the teams they lead.
// Still available after a plan ends: a company's own records aren't held back.
export default function TimesheetsScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { orgId, orgName } = useLocalSearchParams<{ orgId: string; orgName?: string }>();
  const name = orgName ? String(orgName) : 'Organization';
  const [weeksBack, setWeeksBack] = useState(0);
  const [shifts, setShifts] = useState<CrewShift[]>([]);
  const [planned, setPlanned] = useState<ScheduleRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const start = useMemo(() => weekStart(new Date(), weeksBack), [weeksBack]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('org_shifts', {
        p_org: orgId,
        p_days: daysToFetch(start, new Date()),
        p_limit: 500,
      });
      // planned shifts (migration ...000074); none on an older server
      const schedule = await fetchSchedule(orgId, start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7));
      if (cancelled) return;
      setPlanned(schedule.rows);
      if (rpcError) setError(rpcError.message);
      else setShifts((data as CrewShift[] | null) ?? []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, start]);

  const sheet = useMemo(() => buildTimesheet(shifts, start), [shifts, start]);
  const plannedFor = (userId?: string) => planVsActual(userId ? planned.filter((p) => p.user_id === userId) : planned);
  const totalPlan = plannedFor();

  async function handleExport() {
    setExportError(null);
    const result = await shareTextFile(
      timesheetFilename(sheet, name),
      timesheetCsv(sheet, name),
      'text/csv',
      'Save or send the timesheet',
    );
    if (!result.ok) setExportError(result.error);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Timesheets', headerBackTitle: 'Work' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text maxFontSizeMultiplier={1.3} style={typography.title}>{name}</Text>

        <View style={styles.weekRow}>
          <Button
            title={t('‹ Earlier')}
            variant="secondary"
            onPress={() => setWeeksBack((w) => w + 1)}
            disabled={weeksBack >= MAX_WEEKS_BACK}
          />
          <View style={styles.weekLabel}>
            <Text style={styles.weekText}>{weekLabel(sheet)}</Text>
            <Text style={typography.caption}>{weeksBack === 0 ? t('This week') : weeksBack === 1 ? t('Last week') : t('{n} weeks ago', { n: weeksBack })}</Text>
          </View>
          <Button title={t('Later ›')} variant="secondary" onPress={() => setWeeksBack((w) => w - 1)} disabled={weeksBack === 0} />
        </View>

        {error && <ErrorText style={styles.error}>{error}</ErrorText>}

        {loaded && !error && (
          <>
            <View style={styles.total}>
              <Text maxFontSizeMultiplier={1.3} style={styles.totalHours}>{hours(sheet.totalMinutes)} h</Text>
              <Text style={typography.caption}>
                {sheet.rows.length === 0
                  ? t('No shifts this week.')
                  : t(sheet.rows.length === 1 ? 'worked by 1 worker' : 'worked by {n} workers', { n: sheet.rows.length })}
              </Text>
              {totalPlan.shifts > 0 && (
                <Text style={typography.caption}>
                  {t('{h} h planned · {late} late · {missed} missed', { h: hours(totalPlan.plannedMinutes), late: totalPlan.late, missed: totalPlan.missed })}
                </Text>
              )}
            </View>

            {sheet.rows.map((r) => (
              <View key={r.userId} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.worker}>{r.name}</Text>
                  <Text style={styles.worker}>{hours(r.totalMinutes)} h</Text>
                </View>
                <Text style={typography.caption}>
                  {r.shifts.length} {r.shifts.length === 1 ? 'shift' : 'shifts'}
                  {r.onShift ? ' · on shift now, counted up to now' : ''}
                  {r.former ? ' · has left the organization' : ''}
                  {plannedFor(r.userId).shifts > 0 ? ` · ${t('{h} h planned', { h: hours(plannedFor(r.userId).plannedMinutes) })}` : ''}
                </Text>
                <View style={styles.days}>
                  {DAY_LABELS.map((d, i) => (
                    <View key={d} style={styles.day}>
                      <Text style={typography.caption}>{d}</Text>
                      <Text style={r.days[i] > 0 ? styles.dayHours : styles.dayNone}>
                        {r.days[i] > 0 ? hours(r.days[i]) : '–'}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}

            {sheet.rows.length > 0 && (
              <Button title={t('Download timesheet (CSV)')} onPress={handleExport} />
            )}
            {exportError && <ErrorText style={styles.error}>{exportError}</ErrorText>}
          </>
        )}

        <Text style={typography.caption}>
          {t('Shift times only, never locations. Managers see only the teams they lead. A shift counts up to 14 hours, when it ends by itself, and overnight shifts are split at midnight. Owners and admins also see people who have left, for the weeks they worked.')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  weekLabel: { flex: 1, alignItems: 'center' },
  weekText: { fontSize: 15, fontWeight: '600', color: colors.textHeading, textAlign: 'center' },
  total: { alignItems: 'center', paddingVertical: spacing.sm },
  totalHours: { fontSize: 34, fontWeight: '700', color: colors.textHeading },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between' },
  worker: typography.heading,
  days: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  day: { alignItems: 'center', flex: 1 },
  dayHours: { fontSize: 13, fontWeight: '600', color: colors.textHeading },
  dayNone: { fontSize: 13, color: colors.border },
  error: { color: colors.danger, fontSize: 14 },
}));
