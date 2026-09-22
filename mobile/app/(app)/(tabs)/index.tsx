import { useEffect, useRef, useState } from 'react';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { useActiveSosEvents } from '@/hooks/useActiveSosEvents';
import { useMapPins } from '@/hooks/useMapPins';
import { SosBanner } from '@/components/SosBanner';
import { SosButton } from '@/components/SosButton';
import { WalkBanner } from '@/components/WalkBanner';
import { RideBanner } from '@/components/RideBanner';
import { QuickActions } from '@/components/QuickActions';
import { useActiveWalks } from '@/hooks/useActiveWalks';
import { useRideRequests } from '@/hooks/useRideRequests';
import { requestRide } from '@/lib/rides';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/Avatar';
import { formatClockTime, formatTimeLeft, getShareStatus, isDriving, isStatusActive, speedToMph } from '@/lib/format';
import type { LatestLocation, MapPin, MemberWithLocation } from '@/lib/types';
import { colors, radius, spacing } from '@/lib/theme';

const DEFAULT_REGION = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

function markerDescription(
  location: LatestLocation,
  shareUntil: string | null,
  statusEmoji: string | null,
  statusText: string | null,
  statusExpiresAt: string | null,
): string | undefined {
  const parts: string[] = [];
  if (isStatusActive(statusExpiresAt) && statusEmoji) {
    parts.push(`${statusEmoji}${statusText ? ` ${statusText}` : ''}`);
  }
  if (isDriving(location.speed)) {
    const mph = speedToMph(location.speed);
    parts.push(`🚗 Driving${mph != null ? ` ${Math.round(mph)} mph` : ''}`);
  }
  if (location.battery_level != null) {
    parts.push(`${Math.round(location.battery_level * 100)}% battery`);
  }
  if (getShareStatus(shareUntil) === 'window' && shareUntil) {
    parts.push(`sharing until ${formatClockTime(shareUntil)}`);
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
      description={markerDescription(member.location!, member.share_until, member.status_emoji, member.status_text, member.status_expires_at)}
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

// A meetup pin's marker — its own icon (rather than the default red pin)
// and a tap brings up its label, when it expires, and a Remove option for
// whoever dropped it. tracksViewChanges is false because the emoji text
// never changes after mount, unlike a member's avatar photo.
function PinMarker({ pin, isMine, onRemoved }: { pin: MapPin; isMine: boolean; onRemoved: () => void }) {
  function handlePress() {
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: 'Close', style: 'cancel' },
    ];
    if (isMine) {
      buttons.push({
        text: 'Remove pin',
        style: 'destructive',
        onPress: async () => {
          await supabase.rpc('remove_pin', { p_pin_id: pin.id });
          onRemoved();
        },
      });
    }
    Alert.alert(
      `${pin.emoji} ${pin.label}`,
      `Dropped by ${pin.profiles?.full_name ?? 'someone'} · expires in ${formatTimeLeft(pin.expires_at)}`,
      buttons,
    );
  }

  return (
    <Marker
      coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
      title={pin.label}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={handlePress}
    >
      <View style={styles.pinMarker}>
        <Text style={styles.pinMarkerText}>{pin.emoji}</Text>
      </View>
    </Marker>
  );
}

// Purely a display — turning sharing on/off lives in Settings, which talks
// to the background tracking service in lib/locationTracking.ts (AJ's
// layer). This screen only ever reads from the backend.
export default function MapTab() {
  const { session } = useAuth();
  const { selectedCircleId } = useCircles();
  const { members, isLoading } = useCircleMembers(selectedCircleId);
  const { events: sosEvents, refresh: refreshSos } = useActiveSosEvents();
  const { walks, refresh: refreshWalks } = useActiveWalks();
  const { requests: rideRequests, refresh: refreshRides } = useRideRequests();
  const { pins, refresh: refreshPins } = useMapPins(selectedCircleId);
  const mapRef = useRef<MapView>(null);

  async function handleAskEveryone() {
    const result = await requestRide(true);
    if (!result.ok) Alert.alert("Couldn't request a ride", result.error);
    refreshRides();
  }

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
        <WalkBanner walks={walks} onChanged={refreshWalks} />
        <RideBanner requests={rideRequests} onChanged={refreshRides} onAskEveryone={handleAskEveryone} />
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
        {pins.map((pin) => (
          <PinMarker key={pin.id} pin={pin} isMine={pin.created_by === session?.user.id} onRemoved={refreshPins} />
        ))}
      </MapView>

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator />
        </View>
      )}

      <QuickActions onRideRequested={refreshRides} />
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
  pinMarker: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  pinMarkerText: { fontSize: 16 },
  sosBannerWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  loadingOverlay: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
