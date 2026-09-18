import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/format';
import { placeIcon } from '@/lib/places';
import { colors, spacing, typography } from '@/lib/theme';

interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  created_by: string;
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
  const { session } = useAuth();
  const { selectedCircle } = useCircles();
  const [places, setPlaces] = useState<Place[]>([]);
  const [events, setEvents] = useState<GeofenceEvent[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameRadiusValue, setRenameRadiusValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [presenceByPlace, setPresenceByPlace] = useState<Record<string, string[]>>({});

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
    const loadedPlaces = (placesRes.data as Place[]) ?? [];
    if (placesRes.data) setPlaces(loadedPlaces);
    if (eventsRes.data) setEvents(eventsRes.data as unknown as GeofenceEvent[]);

    // "Here now" — place_membership_state (...000006) is kept live-accurate
    // by the evaluate_geofences trigger on every location insert, but
    // wasn't read by any client until now; only the historical arrive/leave
    // feed below existed. A quick "who's actually here right now" beats
    // scrolling that feed for the current state.
    if (loadedPlaces.length > 0) {
      const { data: presence } = await supabase
        .from('place_membership_state')
        .select('place_id, profiles(full_name)')
        .eq('is_inside', true)
        .in(
          'place_id',
          loadedPlaces.map((p) => p.id),
        );
      const byPlace: Record<string, string[]> = {};
      for (const row of (presence ?? []) as unknown as {
        place_id: string;
        profiles: { full_name: string } | null;
      }[]) {
        const name = row.profiles?.full_name;
        if (!name) continue;
        (byPlace[row.place_id] ??= []).push(name);
      }
      setPresenceByPlace(byPlace);
    } else {
      setPresenceByPlace({});
    }

    setLoading(false);
  }, [selectedCircle]);

  useEffect(() => {
    load();
  }, [load]);

  // Live: refetch on any is_inside transition for places in this circle.
  useEffect(() => {
    if (!selectedCircle) return;
    const channel = supabase
      .channel(`place-membership-${selectedCircle.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'place_membership_state' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedCircle, load]);

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

  function confirmDeletePlace(place: Place) {
    Alert.alert(`Remove ${place.name}?`, "You'll stop getting arrive/leave alerts for it.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => handleDeletePlace(place.id) },
    ]);
  }

  async function handleDeletePlace(placeId: string) {
    setDeletingId(placeId);
    // RLS (places_delete_creator) already restricts this to places you
    // created; the local created_by check below just decides whether to
    // show the button at all.
    const { error } = await supabase.from('places').delete().eq('id', placeId);
    setDeletingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    await load();
  }

  function startRenamePlace(place: Place) {
    setRenamingId(place.id);
    setRenameValue(place.name);
    setRenameRadiusValue(String(place.radius_meters));
    setRenameError(null);
  }

  async function handleSaveRename() {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('Give this place a name.');
      return;
    }
    const radius = Number(renameRadiusValue);
    if (!Number.isFinite(radius) || radius < 20 || radius > 2000) {
      setRenameError('Radius must be between 20 and 2000 meters.');
      return;
    }
    setRenameSaving(true);
    // RLS (places_update_creator) already restricts this to places you
    // created; the Rename link only appears there in the first place.
    const { error } = await supabase
      .from('places')
      .update({ name: trimmed, radius_meters: radius })
      .eq('id', renamingId);
    setRenameSaving(false);
    if (error) {
      setRenameError(error.message);
      return;
    }
    setRenamingId(null);
    await load();
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
        renderItem={({ item }) =>
          renamingId === item.id ? (
            <View style={[styles.row, styles.renameForm]}>
              <TextField
                label="Name"
                value={renameValue}
                onChangeText={setRenameValue}
                autoCapitalize="words"
              />
              <TextField
                label="Radius (meters)"
                value={renameRadiusValue}
                onChangeText={setRenameRadiusValue}
                keyboardType="numeric"
              />
              {renameError && <Text style={styles.error}>{renameError}</Text>}
              <View style={styles.renameButtons}>
                <View style={styles.renameButton}>
                  <Button title="Save" onPress={handleSaveRename} loading={renameSaving} />
                </View>
                <View style={styles.renameButton}>
                  <Button
                    title="Cancel"
                    variant="secondary"
                    onPress={() => setRenamingId(null)}
                    disabled={renameSaving}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View style={[styles.row, styles.placeRow]}>
              <View style={styles.placeInfo}>
                <Text style={styles.rowTitle}>
                  {placeIcon(item.name)} {item.name}
                </Text>
                <Text style={typography.caption}>{item.radius_meters}m radius</Text>
                {presenceByPlace[item.id]?.length > 0 && (
                  <Text style={styles.hereNow}>
                    Here now: {presenceByPlace[item.id].join(', ')}
                  </Text>
                )}
              </View>
              {item.created_by === session?.user.id && (
                <View style={styles.placeActions}>
                  <Pressable onPress={() => startRenamePlace(item)} hitSlop={8}>
                    <Text style={styles.renameLink}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDeletePlace(item)}
                    disabled={deletingId === item.id}
                    hitSlop={8}
                  >
                    <Text style={styles.removeLink}>
                      {deletingId === item.id ? 'Removing…' : 'Remove'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          )
        }
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
                  {placeIcon(event.places?.name ?? '')} {event.places?.name ?? 'a place'}
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
  placeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  placeInfo: { gap: 2 },
  placeActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  removeLink: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  hereNow: { color: colors.online, fontSize: 12, fontWeight: '600' },
  renameLink: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  renameForm: { gap: spacing.sm },
  renameButtons: { flexDirection: 'row', gap: spacing.sm },
  renameButton: { flex: 1 },
});
