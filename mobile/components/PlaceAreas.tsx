import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Circle, Marker } from 'react-native-maps';
import { useFocusEffect } from 'expo-router';
import { haversineMeters } from '@/lib/geo';
import { placeIcon } from '@/lib/places';
import { supabase } from '@/lib/supabase';
import { colors, isDark } from '@/lib/theme';

export interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
}

// The circle's saved places on the Map tab: a faint ring the size of each
// place's arrive/leave area (the geofence that sends "arrived at Home"). The
// name label stays hidden so it never covers anyone's pin, and appears only
// for the place the person you've tapped is in.

// The place a position is inside, if any (the smallest, when areas overlap).
export function placeAt(places: Place[], at: { latitude: number; longitude: number } | null): Place | null {
  if (!at) return null;
  const inside = places.filter(
    (p) => haversineMeters(p.latitude, p.longitude, at.latitude, at.longitude) <= p.radius_meters,
  );
  return inside.sort((a, b) => a.radius_meters - b.radius_meters)[0] ?? null;
}

// Reloaded whenever the Map tab comes back into view, so a place added on the
// Places screen shows up.
export function usePlaceAreas(circleId: string | null): { places: Place[]; reload: () => void } {
  const [places, setPlaces] = useState<Place[]>([]);

  const load = useCallback(async () => {
    if (!circleId) {
      setPlaces([]);
      return;
    }
    const { data } = await supabase
      .from('places')
      .select('id, name, latitude, longitude, radius_meters')
      .eq('circle_id', circleId);
    setPlaces((data as Place[] | null) ?? []);
  }, [circleId]);

  useEffect(() => {
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { places, reload: load };
}

export function PlaceAreas({ places, focus }: { places: Place[]; focus: Place | null }) {
  return (
    <>
      {places.map((p) => (
        <Circle
          key={`area-${p.id}`}
          center={{ latitude: p.latitude, longitude: p.longitude }}
          radius={p.radius_meters}
          strokeColor="rgba(124,58,237,0.75)"
          strokeWidth={1.5}
          fillColor="rgba(124,58,237,0.12)"
        />
      ))}
      {focus && [focus].map((p) => (
        <Marker
          key={`label-${p.id}`}
          coordinate={{ latitude: p.latitude, longitude: p.longitude }}
          accessibilityLabel={p.name}
          tracksViewChanges={false}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={-1}
        >
          <View style={styles.label} collapsable={false}>
            <Text allowFontScaling={false} style={styles.icon}>{placeIcon(p.name)}</Text>
            <Text allowFontScaling={false} style={styles.name} numberOfLines={1}>{p.name}</Text>
          </View>
        </Marker>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 160,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: isDark ? 'rgba(23,26,33,0.85)' : 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.5)',
  },
  icon: { fontSize: 12 },
  name: { fontSize: 12, fontWeight: '700', color: colors.textHeading },
});
