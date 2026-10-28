import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { ErrorText } from '@/components/ErrorText';
import { supabase } from '@/lib/supabase';
import type { BackupContact } from '@/lib/types';
import { colors, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

// People outside any circle to text in an emergency — a neighbor, a
// grandparent, a family doctor. Kept separate from circle membership
// (backup_contacts is a plain owner-only table, migration
// ...000039_text_for_help.sql) since they shouldn't see your live
// location the way a circle-mate does; they only ever receive the one
// text you choose to send them from "Text for help".
export default function BackupContactsScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const [contacts, setContacts] = useState<BackupContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('backup_contacts').select('*').order('created_at');
    setContacts((data as BackupContact[]) ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    if (!name.trim() || !phone.trim()) return;
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('backup_contacts')
      .insert({ name: name.trim(), phone_number: phone.trim() });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName('');
    setPhone('');
    await load();
  }

  async function handleRemove(id: string) {
    setDeletingId(id);
    await supabase.from('backup_contacts').delete().eq('id', id);
    setDeletingId(null);
    await load();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Backup contacts' }} />
      <FlatList
        contentContainerStyle={styles.content}
        data={contacts}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          isLoading ? (
            <ActivityIndicator />
          ) : (
            <View style={styles.form}>
              <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
              <TextField
                label="Phone number"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="+1 555 123 4567"
              />
              {error && <ErrorText style={styles.error}>{error}</ErrorText>}
              <Button
                title="Add contact"
                onPress={handleAdd}
                loading={saving}
                disabled={!name.trim() || !phone.trim()}
              />
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={typography.body}>{item.name}</Text>
              <Text style={typography.caption}>{item.phone_number}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name}`}
              onPress={() => handleRemove(item.id)}
              disabled={deletingId === item.id}
              hitSlop={8}
            >
              <Text style={styles.removeText}>{deletingId === item.id ? 'Removing…' : 'Remove'}</Text>
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  form: { gap: spacing.sm, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowText: { gap: 2 },
  removeText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14 },
}));
