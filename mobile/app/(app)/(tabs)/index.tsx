import { useEffect, useRef, useState } from 'react';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useCircles } from '@/contexts/CircleContext';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { useActiveSosEvents } from '@/hooks/useActiveSosEvents';
import { useMapPins } from '@/hooks/useMapPins';
import { useNow } from '@/hooks/useNow';
import { useRoadReports } from '@/hooks/useRoadReports';
import { RoadReportMarker } from '@/components/RoadReportMarker';
import { reportsForCircle } from '@/lib/roadReports';
import { SosBanner } from '@/components/SosBanner';
import { SosButton } from '@/components/SosButton';
import { WalkBanner } from '@/components/WalkBanner';
import { SafetyTimerBanner } from '@/components/SafetyTimerBanner';
import { RideBanner } from '@/components/RideBanner';
import { TripBanner } from '@/components/TripBanner';
import { useActiveTrips } from '@/hooks/useActiveTrips';
import { QuickActions } from '@/components/QuickActions';
import { MapModesSheet } from '@/components/MapModesSheet';
import { DEFAULT_MAP_MODE, getMapMode, mapViewProps, setMapMode, type MapModePreference } from '@/lib/mapMode';
import { useActiveWalks } from '@/hooks/useActiveWalks';
import { useActiveSafetyTimers } from '@/hooks/useActiveSafetyTimers';
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
  const { trips } = useActiveTrips();
  const { walks, refresh: refreshWalks } = useActiveWalks();
  const { timers, refresh: refreshTimers } = useActiveSafetyTimers();
  const { requests: rideRequests, refresh: refreshRides } = useRideRequests();
  const { pins, refresh: refreshPins } = useMapPins(selectedCircleId);
  // Crashes, hazards and the like reported by people in this circle while driving.
  const { reports, refresh: refreshReports } = useRoadReports();
  const now = useNow(60_000);
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  // Explore / Driving / Satellite / 3D Flyover (lib/mapMode.ts).
  const [mapMode, setMapModeState] = useState<MapModePreference>(DEFAULT_MAP_MODE);
  const [modesOpen, setModesOpen] = useState(false);

  useEffect(() => {
    getMapMode().then(setMapModeState);
  }, []);

  function chooseMapMode(next: MapModePreference) {
    setMapModeState(next);
    setMapMode(next);
  }

  async function handleAskEveryone() {
    const result = await requestRide(true);
    if (!result.ok) Alert.alert("Couldn't request a ride", result.error);
    refreshRides();
  }

  const located = members.filter((m) => m.location);

  // 'denied' vs 'unavailable' so the banner below can say something useful
  // instead of the map just silently staying wherever it was — which is
  // exactly what a previously-denied permission looks like: iOS/Android
  // don't re-show the system prompt once you've said no once, so
  // requestForegroundPermissionsAsync() quietly returns 'denied' forever
  // after that, with nothing on screen to explain why nothing moved.
  const [locationIssue, setLocationIssue] = useState<'denied' | 'unavailable' | null>(null);
  // Starts null; the map isn't rendered at all until this resolves (see the
  // JSX below). Earlier this used an imperative mapRef.animateToRegion()
  // call right after mount instead — react-native-maps has a well-known
  // issue where that silently does nothing if it fires before the native
  // view has finished initializing, especially on iOS/PROVIDER_DEFAULT.
  // Deciding the starting region *before* the map ever mounts, and handing
  // it to `initialRegion`, sidesteps that race entirely: there's no native
  // view yet for the call to race against.
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);

  useEffect(() => {
    let cancelled = false;
    // However this resolves — granted, denied, or GPS failure — the map
    // must eventually render something. If nothing else has set a region
    // within a few seconds, fall back to the hardcoded default rather than
    // leaving the screen stuck on a loading spinner forever.
    const fallbackTimer = setTimeout(() => {
      if (!cancelled) setInitialRegion((r) => r ?? DEFAULT_REGION);
    }, 8000);

    (async () => {
      let status: Location.PermissionStatus;
      try {
        ({ status } = await Location.getForegroundPermissionsAsync());
        if (status !== 'granted') {
          ({ status } = await Location.requestForegroundPermissionsAsync());
        }
      } catch {
        if (!cancelled) setLocationIssue('unavailable');
        return;
      }
      if (cancelled) return;
      if (status !== 'granted') {
        setLocationIssue('denied');
        return;
      }
      try {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        setLocationIssue(null);
        setInitialRegion({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });
      } catch {
        // Permission is granted but the fix itself failed (GPS off, no
        // signal indoors, timed out) — the fit-to-members effect still
        // covers this if anyone else's location is known, and the
        // fallback timer above covers the case where nobody's is.
        if (!cancelled) setLocationIssue('unavailable');
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    if (located.length === 0 || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      located.map((m) => ({
        latitude: m.location!.latitude,
        longitude: m.location!.longitude,
      })),
      { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: true },
    );
    // Also when the map first mounts: members often arrive before the GPS fix
    // (they're cached on the phone), while the map isn't there yet to fit, and
    // the count alone wouldn't change again to retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located.length, initialRegion != null]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Absolutely-positioned children ignore SafeAreaView's padding, so
          without this offset the banners were drawn under the clock/notch. */}
      <View style={[styles.sosBannerWrap, { top: insets.top }]}>
        <SosBanner events={sosEvents} onChanged={refreshSos} />
        <WalkBanner walks={walks} onChanged={refreshWalks} />
        <SafetyTimerBanner timers={timers} onChanged={refreshTimers} />
        <RideBanner requests={rideRequests} onChanged={refreshRides} onAskEveryone={handleAskEveryone} />
        <TripBanner trips={trips} />
        {locationIssue === 'denied' && (
          <Pressable style={styles.locationBanner} onPress={() => Linking.openSettings()}>
            <Text style={styles.locationBannerText}>
              📍 Location access is off, so the map can't center on you. Tap to open Settings.
            </Text>
          </Pressable>
        )}
        {locationIssue === 'unavailable' && (
          <View style={styles.locationBanner}>
            <Text style={styles.locationBannerText}>
              📍 Couldn't get your location right now — try again outdoors or with a clearer signal.
            </Text>
          </View>
        )}
      </View>

      {initialRegion ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={styles.map}
          initialRegion={initialRegion}
          {...mapViewProps(mapMode, Platform.OS)}
          showsUserLocation
          showsMyLocationButton
        >
          {located.map((member) => (
            <MemberMarker key={member.id} member={member} />
          ))}
          {pins.map((pin) => (
            <PinMarker key={pin.id} pin={pin} isMine={pin.created_by === session?.user.id} onRemoved={refreshPins} />
          ))}
          {reportsForCircle(reports, members.map((m) => m.id), session?.user.id, now).map((report) => (
            <RoadReportMarker key={report.id} report={report} myUserId={session?.user.id} onChanged={refreshReports} />
          ))}
        </MapView>
      ) : (
        // Nothing to show yet — waiting on the GPS fix (or its fallback
        // timer) that decides where the map should first open. See the
        // effect above for why this is a wait rather than mounting the map
        // early and recentering it after the fact.
        <View style={styles.map} />
      )}

      {(isLoading || !initialRegion) && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator />
        </View>
      )}

      <Pressable
        style={[styles.mapTypeButton, { top: insets.top + spacing.sm }]}
        onPress={() => setModesOpen(true)}
        accessibilityLabel="Map modes"
      >
        <Text style={styles.mapTypeButtonText}>{mapMode.mode === 'satellite' || mapMode.mode === 'flyover' ? '🛰️' : '🗺️'}</Text>
      </Pressable>

      <QuickActions onRideRequested={refreshRides} />
      <SosButton onSent={refreshSos} />
      {modesOpen && (
        <MapModesSheet value={mapMode} onChange={chooseMapMode} onClose={() => setModesOpen(false)} bottomInset={insets.bottom} />
      )}
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
  mapTypeButton: {
    position: 'absolute',
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 5,
  },
  mapTypeButtonText: { fontSize: 20 },
  sosBannerWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  locationBanner: {
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.stale,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  locationBannerText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  loadingOverlay: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
