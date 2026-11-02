import { useCallback, useEffect, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { useAccount } from '@/contexts/AccountContext';
import { useAuth } from '@/contexts/AuthContext';
import { announce } from '@/lib/announce';
import { timeAgo } from '@/lib/format';
import { t } from '@/lib/i18n';
import { activeOrgs } from '@/lib/orgInfo';
import { answerRollCallOrQueue } from '@/lib/outbox';
import { currentPosition, unansweredRollCalls, type RollCallAnswer, type RollCallSummary } from '@/lib/rollCall';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, themed, useThemeVersion } from '@/lib/theme';

type Pending = RollCallSummary & { orgId: string };

// When your work asks "Is everyone OK?" (lib/rollCall.ts), this covers
// whatever screen is open until you answer: "I'm safe" or "I need help".
// Watches for new roll calls through Realtime and when the app comes back to
// the front, so it's there as soon as the push is tapped.
export function RollCallPrompt() {
  useThemeVersion(); // redraw on a theme or language switch (lib/theme.ts)
  const { session } = useAuth();
  const { orgs } = useAccount();
  const userId = session?.user.id;
  const orgIds = activeOrgs(orgs).filter((o) => o.role === 'worker').map((o) => o.org_id);
  const key = orgIds.join(',');
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<RollCallAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId || orgIds.length === 0) {
      setPending([]);
      return;
    }
    setPending(await unansweredRollCalls(orgIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key]);

  useEffect(() => {
    load();
    if (!userId || orgIds.length === 0) return;
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    const channel = supabase
      .channel(`roll-call-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_roll_call_members', filter: `user_id=eq.${userId}` }, () => load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'org_roll_calls' }, () => load())
      .subscribe();
    return () => {
      app.remove();
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const current = pending[0];
  useEffect(() => {
    if (current) Vibration.vibrate([0, 400, 200, 400]);
  }, [current?.id]);

  async function answer(a: RollCallAnswer) {
    if (!current) return;
    setBusy(a);
    setError(null);
    const result = await answerRollCallOrQueue(current.id, a, await currentPosition());
    setBusy(null);
    if (!result.ok) {
      setError(t(result.error));
      if (/closed|not found/i.test(result.error)) load();
      return;
    }
    const said = a === 'safe' ? t("Thanks. They know you're safe.") : t('The people who oversee you have been told, with where you are.');
    announce(result.queued ? `${said} ${t("It's sent as soon as you have signal.")}` : said);
    setPending((p) => p.filter((r) => r.id !== current.id));
  }

  if (!current) return null;
  const org = orgs.find((o) => o.org_id === current.orgId);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => {}}>
      <View style={styles.page} accessibilityViewIsModal>
        <Text allowFontScaling={false} style={styles.emoji}>📣</Text>
        <Text accessibilityRole="header" style={styles.title}>{t('Roll call: are you safe?')}</Text>
        <Text style={styles.from}>
          {t('{name} at {org} is checking on everyone on shift · {ago}', {
            name: current.started_by_name ?? t('Your manager'),
            org: org?.name ?? '',
            ago: timeAgo(current.created_at),
          })}
        </Text>
        {current.note ? <Text style={styles.note}>“{current.note}”</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("I'm safe")}
          onPress={() => answer('safe')}
          disabled={busy !== null}
          style={({ pressed }) => [styles.big, styles.safe, pressed && styles.pressed]}
        >
          <Text style={styles.bigText}>{busy === 'safe' ? t('Sending…') : `✅ ${t("I'm safe")}`}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('I need help')}
          accessibilityHint={t('Tells the people who oversee you, with where you are.')}
          onPress={() => answer('help')}
          disabled={busy !== null}
          style={({ pressed }) => [styles.big, styles.help, pressed && styles.pressed]}
        >
          <Text style={styles.bigText}>{busy === 'help' ? t('Sending…') : `🆘 ${t('I need help')}`}</Text>
        </Pressable>

        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Text style={styles.small}>
          {t('Your answer goes with where you are, because you are on shift. In danger right now? Call 911.')}
        </Text>
      </View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
  emoji: { fontSize: 56, textAlign: 'center' },
  title: { fontSize: 30, fontWeight: '800', color: colors.textHeading, textAlign: 'center' },
  from: { fontSize: 16, color: colors.text, textAlign: 'center', lineHeight: 22 },
  note: { fontSize: 18, fontWeight: '600', color: colors.textHeading, textAlign: 'center' },
  big: { borderRadius: radius.md, paddingVertical: 22, alignItems: 'center' },
  safe: { backgroundColor: '#15803d' },
  help: { backgroundColor: colors.dangerFill },
  pressed: { opacity: 0.85 },
  bigText: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  small: { fontSize: 13, color: colors.text, textAlign: 'center', lineHeight: 18 },
}));
