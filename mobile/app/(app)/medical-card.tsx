import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { colors, spacing, themed, typography, useThemeVersion } from '@/lib/theme';

// Your medical card: blood type, allergies, conditions, medications, a note.
// Circle-mates can read it ONLY while you have an active SOS (enforced by RLS
// — see migration ...000042_medical_card.sql), so the information a
// responder or worried family member needs shows up exactly when it matters
// and isn't permanently visible to everyone in your circles.
export default function MedicalCardScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bloodType, setBloodType] = useState('');
  const [allergies, setAllergies] = useState('');
  const [conditions, setConditions] = useState('');
  const [medications, setMedications] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from('medical_cards')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();
      setBloodType(data?.blood_type ?? '');
      setAllergies(data?.allergies ?? '');
      setConditions(data?.conditions ?? '');
      setMedications(data?.medications ?? '');
      setNotes(data?.notes ?? '');
      setLoading(false);
    })();
  }, [session]);

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: upsertError } = await supabase.from('medical_cards').upsert({
      user_id: session.user.id,
      blood_type: bloodType.trim() || null,
      allergies: allergies.trim() || null,
      conditions: conditions.trim() || null,
      medications: medications.trim() || null,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (upsertError) setError(upsertError.message);
    else setSaved(true);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Medical card' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typography.body}>
          Only shown to your circle while you have an active SOS — never otherwise. Leave anything
          blank you'd rather not share.
        </Text>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <>
            <TextField label="Blood type" value={bloodType} onChangeText={setBloodType} maxLength={10} autoCapitalize="characters" placeholder="O+" />
            <TextField label="Allergies" value={allergies} onChangeText={setAllergies} maxLength={300} multiline autoCapitalize="sentences" />
            <TextField label="Conditions" value={conditions} onChangeText={setConditions} maxLength={300} multiline autoCapitalize="sentences" />
            <TextField label="Medications" value={medications} onChangeText={setMedications} maxLength={300} multiline autoCapitalize="sentences" />
            <TextField label="Notes for responders" value={notes} onChangeText={setNotes} maxLength={500} multiline autoCapitalize="sentences" />
            <Button title="Save" onPress={handleSave} loading={saving} />
            {saved && <Text style={styles.saved}>Saved.</Text>}
            {error && <Text style={styles.error}>{error}</Text>}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  saved: { color: colors.online, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14 },
}));
