import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/format';
import type { SosEvent } from '@/lib/types';
import { colors, radius, spacing, typography } from '@/lib/theme';

export function SosBanner({ events, onChanged }: { events: SosEvent[]; onChanged: () => void }) {
  const { session } = useAuth();
  const [resolvingId, setResolvingId] = useState<number | null>(null);

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

  return (
    <View style={styles.container}>
      {events.map((event) => {
        const isMine = event.user_id === session?.user.id;
        return (
          <View key={event.id} style={styles.banner}>
            <Text style={styles.title}>
              {isMine ? '🆘 Your SOS is active' : `🆘 ${event.profiles?.full_name ?? 'Someone'} needs help`}
            </Text>
            {event.message && <Text style={styles.message}>"{event.message}"</Text>}
            <View style={styles.footer}>
              <Text style={styles.time}>{timeAgo(event.created_at)}</Text>
              <Pressable
                style={styles.button}
                onPress={() => handleResolve(event.id)}
                disabled={resolvingId === event.id}
              >
                {resolvingId === event.id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>{isMine ? 'Cancel SOS' : 'Mark resolved'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs, padding: spacing.sm },
  banner: {
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  title: { color: '#fff', fontWeight: '700', fontSize: 15 },
  message: { ...typography.caption, color: '#fff', opacity: 0.9 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  time: { color: '#fff', fontSize: 12, opacity: 0.85 },
  button: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
