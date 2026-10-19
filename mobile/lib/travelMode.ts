import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TravelMode } from '@/lib/navigation';

// Per-device, like the map style: someone without a car picks Walk once and
// finds it still selected next time.
const KEY = 'safecircle.travelMode.v1';

export async function getTravelMode(): Promise<TravelMode> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'walk' ? 'walk' : 'drive';
  } catch {
    return 'drive';
  }
}

export async function setTravelMode(mode: TravelMode): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, mode);
  } catch {
    // Losing the preference just means it starts on Drive next time.
  }
}
