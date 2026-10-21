import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import type { CrewShift } from '@/lib/crew';
import { shareTextFile } from '@/lib/shareFile';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
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

// Weekly hours for owners, admins and managers (lib/timesheet.ts), with a CSV
// for payroll. Uses org_shifts(), so managers see only the teams they lead.
// Still available after a plan ends: a company's own records aren't held back.
export default function TimesheetsScreen() {
  const { orgId, orgName } = useLocalSearchParams<{ orgId: string; orgName?: string }>();
  const name = orgName ? String(orgName) : 'Organization';
  const [weeksBack, setWeeksBack] = useState(0);
  const [shifts, setShifts] = useState<CrewShift[]>([]);
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
      if (cancelled) return;
      if (rpcError) setError(rpcError.message);
      else setShifts((data as CrewShift[] | null) ?? []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, start]);

  const sheet = useMemo(() => buildTimesheet(shifts, start), [shifts, start]);

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
        <Text style={typography.title}>{name}</Text>

        <View style={styles.weekRow}>
          <Button
            title="‹ Earlier"
            variant="secondary"
            onPress={() => setWeeksBack((w) => w + 1)}
            disabled={weeksBack >= MAX_WEEKS_BACK}
          />
          <View style={styles.weekLabel}>
            <Text style={styles.weekText}>{weekLabel(sheet)}</Text>
            <Text style={typography.caption}>{weeksBack === 0 ? 'This week' : weeksBack === 1 ? 'Last week' : `${weeksBack} weeks ago`}</Text>
          </View>
          <Button title="Later ›" variant="secondary" onPress={() => setWeeksBack((w) => w - 1)} disabled={weeksBack === 0} />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {loaded && !error && (
          <>
            <View style={styles.total}>
              <Text style={styles.totalHours}>{hours(sheet.totalMinutes)} h</Text>
              <Text style={typography.caption}>
                {sheet.rows.length === 0
                  ? 'No shifts this week.'
                  : `worked by ${sheet.rows.length} ${sheet.rows.length === 1 ? 'worker' : 'workers'}`}
              </Text>
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
              <Button title="Download timesheet (CSV)" onPress={handleExport} />
            )}
            {exportError && <Text style={styles.error}>{exportError}</Text>}
          </>
        )}

        <Text style={typography.caption}>
          Shift times only, never locations. Managers see only the teams they lead. A shift counts up
          to 14 hours, when it ends by itself, and overnight shifts are split at midnight. Workers who
          have left the organization aren&apos;t listed.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
});
