import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useCircles } from '@/contexts/CircleContext';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

const EMOJI_OPTIONS = ['📍', '🎪', '🍔', '🎉', '🅿️', '🚪', '⛺'];
const DURATIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: '24 hours', minutes: 1440 },
];

// Drop a temporary "meet here" pin on the map — a festival, a campus
// meetup, a trailhead — anywhere that isn't worth saving as a permanent
// place. Pushes to the rest of the circle and cleans itself up (see
// migration ...000036_map_pins.sql).
export default function DropPinScreen() {
  const router = useRouter();
  const { selectedCircle } = useCircles();
  const [emoji, setEmoji] = useState(EMOJI_OPTIONS[0]);
  const [label, setLabel] = useState('');
  const [minutes, setMinutes] = useState(DURATIONS[1].minutes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDrop() {
    if (!selectedCircle || !label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is needed to drop a pin where you are.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const { error: rpcError } = await supabase.rpc('drop_pin', {
        p_circle_id: selectedCircle.id,
        p_emoji: emoji,
        p_label: label.trim(),
        p_latitude: position.coords.latitude,
        p_longitude: position.coords.longitude,
        p_minutes: minutes,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      router.back();
    } catch {
      setError("Couldn't get your location.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Drop a pin' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.body}>
          Drops a pin at your current location for the rest of {selectedCircle?.name ?? 'your circle'}
          {' '}to see — handy for "meet here" at a festival, a trailhead, or anywhere you haven't
          saved as a place.
        </Text>

        <View style={styles.section}>
          <Text style={styles.label}>Icon</Text>
          <View style={styles.chipRow}>
            {EMOJI_OPTIONS.map((option) => {
              const selected = option === emoji;
              return (
                <Pressable
                  key={option}
                  style={[styles.emojiChip, selected && styles.chipSelected]}
                  onPress={() => setEmoji(option)}
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.emojiText}>{option}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <TextField label="Label" value={label} onChangeText={setLabel} maxLength={40} placeholder="Meet by the gate" />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Keep it up for</Text>
          <View style={styles.chipRow}>
            {DURATIONS.map((option) => {
              const selected = option.minutes === minutes;
              return (
                <Pressable
                  key={option.label}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setMinutes(option.minutes)}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Button title="Drop pin" onPress={handleDrop} loading={saving} disabled={!label.trim()} />
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs + 2,
  },
  emojiChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: { fontSize: 20 },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  error: { color: colors.danger, fontSize: 14 },
});
