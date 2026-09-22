import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';

export type SendSosResult =
  | { ok: true }
  | { ok: false; reason: 'permission-denied' | 'location-failed' | 'insert-failed'; message: string };

// Shared by the SOS button and shake-to-SOS (lib/shakeDetector.ts /
// hooks/useShakeToSos.ts) — one place that gets the current position and
// inserts sos_events, so both triggers go through the exact same path
// (rate limit, trigger, push) with no chance of drifting apart.
export async function sendSos(): Promise<SendSosResult> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return { ok: false, reason: 'permission-denied', message: "Can't send your location with the SOS." };
  }

  let position;
  try {
    position = await Location.getCurrentPositionAsync({});
  } catch {
    return { ok: false, reason: 'location-failed', message: 'Could not get your location.' };
  }

  const { error } = await supabase.from('sos_events').insert({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  });
  if (error) {
    return { ok: false, reason: 'insert-failed', message: error.message };
  }
  return { ok: true };
}
