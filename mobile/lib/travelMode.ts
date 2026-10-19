import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TravelMode } from '@/lib/navigation';

// What the Directions screen is set to. Transit isn't a route we plan (no free
// schedule data), it opens the Maps app; but it is a choice worth remembering.
export type PlanMode = TravelMode | 'transit';

// Per-device, like the map style: someone without a car picks Walk once and
// finds it still selected next time.
const KEY = 'safecircle.travelMode.v1';

export async function getTravelMode(): Promise<PlanMode> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    return stored === 'walk' || stored === 'transit' ? stored : 'drive';
  } catch {
    return 'drive';
  }
}

export async function setTravelMode(mode: PlanMode): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, mode);
  } catch {
    // Losing the preference just means it starts on Drive next time.
  }
}
