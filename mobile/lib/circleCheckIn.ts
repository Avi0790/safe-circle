import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';

export type CheckInResult = { ok: true } | { ok: false; error: string };

// Life360-style "Check in": a normal chat message that also carries where
// you are, so the circle gets a map link instead of having to open the map.
// Used by the Chat tab and by CarPlay's "Check in" button.
export async function checkInToCircle(circleId: string | null): Promise<CheckInResult> {
  if (!circleId) return { ok: false, error: 'No circle selected.' };
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { ok: false, error: 'Location permission denied.' };
    const position = await Location.getCurrentPositionAsync({});
    const { error } = await supabase.from('messages').insert({
      circle_id: circleId,
      body: '📍 Checked in',
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not get your location.' };
  }
}
