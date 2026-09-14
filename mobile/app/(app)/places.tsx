import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useCircles } from '@/contexts/CircleContext';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';

interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
}

interface GeofenceEvent {
  id: number;
  event_type: 'arrived' | 'left';
  occurred_at: string;
  places: { name: string } | null;
  profiles: { full_name: string } | null;
}

// Stretch goal from the proposal (page 3): "geofenced places with
// arrive/leave alerts". The backend (places, geofence_events,
// evaluate_geofences trigger, send-geofence-push Edge Function) has
// existed since the backend layer was built - this is the UI that
// actually makes it usable.
export default function PlacesScreen() {
  const { selectedCircle } = useCircles();
  const [places, setPlaces] = useState<Place[]>([]);
  const [events, setEvents] = useState<GeofenceEvent[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedCircle) return;
    const [placesRes, eventsRes] = await Promise.all([
      supabase.from('places').select('*').eq('circle_id', selectedCircle.id).order('name'),
      supabase
        .from('geofence_events')
        .select('id, event_type, occurred_at, places(name), profiles(full_name)')
        .order('occurred_at', { ascending: false })
        .limit(20),
    ]);
    if (placesRes.data) setPlaces(placesRes.data as Place[]);
    if (eventsRes.data) setEvents(eventsRes.data as unknown as GeofenceEvent[]);
    setLoading(false);
  }, [selectedCircle]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddPlace() {
    if (!selectedCircle) return;
    setError(null);
    if (!name.trim()) {
      setError('Give this place a name.');
      return;
    }
    setSaving(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const { error } = await supabase.from('places').insert({
        circle_id: selectedCircle.id,
        name: name.trim(),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        radius_meters: 150,
      });
      if (error) {
        setError(error.message);
        return;
      }
      setName('');
      await load();
    } catch {
      setError('Could not get your current location.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ title: 'Places', headerBackTitle: 'Settings' }} />
      <FlatList
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Add a place</Text>
              <Text style={typography.caption}>
                Uses your current location — stand where you want the place to be (e.g. at home)
                before adding it. 150m radius.
              </Text>
              <TextField
                label="Name"
                placeholder="Home"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <Button title="Add place here" onPress={handleAddPlace} loading={saving} />
            </View>

            <Text style={styles.sectionLabel}>{selectedCircle?.name}'s places</Text>
          </>
        }
        data={places}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={typography.caption}>{item.radius_meters}m radius</Text>
          </View>
        )}
        ListEmptyComponent={
          !loading ? <Text style={typography.caption}>No places yet.</Text> : null
        }
        ListFooterComponent={
          <>
            <Text style={[styles.sectionLabel, styles.activityLabel]}>Recent activity</Text>
            {events.length === 0 && <Text style={typography.caption}>Nothing yet.</Text>}
            {events.map((event) => (
              <View key={event.id} style={styles.row}>
                <Text style={typography.body}>
                  {event.profiles?.full_name ?? 'Someone'}{' '}
                  {event.event_type === 'arrived' ? 'arrived at' : 'left'}{' '}
                  {event.places?.name ?? 'a place'}
                </Text>
                <Text style={typography.caption}>{timeAgo(event.occurred_at)}</Text>
              </View>
            ))}
          </>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm, marginBottom: spacing.lg },
  sectionLabel: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  activityLabel: { marginTop: spacing.lg },
  row: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
  rowTitle: { fontSize: 15, fontWeight: '500', color: colors.textHeading },
  error: { color: colors.danger, fontSize: 14 },
});
