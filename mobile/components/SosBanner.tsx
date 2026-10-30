import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/format';
import { formatMedicalCard } from '@/lib/medicalCard';
import type { SosEvent } from '@/lib/types';
import { colors, radius, spacing, themed, typography } from '@/lib/theme';
import { t } from '@/lib/i18n';

export function SosBanner({ events, onChanged }: { events: SosEvent[]; onChanged: () => void }) {
  const { session } = useAuth();
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<number | null>(null);

  if (events.length === 0) return null;

  async function handleResolve(id: number) {
    setResolvingId(id);
    await supabase
      .from('sos_events')
      .update({ resolved_at: new Date().toISOString(), resolved_by: session?.user.id })
      .eq('id', id);
    setResolvingId(null);
    onChanged();
  }

  // RLS only returns the card while this person's SOS is active (migration
  // ...000042_medical_card.sql) — so this can never leak it outside one.
  async function handleMedical(event: SosEvent) {
    const { data } = await supabase
      .from('medical_cards')
      .select('*')
      .eq('user_id', event.user_id)
      .maybeSingle();
    const name = event.profiles?.full_name ?? t('They');
    Alert.alert(
      t("🩺 {name}'s medical card", { name }),
      formatMedicalCard(data) ?? t("{name} hasn't added any medical information.", { name }),
    );
  }

  async function handleAcknowledge(id: number) {
    setAcknowledgingId(id);
    await supabase.rpc('acknowledge_sos', { p_sos_event_id: id });
    setAcknowledgingId(null);
    onChanged();
  }

  return (
    <View style={styles.container}>
      {events.map((event) => {
        const isMine = event.user_id === session?.user.id;
        const acks = event.sos_acknowledgements ?? [];
        const iAcknowledged = acks.some((a) => a.user_id === session?.user.id);
        return (
          <View key={event.id} style={styles.banner}>
            <Text style={styles.title}>
              {isMine ? t('🆘 Your SOS is active') : t('🆘 {name} needs help', { name: event.profiles?.full_name ?? t('Someone') })}
            </Text>
            {event.message && <Text style={styles.message}>"{event.message}"</Text>}
            {isMine && acks.length > 0 && (
              <Text style={styles.acks}>
                {t(acks.length === 1 ? '👀 {names} is on it' : '👀 {names} are on it', {
                  names: acks.map((a) => a.profiles?.full_name ?? t('Someone')).join(', '),
                })}
              </Text>
            )}
            <View style={styles.footer}>
              <Text style={styles.time}>{timeAgo(event.created_at)}</Text>
              <View style={styles.buttonRow}>
                {!isMine && (
                  <Pressable accessibilityRole="button" style={styles.button} onPress={() => handleMedical(event)}>
                    <Text style={styles.buttonText}>{t('🩺 Medical')}</Text>
                  </Pressable>
                )}
                {!isMine && (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.button}
                    onPress={() => handleAcknowledge(event.id)}
                    disabled={acknowledgingId === event.id || iAcknowledged}
                  >
                    {acknowledgingId === event.id ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.buttonText}>
                        {iAcknowledged ? t("✓ You're on it") : t("I'm on my way")}
                      </Text>
                    )}
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  style={styles.button}
                  onPress={() => handleResolve(event.id)}
                  disabled={resolvingId === event.id}
                >
                  {resolvingId === event.id ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.buttonText}>{isMine ? t('Cancel SOS') : t('Mark resolved')}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  container: { gap: spacing.xs, padding: spacing.sm },
  banner: {
    backgroundColor: colors.dangerFill,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  title: { color: '#fff', fontWeight: '700', fontSize: 15 },
  message: { ...typography.caption, color: '#fff', opacity: 0.9 },
  acks: { ...typography.caption, color: '#fff', opacity: 0.95, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.xs },
  time: { color: '#fff', fontSize: 12, opacity: 0.85 },
  button: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
}));
