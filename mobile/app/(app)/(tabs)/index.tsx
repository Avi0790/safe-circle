import { useEffect, useRef } from 'react';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { useActiveSosEvents } from '@/hooks/useActiveSosEvents';
import { SosBanner } from '@/components/SosBanner';
import { SosButton } from '@/components/SosButton';
import { spacing } from '@/lib/theme';

const DEFAULT_REGION = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

// Purely a display — turning sharing on/off lives in Settings, which talks
// to the background tracking service in lib/locationTracking.ts (AJ's
// layer). This screen only ever reads from the backend.
export default function MapTab() {
  const { selectedCircleId } = useCircles();
  const { members, isLoading } = useCircleMembers(selectedCircleId);
  const { events: sosEvents, refresh: refreshSos } = useActiveSosEvents();
  const mapRef = useRef<MapView>(null);

  const located = members.filter((m) => m.location);

  useEffect(() => {
    if (located.length === 0 || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      located.map((m) => ({
        latitude: m.location!.latitude,
        longitude: m.location!.longitude,
      })),
      { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located.length]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.sosBannerWrap}>
        <SosBanner events={sosEvents} onChanged={refreshSos} />
      </View>

      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
      >
        {located.map((member) => (
          <Marker
            key={member.id}
            coordinate={{
              latitude: member.location!.latitude,
              longitude: member.location!.longitude,
            }}
            title={member.full_name}
            description={
              member.location!.battery_level != null
                ? `${Math.round(member.location!.battery_level * 100)}% battery`
                : undefined
            }
          />
        ))}
      </MapView>

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator />
        </View>
      )}

      <SosButton onSent={refreshSos} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  map: { flex: 1 },
  sosBannerWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  loadingOverlay: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
