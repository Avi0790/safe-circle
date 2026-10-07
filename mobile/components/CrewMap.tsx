import { StyleSheet } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { colors } from '@/lib/theme';

export interface CrewMapMarker {
  id: string;
  title: string;
  description?: string;
  latitude: number;
  longitude: number;
  stale?: boolean;
}

export interface CrewMapPoint {
  latitude: number;
  longitude: number;
}

// The region is computed up front and the map only mounts once there is
// something to frame — react-native-maps silently ignores an imperative
// animateToRegion right after mount (the same race the Map tab hit), so the
// initial region is simply correct from the start. Returns null with nothing
// to show, so callers render no map at all rather than an empty world.
function regionFor(points: CrewMapPoint[]) {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.6),
    longitudeDelta: Math.max(0.01, (maxLon - minLon) * 1.6),
  };
}

export function CrewMap({
  markers = [],
  path = [],
}: {
  markers?: CrewMapMarker[];
  path?: CrewMapPoint[];
}) {
  const region = regionFor([...markers, ...path]);
  if (!region) return null;

  return (
    <MapView provider={PROVIDER_DEFAULT} style={styles.map} initialRegion={region}>
      {path.length > 1 && (
        <Polyline coordinates={path} strokeColor={colors.accent} strokeWidth={3} />
      )}
      {markers.map((m) => (
        <Marker
          key={m.id}
          coordinate={{ latitude: m.latitude, longitude: m.longitude }}
          title={m.title}
          description={m.description}
          pinColor={m.stale ? 'orange' : 'red'}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { height: 280 },
});
