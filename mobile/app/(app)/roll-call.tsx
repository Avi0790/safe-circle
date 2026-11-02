import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { ErrorText } from '@/components/ErrorText';
import { TextField } from '@/components/TextField';
import { Card, SectionTitle, ui } from '@/components/ui/AppUI';
import { announce } from '@/lib/announce';
import { formatClockTime, timeAgo } from '@/lib/format';
import { t } from '@/lib/i18n';
import {
  closeRollCall,
  listRollCalls,
  NOTE_MAX,
  rollCallStatus,
  startRollCall,
  tally,
  tallyLine,
  type RollCallPerson,
  type RollCallSummary,
} from '@/lib/rollCall';
import { supabase } from '@/lib/supabase';
import { colors, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

// "Is everyone OK?" for owners, admins and managers (lib/rollCall.ts): ask
// everyone you oversee who's on shift, then watch the answers come in.
export default function RollCallScreen() {
  useThemeVersion(); // redraw on a theme or language switch (lib/theme.ts)
  const { orgId, orgName } = useLocalSearchParams<{ orgId: string; orgName?: string }>();
  const [list, setList] = useState<RollCallSummary[] | null>(null);
  const [people, setPeople] = useState<RollCallPerson[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = list?.find((r) => !r.closed_at && r.can_close) ?? null;

  const load = useCallback(async () => {
    if (!orgId) return;
    const result = await listRollCalls(orgId);
    if (result.error) setError(t(result.error));
    setList(result.rows);
    const live = result.rows.find((r) => !r.closed_at && r.can_close);
    setPeople(live ? (await rollCallStatus(live.id)).people : []);
  }, [orgId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`roll-call-watch-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_roll_call_members' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_roll_calls', filter: `org_id=eq.${orgId}` }, () => load())
      .subscribe();
    // a fallback for a dropped Realtime connection
    const id = setInterval(load, 15_000);
    return () => {
      clearInterval(id);
      supabase.removeChannel(channel);
    };
  }, [load, orgId]);

  async function start() {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    const result = await startRollCall(orgId, note);
    setBusy(false);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    setNote('');
    announce(t('Roll call sent'));
    load();
  }

  function confirmClose(r: RollCallSummary) {
    const { waiting } = tally(r);
    Alert.alert(
      t('Close the roll call?'),
      waiting > 0 ? t('{n} still haven\'t answered.', { n: waiting }) : t('Everyone has answered.'),
      [
        { text: t('Keep it open'), style: 'cancel' },
        {
          text: t('Close'),
          onPress: async () => {
            const result = await closeRollCall(r.id);
            if (!result.ok) setError(t(result.error));
            load();
          },
        },
      ],
    );
  }

  const past = (list ?? []).filter((r) => r.id !== open?.id).slice(0, 10);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: t('Roll call'), headerBackTitle: t('Work') }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {orgName ? <Text style={typography.title}>{String(orgName)}</Text> : null}
        {error && <ErrorText style={styles.error}>{error}</ErrorText>}

        {list && !open && (
          <Card>
            <SectionTitle>{t('Is everyone OK?')}</SectionTitle>
            <Text style={typography.body}>
              {t('Asks everyone you oversee who is on shift right now to tap "I\'m safe" or "I need help". Anyone who hasn\'t answered in 5 minutes is asked again, and you\'re told who.')}
            </Text>
            <TextField
              label={t('Message (optional)')}
              placeholder={t('Storm warning. Get inside and check in.')}
              value={note}
              onChangeText={setNote}
              maxLength={NOTE_MAX}
            />
            <Button title={t('Start roll call')} onPress={start} loading={busy} />
          </Card>
        )}

        {open && (
          <>
            <View style={styles.tally} accessible accessibilityLabel={tallyLine(open, t)} accessibilityLiveRegion="polite">
              <Count value={open.safe} label={t('safe')} color={colors.online} />
              <Count value={open.help} label={t('need help')} color={colors.danger} />
              <Count value={tally(open).waiting} label={t('no answer')} color={colors.stale} />
            </View>
            <Text style={[typography.caption, { textAlign: 'center' }]}>
              {t('Started {time}', { time: formatClockTime(open.created_at) })}
              {open.note ? ` · “${open.note}”` : ''}
            </Text>

            <Card>
              {people.map((p, i) => (
                <View key={p.user_id}>
                  {i > 0 && <View style={ui.divider} />}
                  <View style={styles.person}>
                    <Text allowFontScaling={false} style={styles.personIcon}>
                      {p.answer === 'help' ? '🆘' : p.answer === 'safe' ? '✅' : '⏳'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[ui.rowTitle, p.answer === 'help' && { color: colors.danger }]}>{p.full_name ?? t('Worker')}</Text>
                      <Text style={ui.rowSub}>
                        {p.answer === 'help'
                          ? t('Needs help · {ago}', { ago: timeAgo(p.answered_at!) })
                          : p.answer === 'safe'
                            ? t('Safe · {ago}', { ago: timeAgo(p.answered_at!) })
                            : t('No answer yet')}
                      </Text>
                    </View>
                    {p.latitude != null && p.longitude != null && (
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={t('Open {name}\'s position in Maps', { name: p.full_name ?? t('Worker') })}
                        onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`)}
                        hitSlop={8}
                      >
                        <Text style={styles.map}>{t('Map')}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}
            </Card>
            <Button title={t('Close roll call')} variant="secondary" onPress={() => confirmClose(open)} />
          </>
        )}

        {past.length > 0 && (
          <Card>
            <SectionTitle>{t('Earlier roll calls')}</SectionTitle>
            {past.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <View style={ui.divider} />}
                <Text style={ui.rowTitle}>
                  {timeAgo(r.created_at)} · {r.started_by_name ?? ''}
                </Text>
                <Text style={ui.rowSub}>{tallyLine(r, t)}</Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Count({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.count}>
      <Text style={[styles.countValue, { color }]}>{value}</Text>
      <Text style={typography.caption}>{label}</Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  tally: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm },
  count: { alignItems: 'center' },
  countValue: { fontSize: 40, fontWeight: '800' },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  personIcon: { fontSize: 20 },
  map: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  error: { color: colors.danger, fontSize: 14 },
}));
