import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';

export type RideResult = { ok: true; notified: number } | { ok: false; error: string };

// Sends a ride request from where you are right now. `everyone` skips the
// "currently driving and nearby" filter and asks the whole circle instead —
// the fallback offered when nobody was driving nearby.
export async function requestRide(everyone: boolean): Promise<RideResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { ok: false, error: 'Location permission is needed so drivers know where to find you.' };
    }
    const position = await Location.getCurrentPositionAsync({});
    const { data, error } = await supabase.rpc('request_ride', {
      p_latitude: position.coords.latitude,
      p_longitude: position.coords.longitude,
      p_everyone: everyone,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, notified: (data as number) ?? 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't get your location." };
  }
}
