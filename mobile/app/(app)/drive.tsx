import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { DriveHud } from '@/components/DriveHud';
import { TextField } from '@/components/TextField';
import { useCircles } from '@/contexts/CircleContext';
import { externalMapsUrl } from '@/lib/externalMaps';
import { speedToMph } from '@/lib/format';
import { haversineMeters } from '@/lib/geo';
import { MIN_QUERY_LENGTH, searchPlaces, type PlaceResult } from '@/lib/geocode';
import {
  boundsRegion,
  formatArrivalClock,
  formatNavDistance,
  formatNavDuration,
  navState,
  nextAnnouncement,
  OFF_ROUTE_METERS,
  prepareRoute,
  smoothSpeed,
  type LatLng,
  type NavState,
  type PreparedRoute,
} from '@/lib/navigation';
import { fetchRoute, RoutingError } from '@/lib/routing';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

type Phase = 'plan' | 'preview' | 'driving' | 'arrived';

interface Fix extends LatLng {
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

interface Destination extends LatLng {
  title: string;
}

interface SavedPlace extends LatLng {
  id: string;
  name: string;
}

// About 5 mph: above this the phone is almost certainly in a moving vehicle.
const MOVING_MPS = 2.2;
const REROUTE_AFTER_FIXES = 3;
const REROUTE_COOLDOWN_MS = 10_000;
const KEEP_AWAKE_TAG = 'safecircle-drive';

// In-app driving directions: pick a destination, see the route, then follow it
// with turn-by-turn text and voice and a live speedometer. Routes and search
// come from free OpenStreetMap-based services (lib/routing.ts, lib/geocode.ts),
// so nothing here needs a paid maps key. Works while this screen is open; it
// is not a background navigator.
//
// Typing a destination is blocked while the vehicle is moving: ask a
// passenger, or pull over.
export default function DriveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { selectedCircle } = useCircles();

  const [phase, setPhase] = useState<Phase>('plan');
  const [permission, setPermission] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [fix, setFix] = useState<Fix | null>(null);
  const [speedMps, setSpeedMps] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [dest, setDest] = useState<Destination | null>(null);
  const [prepared, setPrepared] = useState<PreparedRoute | null>(null);
  const [routing, setRouting] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nav, setNav] = useState<NavState | null>(null);
  const [muted, setMuted] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const mapRef = useRef<MapView>(null);
  // Read inside the location callback, which outlives any one render.
  const phaseRef = useRef<Phase>('plan');
  const preparedRef = useRef<PreparedRoute | null>(null);
  const destRef = useRef<Destination | null>(null);
  const mutedRef = useRef(false);
  const fixRef = useRef<Fix | null>(null);
  const prevFix = useRef<Fix | null>(null);
  const said = useRef(new Set<string>());
  const alongHint = useRef<number | undefined>(undefined);
  const offCount = useRef(0);
  const lastReroute = useRef(0);
  const reroutingRef = useRef(false);

  phaseRef.current = phase;
  preparedRef.current = prepared;
  destRef.current = dest;
  mutedRef.current = muted;

  const speak = useCallback((text: string) => {
    if (!mutedRef.current) Speech.speak(text, { language: 'en-US' });
  }, []);

  // ---------------------------------------------------------- permission
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      setPermission(status === 'granted' ? 'granted' : 'denied');
      if (status !== 'granted') return;
      try {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const f: Fix = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
          speed: current.coords.speed ?? null,
          heading: current.coords.heading ?? null,
          timestamp: current.timestamp,
        };
        fixRef.current = f;
        prevFix.current = f;
        setFix(f);
      } catch {
        // The watcher below will deliver a fix when one is available.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------- driving logic
  const finishArrival = useCallback(() => {
    if (phaseRef.current !== 'driving') return;
    setPhase('arrived');
    phaseRef.current = 'arrived';
    speak('You have arrived at your destination.');
  }, [speak]);

  const reroute = useCallback(
    async (from: LatLng) => {
      const target = destRef.current;
      if (!target || reroutingRef.current) return;
      reroutingRef.current = true;
      lastReroute.current = Date.now();
      setRerouting(true);
      speak('Rerouting.');
      try {
        const route = await fetchRoute(from, target);
        const next = prepareRoute(route);
        said.current = new Set();
        alongHint.current = undefined;
        offCount.current = 0;
        preparedRef.current = next;
        setPrepared(next);
      } catch {
        // Keep following the old line; try again after the cooldown.
      } finally {
        reroutingRef.current = false;
        setRerouting(false);
      }
    },
    [speak],
  );

  const handleDrivingFix = useCallback(
    (f: Fix) => {
      const prep = preparedRef.current;
      if (!prep) return;
      const s = navState(prep, f, alongHint.current);
      if (!s) return;
      alongHint.current = s.alongM;
      setNav(s);

      if (s.arrived) {
        finishArrival();
        return;
      }

      offCount.current = s.offRouteM > OFF_ROUTE_METERS ? offCount.current + 1 : 0;
      if (
        offCount.current >= REROUTE_AFTER_FIXES &&
        !reroutingRef.current &&
        Date.now() - lastReroute.current > REROUTE_COOLDOWN_MS
      ) {
        reroute(f);
        return;
      }

      const say = nextAnnouncement(s.nextStepIndex, s.distanceToNextM, prep.route.steps, said.current);
      if (say) {
        said.current.add(say.key);
        speak(say.text);
      }
    },
    [finishArrival, reroute, speak],
  );

  const onLocation = useCallback(
    (loc: Location.LocationObject) => {
      const f: Fix = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        speed: loc.coords.speed ?? null,
        heading: loc.coords.heading ?? null,
        timestamp: loc.timestamp,
      };
      // Some devices report no speed (or -1); derive it from the last two fixes.
      let raw = f.speed != null && f.speed >= 0 ? f.speed : null;
      const prev = prevFix.current;
      if (raw == null && prev) {
        const dt = (f.timestamp - prev.timestamp) / 1000;
        if (dt > 0 && dt < 10) {
          raw = haversineMeters(prev.latitude, prev.longitude, f.latitude, f.longitude) / dt;
        }
      }
      setSpeedMps((p) => smoothSpeed(p, raw ?? 0));
      prevFix.current = f;
      fixRef.current = f;
      setFix(f);
      if (phaseRef.current === 'driving') handleDrivingFix(f);
    },
    [handleDrivingFix],
  );

  const driving = phase === 'driving';
  useEffect(() => {
    if (permission !== 'granted') return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      // Full-rate GPS only while navigating; a coarse watch is enough to know
      // whether the vehicle is moving while choosing a destination.
      const s = await Location.watchPositionAsync(
        driving
          ? { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 }
          : { accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 10 },
        onLocation,
      );
      if (cancelled) s.remove();
      else sub = s;
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [permission, driving, onLocation]);

  useEffect(() => {
    if (!driving) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [driving]);

  useEffect(() => () => void Speech.stop(), []);

  // The camera follows the vehicle, turned to its heading once it is moving.
  useEffect(() => {
    if (phase !== 'driving' || !mapReady || !fix) return;
    const moving = (speedMps ?? 0) >= 1;
    mapRef.current?.animateCamera(
      {
        center: { latitude: fix.latitude, longitude: fix.longitude },
        heading: moving && fix.heading != null && fix.heading >= 0 ? fix.heading : undefined,
        pitch: 45,
        zoom: 17,
        altitude: 700,
      },
      { duration: 700 },
    );
  }, [phase, mapReady, fix, speedMps]);

  // ---------------------------------------------------------------- plan
  useEffect(() => {
    if (!selectedCircle) return;
    let cancelled = false;
    supabase
      .from('places')
      .select('id, name, latitude, longitude')
      .eq('circle_id', selectedCircle.id)
      .order('name')
      .then(({ data }) => {
        if (!cancelled) setSaved((data as SavedPlace[] | null) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCircle]);

  // Debounced so typing doesn't fire a request per keystroke at a shared,
  // free service.
  useEffect(() => {
    if (phase !== 'plan') return;
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      const found = await searchPlaces(q, fixRef.current ?? undefined, controller.signal);
      if (!controller.signal.aborted) {
        setResults(found);
        setSearching(false);
      }
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, phase]);

  async function chooseDestination(target: Destination) {
    const origin = fixRef.current;
    if (!origin) {
      setError("Still finding your location. Try again in a moment.");
      return;
    }
    setError(null);
    setRouting(true);
    try {
      const route = await fetchRoute(origin, target);
      setDest(target);
      destRef.current = target;
      setPrepared(prepareRoute(route));
      setMapReady(false);
      setPhase('preview');
    } catch (err) {
      setError(err instanceof RoutingError ? err.message : "Couldn't plan that route.");
    } finally {
      setRouting(false);
    }
  }

  function startDriving() {
    const prep = preparedRef.current;
    if (!prep) return;
    said.current = new Set();
    alongHint.current = undefined;
    offCount.current = 0;
    setNav(null);
    setPhase('driving');
    phaseRef.current = 'driving';
    speak(`Starting route. ${prep.route.steps[0]?.instruction ?? ''}.`);
  }

  function endDriving() {
    Speech.stop();
    setPhase('plan');
    phaseRef.current = 'plan';
    setPrepared(null);
    setDest(null);
    setNav(null);
    setQuery('');
    setResults([]);
  }

  function toggleMute() {
    setMuted((m) => {
      if (!m) Speech.stop();
      return !m;
    });
  }

  const region = useMemo(() => (prepared ? boundsRegion(prepared.route.coords) : null), [prepared]);
  const moving = (speedMps ?? 0) >= MOVING_MPS;
  const mph = speedMps == null ? null : Math.round(speedToMph(speedMps) ?? 0) < 1 ? 0 : Math.round(speedToMph(speedMps) ?? 0);

  // ------------------------------------------------------------- screens
  if (permission === 'denied') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.padded}>
          <Text style={typography.title}>Location is off</Text>
          <Text style={typography.body}>
            Directions need your location to start from where you are. Turn it on for Safe Circle
            in Settings.
          </Text>
          <Button title="Open Settings" onPress={() => Linking.openSettings()} />
          <Button title="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'plan') {
    const showingResults = query.trim().length >= MIN_QUERY_LENGTH;
    const rows: { key: string; title: string; subtitle: string; target: Destination }[] = showingResults
      ? results.map((r) => ({ key: r.id, title: r.title, subtitle: r.subtitle, target: r }))
      : saved.map((p) => ({ key: p.id, title: p.name, subtitle: 'Saved place', target: { title: p.name, latitude: p.latitude, longitude: p.longitude } }));

    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
        <View style={styles.padded}>
          <View style={styles.headerRow}>
            <Text style={typography.title}>Where to?</Text>
            <Button title="Close" variant="secondary" onPress={() => router.back()} />
          </View>

          {moving && (
            <Text style={styles.warning}>
              You're moving. Ask a passenger to set the destination, or pull over first.
            </Text>
          )}
          {!fix && permission === 'granted' && (
            <View style={styles.inline}>
              <ActivityIndicator />
              <Text style={typography.caption}>Finding your location…</Text>
            </View>
          )}

          <TextField
            label="Search for a place or address"
            placeholder="Walmart, 123 Main St, campus library…"
            value={query}
            onChangeText={setQuery}
            editable={!moving && !routing}
            autoCapitalize="words"
            autoCorrect
          />
          {error && <Text style={styles.error}>{error}</Text>}
          {(searching || routing) && (
            <View style={styles.inline}>
              <ActivityIndicator />
              <Text style={typography.caption}>{routing ? 'Planning your route…' : 'Searching…'}</Text>
            </View>
          )}
        </View>

        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            rows.length > 0 ? <Text style={styles.sectionLabel}>{showingResults ? 'Results' : 'Saved places'}</Text> : null
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} disabled={routing || moving} onPress={() => chooseDestination(item.target)}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              {item.subtitle ? <Text style={typography.caption}>{item.subtitle}</Text> : null}
            </Pressable>
          )}
          ListEmptyComponent={
            showingResults && !searching ? (
              <Text style={typography.caption}>No places found. Try a different name or add the town.</Text>
            ) : !showingResults && saved.length === 0 ? (
              <Text style={typography.caption}>
                Search for a place above. Places saved in your circle also appear here.
              </Text>
            ) : null
          }
        />
        <Text style={styles.footnote}>
          Routes and search come from OpenStreetMap-based services and can be wrong. Follow road
          signs and local laws.
        </Text>
      </SafeAreaView>
    );
  }

  // preview, driving and arrived all share one map so the camera and the
  // route line carry over without remounting.
  const remainingM = nav?.remainingM ?? prepared?.totalM ?? 0;
  const remainingS = nav?.remainingS ?? prepared?.route.durationS ?? 0;
  const nextStep = prepared && nav ? prepared.route.steps[nav.nextStepIndex] : prepared?.route.steps[1];

  return (
    <View style={styles.full}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {region && prepared && dest && (
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          showsUserLocation
          showsCompass={false}
          onMapReady={() => setMapReady(true)}
        >
          <Polyline coordinates={prepared.route.coords} strokeColor={colors.accent} strokeWidth={6} />
          <Marker coordinate={dest} title={dest.title} />
        </MapView>
      )}

      {phase === 'preview' && prepared && dest && (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={typography.heading} numberOfLines={2}>
            {dest.title}
          </Text>
          <Text style={styles.summary}>
            {formatNavDuration(prepared.route.durationS)} · {formatNavDistance(prepared.totalM)} · arrive{' '}
            {formatArrivalClock(prepared.route.durationS)}
          </Text>
          <Text style={styles.footnote}>
            Routes come from OpenStreetMap-based services and can be wrong. Follow road signs and
            local laws.
          </Text>
          <Button title="Start" onPress={startDriving} />
          <Button
            title="Open in Maps app instead"
            variant="secondary"
            onPress={() => Linking.openURL(externalMapsUrl(dest, Platform.OS))}
          />
          <Button title="Back" variant="secondary" onPress={endDriving} />
        </View>
      )}

      {phase === 'driving' && prepared && (
        <DriveHud
          instruction={nextStep?.instruction ?? 'Follow the route'}
          distanceToNext={nav ? formatNavDistance(nav.distanceToNextM) : formatNavDistance(prepared.stepAlong[1] ?? 0)}
          speedMph={mph}
          remainingDistance={formatNavDistance(remainingM)}
          remainingTime={formatNavDuration(remainingS)}
          arrival={formatArrivalClock(remainingS)}
          rerouting={rerouting}
          muted={muted}
          topInset={insets.top}
          bottomInset={insets.bottom}
          onToggleMute={toggleMute}
          onEnd={endDriving}
        />
      )}

      {phase === 'arrived' && dest && (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={typography.title}>You've arrived</Text>
          <Text style={typography.body}>{dest.title}</Text>
          <Button title="Done" onPress={() => router.back()} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  full: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  list: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  sectionLabel: {
    ...typography.caption,
    color: colors.textHeading,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
    backgroundColor: colors.bgElevated,
  },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.textHeading },
  warning: { color: colors.stale, fontWeight: '600', fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
  footnote: { ...typography.caption, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  summary: { fontSize: 20, fontWeight: '700', color: colors.textHeading },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
});
