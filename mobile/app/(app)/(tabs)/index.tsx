import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
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
import { OutboxBanner } from '@/components/OutboxBanner';
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
import { MemberCard } from '@/components/MemberCard';
import { MemberPin } from '@/components/MemberPin';
import { PlaceAreas, placeAt, usePlaceAreas } from '@/components/PlaceAreas';
import { haversineMeters } from '@/lib/geo';
import { formatClockTime, formatTimeLeft, getShareStatus, isDriving, isStale, isStatusActive, speedToMph } from '@/lib/format';
import type { LatestLocation, MapPin, MemberWithLocation } from '@/lib/types';
import { colors, isDark, radius, spacing, themed, useThemeVersion } from '@/lib/theme';
import { t } from '@/lib/i18n';

const DEFAULT_REGION = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

// A meetup pin's marker — its own icon (rather than the default red pin)
// and a tap brings up its label, when it expires, and a Remove option for
// whoever dropped it. tracksViewChanges is false because the emoji text
// never changes after mount, unlike a member's avatar photo.
function PinMarker({ pin, isMine, onRemoved }: { pin: MapPin; isMine: boolean; onRemoved: () => void }) {
  function handlePress() {
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: t('Close'), style: 'cancel' },
    ];
    if (isMine) {
      buttons.push({
        text: t('Remove pin'),
        style: 'destructive',
        onPress: async () => {
          await supabase.rpc('remove_pin', { p_pin_id: pin.id });
          onRemoved();
        },
      });
    }
    Alert.alert(
      `${pin.emoji} ${pin.label}`,
      t('Dropped by {name} · expires in {left}', { name: pin.profiles?.full_name ?? t('someone'), left: formatTimeLeft(pin.expires_at) }),
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
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const { session } = useAuth();
  const { selectedCircleId, selectedCircle } = useCircles();
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
  // the person whose card is open (components/MemberCard.tsx)
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    getMapMode().then(setMapModeState);
  }, []);

  function chooseMapMode(next: MapModePreference) {
    setMapModeState(next);
    setMapMode(next);
  }

  async function handleAskEveryone() {
    const result = await requestRide(true);
    if (!result.ok) Alert.alert(t("Couldn't request a ride"), t(result.error));
    refreshRides();
  }

  const located = members.filter((m) => m.location);
  const selected = located.find((m) => m.id === selectedId) ?? null;
  const { places, reload: reloadPlaces } = usePlaceAreas(selectedCircleId);

  // Picking someone glides the map in on them, placed in the top part of the
  // screen so the card below doesn't cover them.
  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const who = located.find((m) => m.id === selectedId);
    const at = who?.id === session?.user.id && myLive ? myLive : who?.location;
    if (!at) return;
    const span = 0.008;
    mapRef.current.animateToRegion(
      { latitude: at.latitude - span * 0.22, longitude: at.longitude, latitudeDelta: span, longitudeDelta: span },
      600,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  const selectedPlace = placeAt(places, selected?.location ?? null);

  // Your own pin follows the phone's live GPS (the map's blue dot), not your
  // last report to the server, so the two never sit apart. Watched straight
  // from the phone while the Map tab is open (the map's own user-location
  // event didn't fire on device); moves under 5 m are ignored.
  const [myLive, setMyLive] = useState<{ latitude: number; longitude: number; heading: number | null } | null>(null);
  const takeLive = (c: { latitude: number; longitude: number; heading?: number | null } | undefined) => {
    if (!c) return;
    // the GPS course, only while moving (-1 when still)
    const heading = c.heading != null && c.heading >= 0 && c.heading < 360 ? c.heading : null;
    setMyLive((prev) =>
      prev && haversineMeters(prev.latitude, prev.longitude, c.latitude, c.longitude) < 5
        ? prev
        : { latitude: c.latitude, longitude: c.longitude, heading },
    );
  };
  const onUserLocationChange = (e: { nativeEvent: { coordinate?: { latitude: number; longitude: number } } }) =>
    takeLive(e.nativeEvent.coordinate);
  useFocusEffect(
    useCallback(() => {
      let sub: Location.LocationSubscription | null = null;
      let alive = true;
      Location.getForegroundPermissionsAsync()
        .then(({ status }) =>
          status === 'granted'
            ? Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5 }, (p) =>
                takeLive(p.coords),
              )
            : null,
        )
        .then((s) => {
          if (alive) sub = s;
          else s?.remove();
        })
        .catch(() => {});
      return () => {
        alive = false;
        sub?.remove();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  const sharingNow = located.filter(
    (m) => !isStale(m.location!.recorded_at) && getShareStatus(m.share_until) !== 'ended',
  ).length;

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
        <View style={styles.circleCard}>
          <View style={styles.circleText}>
            <Text style={styles.circleKicker}>{t('YOUR CIRCLE')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.circleName} numberOfLines={1}>
              {selectedCircle?.name ?? 'Safe Circle'}
            </Text>
            <Text style={styles.circleSub}>
              {t('{n} of {total} sharing now', { n: sharingNow, total: members.length })}
            </Text>
          </View>
          <Pressable accessibilityRole="button" style={styles.mapTypeButton} onPress={() => setModesOpen(true)} accessibilityLabel={t('Map modes')}>
            <Text allowFontScaling={false} style={styles.mapTypeButtonText}>
              {mapMode.mode === 'satellite' || mapMode.mode === 'flyover' ? '🛰️' : '🗺️'}
            </Text>
          </Pressable>
        </View>
        <SosBanner events={sosEvents} onChanged={refreshSos} />
        <OutboxBanner />
        <WalkBanner walks={walks} onChanged={refreshWalks} />
        <SafetyTimerBanner timers={timers} onChanged={refreshTimers} />
        <RideBanner requests={rideRequests} onChanged={refreshRides} onAskEveryone={handleAskEveryone} />
        <TripBanner trips={trips} />
        {locationIssue === 'denied' && (
          <Pressable accessibilityRole="button" style={styles.locationBanner} onPress={() => Linking.openSettings()}>
            <Text style={styles.locationBannerText}>
              {t("📍 Location access is off, so the map can't center on you. Tap to open Settings.")}
            </Text>
          </Pressable>
        )}
        {locationIssue === 'unavailable' && (
          <View style={styles.locationBanner}>
            <Text style={styles.locationBannerText}>
              {t("📍 Couldn't get your location right now — try again outdoors or with a clearer signal.")}
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
          onUserLocationChange={onUserLocationChange}
          // a tap on the map itself closes the card (a tap on a pin opens it)
          onPress={(e) => {
            if (e.nativeEvent.action !== 'marker-press') setSelectedId(null);
          }}
        >
          <PlaceAreas places={places} focus={selectedPlace} />
          {located.map((member) => (
            <MemberPin
              // your own pin is re-created when your live position moves: on
              // this version of react-native-maps a moved marker's coordinate
              // wasn't applied on iPhone, leaving it at your last report
              key={member.id === session?.user.id && myLive ? `${member.id}@${myLive.latitude.toFixed(5)},${myLive.longitude.toFixed(5)}` : member.id}
              member={member}
              name={member.full_name}
              onPress={() => setSelectedId(member.id)}
              selected={member.id === selectedId}
              coordinate={member.id === session?.user.id && myLive ? { latitude: myLive.latitude, longitude: myLive.longitude } : null}
              heading={member.id === session?.user.id ? myLive?.heading ?? null : null}
            />
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

      <QuickActions onRideRequested={refreshRides} />
      <SosButton onSent={refreshSos} />
      {selected && (
        <MemberCard
          member={selected}
          isMe={selected.id === session?.user.id}
          place={selectedPlace}
          circleId={selectedCircleId}
          onPlaceSaved={reloadPlaces}
          onClose={() => setSelectedId(null)}
        />
      )}
      {modesOpen && (
        <MapModesSheet value={mapMode} onChange={chooseMapMode} onClose={() => setModesOpen(false)} bottomInset={insets.bottom} />
      )}
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safeArea: { flex: 1 },
  map: { flex: 1 },
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
  circleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm + 2,
    borderRadius: 22,
    backgroundColor: isDark ? 'rgba(23,26,33,0.96)' : 'rgba(255,255,255,0.96)',
    shadowColor: '#1e1b4b',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  circleText: { flex: 1, gap: 1 },
  circleKicker: { fontSize: 11, fontWeight: '800', color: colors.accent, letterSpacing: 0.8 },
  circleName: { fontSize: 20, fontWeight: '800', color: colors.ink },
  circleSub: { fontSize: 13, color: colors.muted },
  mapTypeButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapTypeButtonText: { fontSize: 22 },
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
}));
