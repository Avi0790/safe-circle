import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { ErrorText } from '@/components/ErrorText';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { supabase } from '@/lib/supabase';
import { formatTimeOfDay } from '@/lib/format';
import { placeIcon } from '@/lib/places';
import { colors, radius, spacing, themed, typography, useThemeVersion } from '@/lib/theme';
import { phoneTimeZone } from '@/lib/timeZone';
import { t } from '@/lib/i18n';

interface PlaceRow {
  id: string;
  name: string;
}

// Curfew times as HH:MM chips rather than a native time picker — no extra
// dependency, and it matches the chip pattern used for walk durations and
// sharing windows elsewhere in the app. Saved with the phone's time zone,
// and the server checks the curfew in that zone (migration ...000070).
const TIME_OPTIONS = ['20:00', '21:00', '22:00', '23:00', '00:00'];

// Alert your circle automatically if you're not home by a set time — set
// once, then entirely automatic (see migration ...000037_curfew.sql).
export default function CurfewScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { session } = useAuth();
  const { selectedCircle } = useCircles();
  const [places, setPlaces] = useState<PlaceRow[]>([]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [time, setTime] = useState(TIME_OPTIONS[2]);
  const [current, setCurrent] = useState<{ placeName: string; curfewTime: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedCircle || !session) return;
    const [{ data: placeRows }, { data: curfewRow }] = await Promise.all([
      supabase.from('places').select('id, name').eq('circle_id', selectedCircle.id).order('name'),
      supabase
        .from('curfews')
        .select('place_id, curfew_time, places(name)')
        .eq('user_id', session.user.id)
        .maybeSingle(),
    ]);
    setPlaces(placeRows ?? []);
    if (curfewRow) {
      setPlaceId(curfewRow.place_id);
      setTime((curfewRow.curfew_time as string).slice(0, 5));
      setCurrent({
        placeName: (curfewRow.places as unknown as { name: string } | null)?.name ?? 'that place',
        curfewTime: curfewRow.curfew_time as string,
      });
    } else {
      setPlaceId((placeRows ?? [])[0]?.id ?? null);
      setCurrent(null);
    }
    setLoading(false);
  }, [selectedCircle, session]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    if (!placeId) return;
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('set_curfew', {
      p_place_id: placeId,
      p_curfew_time: time,
      p_time_zone: phoneTimeZone(),
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await load();
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('clear_curfew');
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await load();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Curfew' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <>
            {current && (
              <View style={styles.section}>
                <Text style={typography.body}>
                  Curfew is {formatTimeOfDay(current.curfewTime)} at {current.placeName}. Your
                  circle is alerted automatically if you're not there by then.
                </Text>
              </View>
            )}

            {places.length === 0 ? (
              <Text style={typography.body}>
                {t('Add a place first (like Home) — a curfew needs somewhere to check for you.')}
              </Text>
            ) : (
              <>
                <View style={styles.section}>
                  <Text style={styles.label}>{t('Where')}</Text>
                  {places.map((place) => {
                    const selected = place.id === placeId;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={place.id}
                        style={[styles.row, selected && styles.rowSelected]}
                        onPress={() => setPlaceId(place.id)}
                        accessibilityState={{ selected }}
                      >
                        <Text style={styles.rowText}>
                          {placeIcon(place.name)} {place.name}
                        </Text>
                        {selected && <Text style={styles.check}>✓</Text>}
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.section}>
                  <Text style={styles.label}>{t('By what time')}</Text>
                  <Text style={typography.caption}>Your local time ({phoneTimeZone().replace(/_/g, ' ')}).</Text>
                  <View style={styles.chipRow}>
                    {TIME_OPTIONS.map((option) => {
                      const selected = option === time;
                      return (
                        <Pressable
                          accessibilityRole="button"
                          key={option}
                          style={[styles.chip, selected && styles.chipSelected]}
                          onPress={() => setTime(option)}
                          accessibilityState={{ selected }}
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                            {formatTimeOfDay(option)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <Button title={t('Save curfew')} onPress={handleSave} loading={saving} disabled={!placeId} />
              </>
            )}
            {current && (
              <Button title={t('Turn off curfew')} variant="secondary" onPress={handleClear} disabled={saving} />
            )}
            {error && <ErrorText style={styles.error}>{error}</ErrorText>}
          </>
        )}
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs + 2,
  },
  chipSelected: { backgroundColor: colors.accentFill, borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  error: { color: colors.danger, fontSize: 14 },
}));
