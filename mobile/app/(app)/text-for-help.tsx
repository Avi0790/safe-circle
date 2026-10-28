import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { ErrorText } from '@/components/ErrorText';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { supabase } from '@/lib/supabase';
import { textForHelp } from '@/lib/textForHelp';
import type { BackupContact } from '@/lib/types';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

// A fallback for when push notifications can't reach anyone — SOS, walks,
// curfew, and every other alert in this app depend on this phone and
// Supabase both having internet; a text can go through when data can't.
// Composes (doesn't silently send) a text with a location link to whoever
// you pick here. See lib/textForHelp.ts.
export default function TextForHelpScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const router = useRouter();
  const { session } = useAuth();
  const { selectedCircle } = useCircles();
  const { members } = useCircleMembers(selectedCircle?.id ?? null);
  const [contacts, setContacts] = useState<BackupContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('backup_contacts')
      .select('*')
      .then(({ data }) => setContacts((data as BackupContact[]) ?? []));
  }, []);

  const membersWithPhone = members.filter(
    (m) => m.id !== session?.user.id && m.phone_number,
  );

  function toggle(phone: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    const result = await textForHelp(Array.from(selected), note);
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.back();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Text for help' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.body}>
          Opens a text message with your current location to whoever you pick below — useful when
          there's no internet for push notifications. You still tap send yourself.
        </Text>

        <View style={styles.section}>
          <Text style={styles.label}>Circle</Text>
          {membersWithPhone.length === 0 ? (
            <Text style={typography.caption}>
              No one in this circle has added a phone number yet (Settings → Phone number).
            </Text>
          ) : (
            membersWithPhone.map((member) => {
              const isSelected = selected.has(member.phone_number!);
              return (
                <Pressable
                  accessibilityRole="button"
                  key={member.id}
                  style={[styles.row, isSelected && styles.rowSelected]}
                  onPress={() => toggle(member.phone_number!)}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={styles.rowText}>{member.full_name}</Text>
                  {isSelected && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Backup contacts</Text>
          {contacts.length === 0 ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/backup-contacts')}>
              <Text style={styles.renameLinkText}>Add a backup contact</Text>
            </Pressable>
          ) : (
            contacts.map((contact) => {
              const isSelected = selected.has(contact.phone_number);
              return (
                <Pressable
                  accessibilityRole="button"
                  key={contact.id}
                  style={[styles.row, isSelected && styles.rowSelected]}
                  onPress={() => toggle(contact.phone_number)}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={styles.rowText}>{contact.name}</Text>
                  {isSelected && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <TextField
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="I need help."
            multiline
          />
        </View>

        <Button
          title="Text for help"
          onPress={handleSend}
          loading={sending}
          disabled={selected.size === 0}
        />
        {error && <ErrorText style={styles.error}>{error}</ErrorText>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.sm },
  label: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowSelected: { borderColor: colors.accent, backgroundColor: colors.bgElevated },
  rowText: { fontSize: 16, color: colors.textHeading, fontWeight: '500' },
  check: { color: colors.accent, fontWeight: '700', fontSize: 16 },
  renameLinkText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14 },
}));
