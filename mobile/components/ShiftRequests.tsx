import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { ErrorText } from '@/components/ErrorText';
import { TextField } from '@/components/TextField';
import { Card, Chip, SectionTitle, ui } from '@/components/ui/AppUI';
import { announce } from '@/lib/announce';
import { t } from '@/lib/i18n';
import {
  dayLabel,
  decideShiftRequest,
  fetchShiftRequests,
  NOTE_MAX,
  requestStatusLabel,
  requestTimeOff,
  requestWhen,
  TIME_OFF_DAYS,
  timeOffSpan,
  upcomingDays,
  withdrawShiftRequest,
  type ShiftRequest,
} from '@/lib/schedule';
import { supabase } from '@/lib/supabase';
import { colors, spacing, themed, typography } from '@/lib/theme';

// Time off and "I can't make this shift" (lib/schedule.ts), on the Schedule
// screen. Workers ask and see what was answered; owners, admins and managers
// approve or decline what's waiting. `version` changes when the screen asks
// for something itself, so the list reloads.
export function ShiftRequests({
  orgId,
  overseer,
  version,
  onChanged,
}: {
  orgId: string;
  overseer: boolean;
  version: number;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<ShiftRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchShiftRequests(orgId);
    if (result.error) setError(t(result.error));
    setRows(result.rows);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load, version]);

  useEffect(() => {
    const channel = supabase
      .channel(`shift-requests-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_requests', filter: `org_id=eq.${orgId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, load]);

  async function act(id: string, run: () => Promise<{ ok: true } | { ok: false; error: string }>, said: string) {
    setBusyId(id);
    setError(null);
    const result = await run();
    setBusyId(null);
    if (!result.ok) setError(t(result.error));
    else {
      announce(said);
      onChanged();
    }
    load();
  }

  const pending = rows.filter((r) => r.status === 'pending');
  const shown = overseer ? pending : rows.slice(0, 8);

  return (
    <>
      {!overseer && !asking && <Button title={t('Ask for time off')} variant="secondary" onPress={() => setAsking(true)} />}
      {!overseer && asking && (
        <TimeOffForm
          orgId={orgId}
          onDone={(sent) => {
            setAsking(false);
            if (sent) {
              announce(t('Asked. Your managers have been told.'));
              load();
            }
          }}
        />
      )}

      {error && <ErrorText style={styles.error}>{error}</ErrorText>}

      {shown.length > 0 && (
        <Card>
          <SectionTitle>{overseer ? t('Waiting for you ({n})', { n: pending.length }) : t('Your requests')}</SectionTitle>
          {shown.map((r, i) => (
            <View key={r.id} style={styles.row}>
              {i > 0 && <View style={ui.divider} />}
              <Text style={ui.rowTitle}>
                {r.kind === 'time_off' ? '🏖️ ' : '🔁 '}
                {overseer ? `${r.worker_name ?? t('Worker')} · ` : ''}
                {r.kind === 'time_off' ? t('Time off') : t("Can't make this shift")}
              </Text>
              <Text style={ui.rowSub}>{requestWhen(r)}</Text>
              {r.note ? <Text style={ui.rowSub}>“{r.note}”</Text> : null}
              {!overseer && (
                <Text style={[ui.rowSub, r.status === 'declined' && { color: colors.danger }]}>
                  {t(requestStatusLabel(r.status))}
                  {r.decided_by_name ? ` · ${r.decided_by_name}` : ''}
                </Text>
              )}
              {overseer && r.can_decide && (
                <View style={styles.buttons}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={t('Decline')}
                      variant="secondary"
                      loading={busyId === r.id}
                      onPress={() => act(r.id, () => decideShiftRequest(r.id, false), t('Declined'))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={t('Approve')}
                      loading={busyId === r.id}
                      onPress={() => act(r.id, () => decideShiftRequest(r.id, true), t('Approved'))}
                    />
                  </View>
                </View>
              )}
              {!overseer && r.status === 'pending' && (
                <Button
                  title={t('Withdraw')}
                  variant="secondary"
                  loading={busyId === r.id}
                  onPress={() => act(r.id, () => withdrawShiftRequest(r.id), t('Withdrawn'))}
                />
              )}
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

function TimeOffForm({ orgId, onDone }: { orgId: string; onDone: (sent: boolean) => void }) {
  const days = useMemo(() => upcomingDays(new Date(), 60), []);
  const [first, setFirst] = useState(1);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const span = timeOffSpan(days[first], count);

  async function send() {
    setBusy(true);
    setError(null);
    const result = await requestTimeOff(orgId, span.from, span.to, note);
    setBusy(false);
    if (!result.ok) setError(t(result.error));
    else onDone(true);
  }

  return (
    <Card>
      <SectionTitle>{t('Ask for time off')}</SectionTitle>
      <Text style={styles.label}>{t('From')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ui.chips}>
        {days.map((d, i) => (
          <Chip key={d.toISOString()} label={i === 0 ? t('Today') : dayLabel(d)} selected={first === i} onPress={() => setFirst(i)} />
        ))}
      </ScrollView>
      <Text style={styles.label}>{t('For')}</Text>
      <View style={ui.chips}>
        {TIME_OFF_DAYS.map((n) => (
          <Chip key={n} label={n === 1 ? t('1 day') : t('{n} days', { n })} selected={count === n} onPress={() => setCount(n)} />
        ))}
      </View>
      <TextField label={t('Note (optional)')} placeholder={t('Why, if you want to say')} value={note} onChangeText={setNote} maxLength={NOTE_MAX} />
      <Text style={typography.caption}>{requestWhen({ kind: 'time_off', starts_at: span.from.toISOString(), ends_at: span.to.toISOString() })}</Text>
      {error && <ErrorText style={styles.error}>{error}</ErrorText>}
      <View style={styles.buttons}>
        <View style={{ flex: 1 }}>
          <Button title={t('Cancel')} variant="secondary" onPress={() => onDone(false)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={t('Send request')} onPress={send} loading={busy} />
        </View>
      </View>
    </Card>
  );
}

const styles = themed(() => StyleSheet.create({
  row: { gap: 4 },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  label: { fontSize: 13, fontWeight: '700', color: colors.textHeading, marginTop: spacing.xs },
  error: { color: colors.danger, fontSize: 14 },
}));
