import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Share, Linking, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { DriveHud } from '@/components/DriveHud';
import { DrivePanel } from '@/components/DrivePanel';
import type { CameraMode } from '@/components/DriveHud';
import { VehicleMarker } from '@/components/VehicleMarker';
import { useRoadReports } from '@/hooks/useRoadReports';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/contexts/AuthContext';
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
  maneuverGlyph,
  navState,
  nextAnnouncement,
  OFF_ROUTE_METERS,
  prepareRoute,
  smoothSpeed,
  type LatLng,
  type NavState,
  type PreparedRoute,
  type TravelMode,
} from '@/lib/navigation';
import { fetchRoute, RoutingError } from '@/lib/routing';
import {
  addDestination,
  loadDestinations,
  PINNED_NAMES,
  removeDestination,
  savedAt,
  storeDestinations,
  type SavedDestination,
} from '@/lib/savedDestinations';
import { endSharedTrip, shouldSendEtaUpdate, startSharedTrip, updateSharedTrip } from '@/lib/sharedTrips';
import { supabase } from '@/lib/supabase';
import { getTravelMode, setTravelMode, type PlanMode } from '@/lib/travelMode';
import { createTripLink, finishTripLink, tripShareMessage, updateTripLink } from '@/lib/tripLink';
import { getWebBaseUrl, isLocalUrl } from '@/lib/shareLink';
import { ensureSharingFor } from '@/lib/sharingWindow';
import { reportIncident, reportInfo, upcomingReport, type RoadReport, type RoadReportKind } from '@/lib/roadReports';
import { searchStops, STOP_CATEGORIES, type StopCategory, type StopResult } from '@/lib/stops';
import { getVoiceMode, setVoiceMode, shouldSpeak, type SpeechKind, type VoiceMode } from '@/lib/voicePreference';
import { DEFAULT_VEHICLE, getVehicle, nextHeading, setVehicle, type VehiclePreference } from '@/lib/vehiclePreference';
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
// Within this of a stop counts as having got there (a fuel pump can be well
// off the road's centre line).
const STOP_REACHED_M = 60;

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
  const userId = useAuth().session?.user.id;

  const [phase, setPhase] = useState<Phase>('plan');
  const [permission, setPermission] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [fix, setFix] = useState<Fix | null>(null);
  const [speedMps, setSpeedMps] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [mine, setMine] = useState<SavedDestination[]>([]);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanMode>('drive');
  // Transit hands over to the Maps app, so navigation itself is only ever a drive or a walk.
  const mode: TravelMode = plan === 'walk' ? 'walk' : 'drive';
  const [dest, setDest] = useState<Destination | null>(null);
  const [prepared, setPrepared] = useState<PreparedRoute | null>(null);
  const [routing, setRouting] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nav, setNav] = useState<NavState | null>(null);
  const [voiceMode, setVoiceModeState] = useState<VoiceMode>('all');
  const [panel, setPanel] = useState<null | 'main' | 'stops' | 'report'>(null);
  // How you appear on the map while navigating, which way you're facing, and
  // how the camera follows you (heading up, north up, or the whole route).
  const [vehicle, setVehicleState] = useState<VehiclePreference>(DEFAULT_VEHICLE);
  const [heading, setHeading] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>('heading');
  const lastFollowMode = useRef<'heading' | 'north'>('heading');
  const [reporting, setReporting] = useState(false);
  const [linkShared, setLinkShared] = useState(false);
  const [stop, setStop] = useState<(StopResult & { emoji: string }) | null>(null);
  const [stopCategory, setStopCategory] = useState<StopCategory | null>(null);
  const [stopResults, setStopResults] = useState<StopResult[]>([]);
  const [stopSearching, setStopSearching] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [shareTrip, setShareTrip] = useState(false);
  const [sharingWith, setSharingWith] = useState<string | null>(null);
  const [tripNotice, setTripNotice] = useState<string | null>(null);

  const mapRef = useRef<MapView>(null);
  // Read inside the location callback, which outlives any one render.
  const phaseRef = useRef<Phase>('plan');
  const preparedRef = useRef<PreparedRoute | null>(null);
  const destRef = useRef<Destination | null>(null);
  const voiceRef = useRef<VoiceMode>('all');
  // What the speaker button goes back to after a quick mute.
  const lastVoiced = useRef<VoiceMode>('all');
  const stopRef = useRef<StopResult | null>(null);
  const reportsRef = useRef<RoadReport[]>([]);
  const alertedReports = useRef(new Set<string>());
  const stopSearchId = useRef(0);
  const sharePending = useRef(false);
  // A live ETA link sent outside the app, if any (lib/tripLink.ts).
  const linkId = useRef<string | null>(null);
  const lastLinkEta = useRef<{ at: number; eta: number } | null>(null);
  const linkPending = useRef(false);
  const modeRef = useRef<TravelMode>('drive');
  const fixRef = useRef<Fix | null>(null);
  const prevFix = useRef<Fix | null>(null);
  const said = useRef(new Set<string>());
  const alongHint = useRef<number | undefined>(undefined);
  const offCount = useRef(0);
  const lastReroute = useRef(0);
  const reroutingRef = useRef(false);
  // The shared trip, if this drive is being shared with the circle.
  const tripId = useRef<string | null>(null);
  const lastEta = useRef<{ at: number; eta: number } | null>(null);

  phaseRef.current = phase;
  preparedRef.current = prepared;
  destRef.current = dest;
  voiceRef.current = voiceMode;
  modeRef.current = mode;

  // Turn-by-turn is 'guidance'; an incident ahead or arriving is an 'alert',
  // still spoken in "Alerts only".
  const speak = useCallback((text: string, kind: SpeechKind = 'guidance') => {
    if (shouldSpeak(voiceRef.current, kind)) Speech.speak(text, { language: 'en-US' });
  }, []);

  // Road reports from circle-mates, for the map and for alerts on the way.
  const { reports } = useRoadReports(phase !== 'plan');
  const othersReports = useMemo(() => reports.filter((r) => r.reporter_id !== userId), [reports, userId]);
  reportsRef.current = othersReports;

  useEffect(() => {
    let cancelled = false;
    getVoiceMode().then((m) => {
      if (cancelled) return;
      setVoiceModeState(m);
      voiceRef.current = m;
      if (m !== 'off') lastVoiced.current = m;
    });
    return () => {
      cancelled = true;
    };
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
  // Stops sharing the trip. Arriving tells the circle; stopping just makes it
  // disappear.
  const closeTrip = useCallback((arrived: boolean) => {
    const id = tripId.current;
    if (!id) return;
    tripId.current = null;
    lastEta.current = null;
    setSharingWith(null);
    endSharedTrip(id, arrived);
  }, []);

  // Ends the live ETA link: arriving tells whoever has it you got there;
  // stopping navigation just turns it off.
  const closeLink = useCallback((arrived: boolean) => {
    const id = linkId.current;
    if (!id) return;
    linkId.current = null;
    lastLinkEta.current = null;
    setLinkShared(false);
    finishTripLink(id, arrived);
  }, []);

  const finishArrival = useCallback(() => {
    if (phaseRef.current !== 'driving') return;
    setPhase('arrived');
    phaseRef.current = 'arrived';
    closeTrip(true);
    closeLink(true);
    speak('You have arrived at your destination.', 'alert');
  }, [speak, closeTrip, closeLink]);

  // Swap in a new route (reroute, stop added or removed) and start announcing
  // it from scratch.
  const applyRoute = useCallback((next: PreparedRoute) => {
    said.current = new Set();
    alongHint.current = undefined;
    offCount.current = 0;
    preparedRef.current = next;
    setPrepared(next);
  }, []);

  const reroute = useCallback(
    async (from: LatLng) => {
      const target = destRef.current;
      if (!target || reroutingRef.current) return;
      reroutingRef.current = true;
      lastReroute.current = Date.now();
      setRerouting(true);
      speak('Rerouting.');
      try {
        // Still on the way to a stop: go via it.
        const via = stopRef.current ? [stopRef.current] : [];
        const route = await fetchRoute(from, target, undefined, modeRef.current, via);
        applyRoute(prepareRoute(route));
      } catch {
        // Keep following the old line; try again after the cooldown.
      } finally {
        reroutingRef.current = false;
        setRerouting(false);
      }
    },
    [speak, applyRoute],
  );

  const handleDrivingFix = useCallback(
    (f: Fix) => {
      const prep = preparedRef.current;
      if (!prep) return;
      const s = navState(prep, f, alongHint.current);
      if (!s) return;
      alongHint.current = s.alongM;
      setNav(s);

      // Keep the circle's ETA fresh while sharing.
      const sharedId = tripId.current;
      if (sharedId) {
        const now = Date.now();
        const etaMs = now + s.remainingS * 1000;
        if (shouldSendEtaUpdate(lastEta.current?.at ?? null, lastEta.current?.eta ?? null, now, etaMs)) {
          lastEta.current = { at: now, eta: etaMs };
          updateSharedTrip(sharedId, etaMs);
        }
      }
      const link = linkId.current;
      if (link) {
        const now = Date.now();
        const etaMs = now + s.remainingS * 1000;
        if (shouldSendEtaUpdate(lastLinkEta.current?.at ?? null, lastLinkEta.current?.eta ?? null, now, etaMs)) {
          lastLinkEta.current = { at: now, eta: etaMs };
          updateTripLink(link, etaMs);
        }
      }

      const st = stopRef.current;
      if (st && haversineMeters(f.latitude, f.longitude, st.latitude, st.longitude) < STOP_REACHED_M) {
        stopRef.current = null;
        setStop(null);
        speak(`You've reached ${st.title}.`, 'alert');
      }

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

      const say = nextAnnouncement(s.nextStepIndex, s.distanceToNextM, prep.route.steps, said.current, modeRef.current);
      if (say) {
        said.current.add(say.key);
        speak(say.text);
      }

      const ahead = upcomingReport(prep, s.alongM, reportsRef.current, alertedReports.current);
      if (ahead) {
        alertedReports.current.add(ahead.report.id);
        speak(reportInfo(ahead.report.kind).spoken, 'alert');
      }
    },
    [finishArrival, reroute, speak, applyRoute],
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
      setHeading((h) => nextHeading(h, { ...f, speed: raw ?? f.speed }, prev));
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

  useEffect(
    () => () => {
      Speech.stop();
      // Leaving the screen mid-drive must not leave the trip (or a live ETA
      // link) showing.
      const id = tripId.current;
      if (id) endSharedTrip(id, false);
      const link = linkId.current;
      if (link) finishTripLink(link, false);
    },
    [],
  );

  // The camera follows you, turned to your heading once you are moving (or
  // kept north-up if you chose that). A walker is slower, closer to the
  // ground and looking straight down. In route overview it stays put.
  useEffect(() => {
    if (phase !== 'driving' || !mapReady || !fix || cameraMode === 'overview') return;
    const walking = mode === 'walk';
    const moving = (speedMps ?? 0) >= (walking ? 0.6 : 1);
    mapRef.current?.animateCamera(
      {
        center: { latitude: fix.latitude, longitude: fix.longitude },
        heading: cameraMode === 'north' ? 0 : moving ? heading : undefined,
        pitch: walking ? 0 : 45,
        zoom: walking ? 18 : 17,
        altitude: walking ? 300 : 700,
      },
      { duration: 700 },
    );
  }, [phase, mapReady, fix, speedMps, mode, cameraMode, heading]);

  useEffect(() => {
    let cancelled = false;
    getVehicle().then((v) => {
      if (!cancelled) setVehicleState(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function chooseVehicle(v: VehiclePreference) {
    setVehicleState(v);
    setVehicle(v);
  }

  // The compass: heading up <-> north up (and back from the overview).
  function toggleCompass() {
    const next = cameraMode === 'heading' ? 'north' : 'heading';
    lastFollowMode.current = next;
    setCameraMode(next);
  }

  // Route overview: the rest of the route on one screen; tap again to follow.
  function toggleOverview() {
    if (cameraMode === 'overview') {
      setCameraMode(lastFollowMode.current);
      return;
    }
    const prep = preparedRef.current;
    if (!prep) return;
    const along = alongHint.current ?? 0;
    const ahead = prep.route.coords.filter((_, i) => prep.cum[i] >= along);
    const points = fixRef.current ? [fixRef.current, ...ahead] : ahead;
    setCameraMode('overview');
    mapRef.current?.fitToCoordinates(points.length > 1 ? points : prep.route.coords, {
      edgePadding: { top: 220, right: 90, bottom: 240, left: 60 },
      animated: true,
    });
  }

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

  // Walk or Drive is remembered per device.
  useEffect(() => {
    let cancelled = false;
    getTravelMode().then((m) => {
      if (!cancelled) setPlan(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function chooseMode(next: PlanMode) {
    setPlan(next);
    modeRef.current = next === 'walk' ? 'walk' : 'drive';
    setTravelMode(next);
  }

  function openTransit(target: Destination) {
    Linking.openURL(externalMapsUrl(target, Platform.OS, 'transit'));
  }

  // Personal places live on this phone only (lib/savedDestinations.ts).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    loadDestinations(userId).then((list) => {
      if (!cancelled) setMine(list);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function savePlace(name: string) {
    if (!userId || !dest) return;
    const result = addDestination(
      mine,
      { name, latitude: dest.latitude, longitude: dest.longitude },
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    if (!result.ok) {
      setSaveNotice(
        result.reason === 'full' ? 'You have the most places you can save. Remove one first.' : 'Give the place a name.',
      );
      return;
    }
    const written = await storeDestinations(userId, result.list);
    if (!written) {
      setSaveNotice("Couldn't save that place on this phone.");
      return;
    }
    setMine(result.list);
    setSaveNotice(null);
  }

  function confirmRemove(place: SavedDestination) {
    Alert.alert(`Remove ${place.name}?`, 'It only removes it from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!userId) return;
          const next = removeDestination(mine, place.id);
          if (await storeDestinations(userId, next)) setMine(next);
        },
      },
    ]);
  }

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
    setSaveNotice(null);
    setRouting(true);
    try {
      const route = await fetchRoute(origin, target, undefined, mode);
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
    setTripNotice(null);
    setPhase('driving');
    phaseRef.current = 'driving';
    speak(`Starting route. ${prep.route.steps[0]?.instruction ?? ''}.`);

    alertedReports.current = new Set();
    if (shareTrip) beginSharing(Date.now() + prep.route.durationS * 1000);
  }

  function beginSharing(etaMs: number) {
    const target = destRef.current;
    if (!selectedCircle || !target || sharePending.current || tripId.current) return;
    const circleName = selectedCircle.name;
    sharePending.current = true;
    startSharedTrip(selectedCircle.id, target.title, etaMs, mode).then((res) => {
      sharePending.current = false;
      if (!res.ok) {
        setTripNotice("Couldn't share this trip with your circle. Directions still work.");
      } else if (phaseRef.current === 'driving') {
        tripId.current = res.id;
        lastEta.current = { at: Date.now(), eta: etaMs };
        setSharingWith(circleName);
      } else {
        // The drive ended before the call came back.
        endSharedTrip(res.id, false);
      }
    });
  }

  // Share ETA from the options card, mid-drive, like Apple Maps; or stop.
  function toggleShareEta() {
    if (tripId.current) {
      closeTrip(false);
      setTripNotice(null);
      return;
    }
    const remaining = nav?.remainingS ?? preparedRef.current?.route.durationS ?? 0;
    beginSharing(Date.now() + remaining * 1000);
  }

  // Share ETA with anyone, outside the app: just a message, or a live link
  // that keeps the ETA current and shows where you are until you arrive.
  function shareEtaWithAnyone() {
    Alert.alert('Share your ETA', 'Send it to anyone, even if they don\'t have Safe Circle.', [
      { text: 'Live link (until I arrive)', onPress: () => sendLiveLink() },
      { text: 'Just the ETA as a message', onPress: () => sendEtaMessage() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function currentEtaMs() {
    const remaining = nav?.remainingS ?? preparedRef.current?.route.durationS ?? 0;
    return Date.now() + remaining * 1000;
  }

  async function sendEtaMessage() {
    const target = destRef.current;
    if (!target) return;
    setPanel(null);
    try {
      await Share.share({ message: tripShareMessage(target.title, currentEtaMs(), mode) });
    } catch {
      // Closing the share sheet isn't an error.
    }
  }

  async function sendLiveLink() {
    const target = destRef.current;
    if (!target || linkId.current || linkPending.current) return;
    linkPending.current = true;
    setPanel(null);
    const etaMs = currentEtaMs();
    // The link shows your latest location, so something has to be sending
    // it for the length of the trip (a no-op if sharing is already on).
    const sharing = await ensureSharingFor(Math.max(15, Math.ceil((etaMs - Date.now()) / 60_000)));
    if (!sharing.ok) {
      linkPending.current = false;
      setTripNotice(sharing.reason);
      return;
    }
    const res = await createTripLink(target.title, etaMs, mode);
    linkPending.current = false;
    if (!res.ok) {
      setTripNotice(res.error);
      return;
    }
    if (phaseRef.current !== 'driving') {
      // Navigation ended while the link was being made.
      finishTripLink(res.id, false);
      return;
    }
    linkId.current = res.id;
    lastLinkEta.current = { at: Date.now(), eta: etaMs };
    setLinkShared(true);
    if (isLocalUrl(getWebBaseUrl())) {
      setTripNotice("The web page isn't deployed, so this link only opens on this network.");
    }
    try {
      await Share.share({ message: tripShareMessage(target.title, etaMs, mode, res.url) });
    } catch {
      // Closing the sheet isn't an error; the link stays on until you stop it or arrive.
    }
  }

  function chooseVoice(next: VoiceMode) {
    setVoiceModeState(next);
    voiceRef.current = next;
    if (next === 'off') Speech.stop();
    else lastVoiced.current = next;
    setVoiceMode(next);
  }

  async function report(kind: RoadReportKind) {
    const at = fixRef.current;
    const info = reportInfo(kind);
    if (!at) {
      setTripNotice("Couldn't tell where you are yet, so nothing was reported.");
      return;
    }
    setReporting(true);
    const res = await reportIncident(kind, at);
    setReporting(false);
    setPanel(null);
    setTripNotice(res.ok ? `${info.emoji} ${info.label} reported. Thanks.` : res.error);
  }

  async function pickStopCategory(category: StopCategory) {
    const prep = preparedRef.current;
    if (!prep) return;
    const id = ++stopSearchId.current;
    setStopCategory(category);
    setStopResults([]);
    setStopError(null);
    setStopSearching(true);
    const found = await searchStops(category, prep, alongHint.current ?? 0);
    if (id !== stopSearchId.current) return; // a newer search replaced this one
    setStopSearching(false);
    setStopResults(found);
  }

  // Re-plan from here to the destination, optionally via a stop.
  async function replan(via: StopResult | null): Promise<boolean> {
    const origin = fixRef.current;
    const target = destRef.current;
    if (!origin || !target) return false;
    try {
      const route = await fetchRoute(origin, target, undefined, modeRef.current, via ? [via] : []);
      applyRoute(prepareRoute(route));
      return true;
    } catch (err) {
      setStopError(err instanceof RoutingError ? err.message : "Couldn't plan that route.");
      return false;
    }
  }

  async function pickStop(s: StopResult) {
    setStopSearching(true);
    const ok = await replan(s);
    setStopSearching(false);
    if (!ok) return;
    const emoji = STOP_CATEGORIES.find((c) => c.key === stopCategory)?.emoji ?? '📍';
    stopRef.current = s;
    setStop({ ...s, emoji });
    setPanel(null);
    speak(`Adding ${s.title} as a stop.`);
  }

  async function removeStop() {
    const ok = await replan(null);
    if (!ok) {
      setTripNotice("Couldn't remove the stop right now.");
      return;
    }
    stopRef.current = null;
    setStop(null);
    setPanel(null);
  }

  function endDriving() {
    closeTrip(false);
    closeLink(false);
    setTripNotice(null);
    setPanel(null);
    stopRef.current = null;
    setStop(null);
    setStopCategory(null);
    setStopResults([]);
    Speech.stop();
    setPhase('plan');
    phaseRef.current = 'plan';
    setPrepared(null);
    setDest(null);
    setNav(null);
    setQuery('');
    setResults([]);
  }

  // The speaker button: a quick mute, and back to whatever it was before.
  function toggleMute() {
    chooseVoice(voiceMode === 'off' ? lastVoiced.current : 'off');
  }

  const region = useMemo(() => (prepared ? boundsRegion(prepared.route.coords) : null), [prepared]);
  // The nearest incident on the road ahead, shown at the top while you approach it.
  const nextReport = prepared && nav ? upcomingReport(prepared, nav.alongM, othersReports, new Set()) : null;
  const alertAhead = nextReport
    ? `${reportInfo(nextReport.report.kind).emoji} ${reportInfo(nextReport.report.kind).label} reported ${formatNavDistance(nextReport.aheadM)} ahead`
    : null;
  const walking = mode === 'walk';
  // The "ask a passenger" lock is about someone typing while driving; it makes
  // no sense for a person on foot (a jogger would trip it).
  const moving = plan === 'drive' && (speedMps ?? 0) >= MOVING_MPS;
  const rawMph = speedToMph(speedMps) ?? 0;
  // Walking pace is a few mph, so one decimal says something; a car does not need it.
  const mph = speedMps == null ? null : walking ? Math.round(rawMph * 10) / 10 : Math.round(rawMph) < 1 ? 0 : Math.round(rawMph);

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
    type Row =
      | { kind: 'header'; key: string; title: string }
      | { kind: 'place'; key: string; title: string; subtitle: string; target: Destination; mineId?: string };
    const rows: Row[] = [];
    if (showingResults) {
      if (results.length > 0) rows.push({ kind: 'header', key: 'h-results', title: 'Results' });
      for (const r of results) rows.push({ kind: 'place', key: r.id, title: r.title, subtitle: r.subtitle, target: r });
    } else {
      if (mine.length > 0) rows.push({ kind: 'header', key: 'h-mine', title: 'My places' });
      for (const p of mine) {
        rows.push({ kind: 'place', key: p.id, title: p.name, subtitle: 'Saved on this phone', target: { title: p.name, latitude: p.latitude, longitude: p.longitude }, mineId: p.id });
      }
      if (saved.length > 0) rows.push({ kind: 'header', key: 'h-circle', title: 'Circle places' });
      for (const p of saved) {
        rows.push({ kind: 'place', key: p.id, title: p.name, subtitle: 'Saved place', target: { title: p.name, latitude: p.latitude, longitude: p.longitude } });
      }
    }

    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
        <View style={styles.padded}>
          <View style={styles.headerRow}>
            <Text style={typography.title}>Where to?</Text>
            <Button title="Close" variant="secondary" onPress={() => router.back()} />
          </View>

          <View style={styles.modeRow} accessibilityRole="tablist">
            {(['drive', 'walk', 'transit'] as const).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="tab"
                accessibilityState={{ selected: plan === m }}
                disabled={routing}
                style={[styles.modeBtn, plan === m && styles.modeBtnOn]}
                onPress={() => chooseMode(m)}
              >
                <Text style={[styles.modeText, plan === m && styles.modeTextOn]}>
                  {m === 'drive' ? '🚗 Drive' : m === 'walk' ? '🚶 Walk' : '🚌 Transit'}
                </Text>
              </Pressable>
            ))}
          </View>
          {plan === 'transit' && (
            <Text style={typography.caption}>
              Safe Circle doesn't plan bus or train routes (that needs schedule data), so tapping a
              place opens your Maps app with transit directions.
            </Text>
          )}
          <Pressable onPress={() => router.push('/share-trip')} accessibilityRole="link">
            <Text style={styles.link}>On a bus, train or flight? Share your trip with your circle →</Text>
          </Pressable>

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
          renderItem={({ item }) => {
            if (item.kind === 'header') return <Text style={styles.sectionLabel}>{item.title}</Text>;
            const place = item.mineId ? mine.find((m) => m.id === item.mineId) : undefined;
            return (
              <View style={styles.placeRow}>
                <Pressable
                  style={[styles.row, styles.rowGrow]}
                  disabled={routing || moving}
                  onPress={() => (plan === 'transit' ? openTransit(item.target) : chooseDestination(item.target))}
                >
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  {item.subtitle ? <Text style={typography.caption}>{item.subtitle}</Text> : null}
                </Pressable>
                {place && (
                  <Pressable
                    accessibilityLabel={`Remove ${place.name}`}
                    hitSlop={8}
                    style={styles.removeBtn}
                    onPress={() => confirmRemove(place)}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            showingResults && !searching ? (
              <Text style={typography.caption}>No places found. Try a different name or add the town.</Text>
            ) : !showingResults && saved.length === 0 && mine.length === 0 ? (
              <Text style={typography.caption}>
                Search for a place above, then save it as Home or Work to find it here next time.
                Places saved in your circle also appear here.
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
  const nextIndex = nav ? nav.nextStepIndex : 1;
  const nextStep = prepared?.route.steps[nextIndex];
  const thenStep = prepared?.route.steps[nextIndex + 1];

  return (
    <View style={styles.full}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {region && prepared && dest && (
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          // While navigating you're the vehicle marker instead of the dot.
          showsUserLocation={phase !== 'driving'}
          showsCompass={false}
          onMapReady={() => setMapReady(true)}
        >
          <Polyline coordinates={prepared.route.coords} strokeColor={colors.accent} strokeWidth={6} />
          <Marker coordinate={dest} title={dest.title} />
          {phase === 'driving' && fix && (
            <VehicleMarker
              position={fix}
              heading={heading}
              style={vehicle.style}
              color={vehicle.color}
              walking={mode === 'walk'}
            />
          )}
          {stop && (
            <Marker coordinate={stop} title={`Stop: ${stop.title}`}>
              <Text style={styles.mapEmoji}>{stop.emoji}</Text>
            </Marker>
          )}
          {reports.map((r) => (
            <Marker key={r.id} coordinate={r} title={`${reportInfo(r.kind).label} reported`}>
              <Text style={styles.mapEmoji}>{reportInfo(r.kind).emoji}</Text>
            </Marker>
          ))}
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
          {userId && (
            <View style={styles.saveBlock}>
              {savedAt(mine, dest) ? (
                <Text style={typography.caption}>★ Saved as {savedAt(mine, dest)?.name} on this phone</Text>
              ) : (
                <>
                  <Text style={typography.caption}>Save this place on this phone (not shared):</Text>
                  <View style={styles.chipRow}>
                    {PINNED_NAMES.map((name) => (
                      <Pressable key={name} style={styles.chip} onPress={() => savePlace(name)}>
                        <Text style={styles.chipText}>{name}</Text>
                      </Pressable>
                    ))}
                    <Pressable style={styles.chip} onPress={() => savePlace(dest.title)}>
                      <Text style={styles.chipText} numberOfLines={1}>
                        As “{dest.title}”
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
              {saveNotice && <Text style={styles.error}>{saveNotice}</Text>}
            </View>
          )}
          <Text style={styles.footnote}>
            {walking
              ? 'Walking routes come from OpenStreetMap data and can be wrong, or use paths that are dark or crossings without signals. Use your own judgment.'
              : 'Routes come from OpenStreetMap-based services and can be wrong. Follow road signs and local laws.'}
          </Text>
          {selectedCircle && (
            <View style={styles.shareRow}>
              <View style={styles.shareText}>
                <Text style={styles.shareTitle}>Share this trip with {selectedCircle.name}</Text>
                <Text style={typography.caption}>
                  They'll see where you're headed and when you expect to arrive, and get a message
                  when you arrive. Not your route. Off unless you turn it on.
                </Text>
              </View>
              <Switch value={shareTrip} onValueChange={setShareTrip} trackColor={{ true: colors.accent }} />
            </View>
          )}
          <Button title="Start" onPress={startDriving} />
          <Button
            title="Open in Maps app instead"
            variant="secondary"
            onPress={() => Linking.openURL(externalMapsUrl(dest, Platform.OS, mode))}
          />
          <Button title="Back" variant="secondary" onPress={endDriving} />
        </View>
      )}

      {phase === 'driving' && prepared && (
        <DriveHud
          instruction={nextStep?.instruction ?? 'Follow the route'}
          distanceToNext={nav ? formatNavDistance(nav.distanceToNextM) : formatNavDistance(prepared.stepAlong[1] ?? 0)}
          speedMph={mph}
          mode={mode}
          remainingDistance={formatNavDistance(remainingM)}
          remainingTime={formatNavDuration(remainingS)}
          arrival={formatArrivalClock(remainingS)}
          rerouting={rerouting}
          muted={voiceMode === 'off'}
          sharingWith={sharingWith}
          linkShared={linkShared}
          notice={tripNotice}
          stopTitle={stop ? `${stop.emoji} ${stop.title}` : null}
          alert={alertAhead}
          topInset={insets.top}
          bottomInset={insets.bottom}
          onToggleMute={toggleMute}
          onMore={() => setPanel('main')}
          glyph={maneuverGlyph(nextStep ?? { type: 'continue' })}
          thenGlyph={thenStep ? maneuverGlyph(thenStep) : null}
          voiceMode={voiceMode}
          cameraMode={cameraMode}
          onCompass={toggleCompass}
          onOverview={toggleOverview}
          onSearch={() => setPanel('stops')}
          onReport={() => setPanel('report')}
          onEnd={endDriving}
        />
      )}

      {phase === 'driving' && panel && (
        <DrivePanel
          view={panel}
          vehicle={vehicle}
          onVehicle={chooseVehicle}
          bottomInset={insets.bottom}
          voiceMode={voiceMode}
          onVoiceMode={chooseVoice}
          circleName={selectedCircle?.name ?? null}
          sharing={sharingWith != null}
          onToggleShare={toggleShareEta}
          onShareAnyone={shareEtaWithAnyone}
          linkShared={linkShared}
          onStopLink={() => {
            closeLink(false);
            setPanel(null);
          }}
          onReport={report}
          reporting={reporting}
          stopTitle={stop?.title ?? null}
          onAddStop={() => setPanel('stops')}
          onRemoveStop={removeStop}
          stopCategory={stopCategory}
          stopResults={stopResults}
          stopSearching={stopSearching}
          stopError={stopError}
          onPickCategory={pickStopCategory}
          onPickStop={pickStop}
          onBack={() => setPanel('main')}
          onClose={() => setPanel(null)}
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
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowGrow: { flex: 1 },
  removeBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  removeText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  saveBlock: { gap: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgElevated,
    maxWidth: '100%',
  },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.textHeading },
  link: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  modeRow: { flexDirection: 'row', gap: spacing.sm },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  modeBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  modeText: { fontSize: 15, fontWeight: '600', color: colors.textHeading },
  modeTextOn: { color: '#fff' },
  mapEmoji: { fontSize: 26 },
  summary: { fontSize: 20, fontWeight: '700', color: colors.textHeading },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  shareText: { flex: 1, gap: 2 },
  shareTitle: { fontSize: 15, fontWeight: '600', color: colors.textHeading },
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
