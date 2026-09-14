import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import { enqueue, loadQueue, clearQueue, saveQueue, type QueuedPing } from './locationQueue';

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
  const registered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (!registered) return false;
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
}

export async function startBackgroundTracking(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (!isNative) {
    return { ok: false, reason: 'Background location is not available on web.' };
  }

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    return { ok: false, reason: 'Location permission denied.' };
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    return {
      ok: false,
      reason:
        'Background location permission denied. Location will only share while the app is open.',
    };
  }

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

  return { ok: true };
}

export async function stopBackgroundTracking(): Promise<void> {
  if (!isNative) return;
  if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}
