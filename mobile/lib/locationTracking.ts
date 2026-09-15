import { AppState, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import { enqueue, loadQueue, clearQueue, saveQueue, type QueuedPing } from './locationQueue';

// Whether the user has sharing turned on — our own source of truth,
// separate from the OS-level background task registration. Needed
// because the foreground-watch fallback (below) is pure JS state that
// doesn't survive an app restart on its own the way a real background
// task does; this is what lets it resume automatically.
const SHARING_ENABLED_KEY = 'safecircle.sharingEnabled.v1';

async function setSharingPreference(enabled: boolean): Promise<void> {
  if (enabled) {
    await AsyncStorage.setItem(SHARING_ENABLED_KEY, '1');
  } else {
    await AsyncStorage.removeItem(SHARING_ENABLED_KEY);
  }
}

async function getSharingPreference(): Promise<boolean> {
  return (await AsyncStorage.getItem(SHARING_ENABLED_KEY)) === '1';
}

// Background tracking is meaningless on web (this mobile app doesn't
// target it anyway — see index.web.tsx), and expo-task-manager /
// expo-location's background APIs aren't available there. Guard the whole
// module so it's safe to import unconditionally from app/_layout.tsx.
const isNative = Platform.OS !== 'web';

// AJ's layer, per the proposal (page 6): "Permissions flow, background
// tracking service, throttling, offline queue. Our highest-risk
// component." Throttled to ~50m / 60s (page 4's "Background service" spec).
export const LOCATION_TASK_NAME = 'safecircle-background-location';

const DISTANCE_INTERVAL_METERS = 50;
const TIME_INTERVAL_MS = 60_000;

async function currentBatteryLevel(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    // -1 on simulators / platforms without a battery.
    return level != null && level >= 0 ? level : null;
  } catch {
    return null;
  }
}

// Sends every queued ping (oldest first) plus an optional new one, in a
// single insert. If it fails (most commonly: no network) everything goes
// back on the queue for the next attempt — this is the "offline is
// handled... flush in a batch when the network returns" behavior from the
// proposal (page 4).
export async function flushQueueAndSend(newPing?: QueuedPing): Promise<void> {
  const queue = await loadQueue();
  const toSend = newPing ? [...queue, newPing] : queue;
  if (toSend.length === 0) return;

  const net = await NetInfo.fetch();
  if (!net.isConnected) {
    if (newPing) await enqueue(newPing);
    return;
  }

  const { error } = await supabase.from('locations').insert(toSend);
  if (error) {
    // Insert is all-or-nothing per request; keep the whole batch queued.
    await saveQueue(toSend);
    return;
  }

  await clearQueue();
}

// Registered unconditionally at module scope on native, per Expo's
// requirement — this file must be imported once, early, from app startup
// (see app/_layout.tsx) so the task exists before any background event
// fires, even across a cold start triggered by the OS while the app is
// closed.
if (isNative) {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.warn('[locationTracking]', error.message);
      return;
    }

    const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
    if (!locations || locations.length === 0) return;

    const batteryLevel = await currentBatteryLevel();

    // Normally one fix per callback given our interval settings, but handle
    // bursts (e.g. after being backgrounded a while) by sending them together.
    for (const loc of locations) {
      await flushQueueAndSend({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy,
        battery_level: batteryLevel,
        recorded_at: new Date(loc.timestamp).toISOString(),
      });
    }
  });
}

// Flush proactively whenever connectivity comes back, rather than waiting
// for the next scheduled location fix. Call once from app startup.
export function startQueueFlushOnReconnect(): () => void {
  if (!isNative) return () => {};
  return NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      flushQueueAndSend();
    }
  });
}

export async function isTrackingActive(): Promise<boolean> {
  if (!isNative) return false;
  return getSharingPreference();
}

// Best-effort check for whether the real OS background task is the one
// actually running (vs. just the foreground fallback) — used to show an
// accurate "background" vs "foreground only" label after an app restart.
export async function isBackgroundTaskActive(): Promise<boolean> {
  if (!isNative) return false;
  const registered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(
    () => false,
  );
  if (!registered) return false;
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
}

// Foreground fallback: a plain watchPositionAsync loop, active only while
// the app is in the foreground (paused/resumed via AppState). This is
// what actually delivers updates in Expo Go, where
// startLocationUpdatesAsync's background task silently never fires —
// confirmed by testing on a real device (see mobile/README.md's
// Verification notes). In a real development/production build it just
// runs alongside the true background task, handing off cleanly since it
// pauses the moment the app backgrounds.
let foregroundWatchSubscription: Location.LocationSubscription | null = null;
let foregroundLifecycleSubscription: { remove: () => void } | null = null;
// Bumped by every start/stop so a pending watchPositionAsync call can tell,
// once it resolves, whether it's still the most recent request — see
// startForegroundLoop.
let foregroundLoopToken = 0;

async function reportForegroundFix(loc: Location.LocationObject) {
  const batteryLevel = await currentBatteryLevel();
  await flushQueueAndSend({
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    battery_level: batteryLevel,
    recorded_at: new Date(loc.timestamp).toISOString(),
  });
}

async function startForegroundLoop() {
  if (foregroundWatchSubscription) return;
  // Claim this request synchronously, before the await below — otherwise a
  // second call (e.g. AppState flapping active/inactive/active while the
  // permission dialog is up) would also see a null subscription and start a
  // second one. Whichever call's token is still current when it resolves
  // wins; a superseded one tears itself down instead of leaking.
  const token = ++foregroundLoopToken;
  try {
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: DISTANCE_INTERVAL_METERS,
        timeInterval: TIME_INTERVAL_MS,
      },
      (loc) => {
        reportForegroundFix(loc);
      },
    );
    if (token !== foregroundLoopToken) {
      // Stopped (or restarted) while we were awaiting — don't leak this one.
      subscription.remove();
      return;
    }
    foregroundWatchSubscription = subscription;
  } catch (err) {
    // Mirrors the try/catch already on the background permission/task calls
    // below — a native throw here must not go uncaught from an AppState
    // listener, or it silently kills the only mechanism that delivers
    // updates in Expo Go.
    console.warn('[locationTracking] foreground watch unavailable:', err);
  }
}

function stopForegroundLoop() {
  foregroundLoopToken++;
  foregroundWatchSubscription?.remove();
  foregroundWatchSubscription = null;
}

function startForegroundWatch(): void {
  if (!isNative || foregroundLifecycleSubscription) return;

  if (AppState.currentState === 'active') {
    startForegroundLoop();
  }

  foregroundLifecycleSubscription = AppState.addEventListener(
    'change',
    (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        startForegroundLoop();
      } else {
        stopForegroundLoop();
      }
    },
  );
}

function stopForegroundWatch(): void {
  stopForegroundLoop();
  foregroundLifecycleSubscription?.remove();
  foregroundLifecycleSubscription = null;
}

export async function startBackgroundTracking(): Promise<
  { ok: true; backgroundGranted: boolean } | { ok: false; reason: string }
> {
  if (!isNative) {
    return { ok: false, reason: 'Background location is not available on web.' };
  }

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    return { ok: false, reason: 'Location permission denied.' };
  }

  // Foreground sharing works on just this permission — start it
  // regardless of how the background request below goes.
  startForegroundWatch();
  await setSharingPreference(true);

  let background: Location.LocationPermissionResponse | null = null;
  try {
    background = await Location.requestBackgroundPermissionsAsync();
  } catch (err) {
    // Expo Go throws ERR_LOCATION_INFO_PLIST here — its compiled binary
    // has no "Always" location usage string for arbitrary apps, so it
    // can't even ask. Caught on a real device: this crashed the whole
    // function uncaught before the fix, leaving the Settings toggle
    // stuck mid-request. The foreground watch above already covers us.
    console.warn('[locationTracking] background permission request unavailable:', err);
  }
  if (!background || background.status !== 'granted') {
    return { ok: true, backgroundGranted: false };
  }

  let backgroundTaskStarted = false;
  try {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: DISTANCE_INTERVAL_METERS,
      timeInterval: TIME_INTERVAL_MS,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Safe Circle',
        notificationBody: 'Sharing your location with your circle.',
      },
    });
    backgroundTaskStarted = true;
  } catch (err) {
    // Expo Go throws here (background tracking needs a development
    // build); the foreground watch above still covers us either way.
    console.warn('[locationTracking] background task unavailable:', err);
  }

  return { ok: true, backgroundGranted: backgroundTaskStarted };
}

export async function stopBackgroundTracking(): Promise<void> {
  if (!isNative) return;
  stopForegroundWatch();
  await setSharingPreference(false);
  if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}

// Called once from app startup: if sharing was left on from a previous
// session, resume the foreground watch loop. The real background task,
// if it was actually running (a development/production build, not Expo
// Go), is already managed by the OS and needs no action here.
export async function resumeForegroundWatchIfActive(): Promise<void> {
  if (!isNative) return;
  if (!(await getSharingPreference())) return;
  // Defensive: this runs unconditionally at app boot, so a native throw
  // here (we've already hit one from a sibling permissions call — see
  // startBackgroundTracking) must never break startup for every user who
  // previously enabled sharing.
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') startForegroundWatch();
  } catch (err) {
    console.warn('[locationTracking] resumeForegroundWatchIfActive failed:', err);
  }
}
