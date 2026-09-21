import { useEffect, useRef, useState } from 'react';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { useActiveSosEvents } from '@/hooks/useActiveSosEvents';
import { SosBanner } from '@/components/SosBanner';
import { SosButton } from '@/components/SosButton';
import { Avatar } from '@/components/Avatar';
import { isDriving, speedToMph } from '@/lib/format';
import type { LatestLocation, MemberWithLocation } from '@/lib/types';
import { colors, radius, spacing } from '@/lib/theme';

const DEFAULT_REGION = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

function markerDescription(location: LatestLocation): string | undefined {
  const parts: string[] = [];
  if (isDriving(location.speed)) {
    const mph = speedToMph(location.speed);
    parts.push(`🚗 Driving${mph != null ? ` ${Math.round(mph)} mph` : ''}`);
  }
  if (location.battery_level != null) {
    parts.push(`${Math.round(location.battery_level * 100)}% battery`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

// A marker's view is snapshotted into a bitmap, so it has to keep tracking
// changes until whatever it shows has actually drawn — a profile photo
// arrives asynchronously, and freezing before then would pin an empty
// circle to the map. Once the avatar reports settled it's frozen (avoids
// re-rendering the bitmap every frame); the timeout is a safety net so a
// hung image download can't leave a marker tracking forever.
function MemberMarker({ member }: { member: MemberWithLocation }) {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), 4000);
    return () => clearTimeout(timer);
  }, [member.avatar_url]);

  return (
    <Marker
      coordinate={{
        latitude: member.location!.latitude,
        longitude: member.location!.longitude,
      }}
      title={member.full_name}
      description={markerDescription(member.location!)}
      tracksViewChanges={!settled}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.markerAvatar}>
        <Avatar
          id={member.id}
          name={member.full_name}
          url={member.avatar_url}
          size={36}
          onSettled={() => setSettled(true)}
        />
      </View>
    </Marker>
  );
}

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
          <MemberMarker key={member.id} member={member} />
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
  markerAvatar: {
    padding: 2,
    backgroundColor: colors.bg,
    borderRadius: radius.full,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  sosBannerWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  loadingOverlay: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
