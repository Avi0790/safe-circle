import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Circle, Marker } from 'react-native-maps';
import { useFocusEffect } from 'expo-router';
import { placeIcon } from '@/lib/places';
import { supabase } from '@/lib/supabase';
import { colors, isDark } from '@/lib/theme';

interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
}

// The circle's saved places on the Map tab: a faint ring the size of each
// place's arrive/leave area (the geofence that sends "arrived at Home"), and
// a small label in the middle, so a feature that otherwise works unseen is
// visible at a glance. Reloaded whenever the Map tab comes back into view,
// so a place added on the Places screen shows up.
export function PlaceAreas({ circleId }: { circleId: string | null }) {
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
      {places.map((p) => (
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
