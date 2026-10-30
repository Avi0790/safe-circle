import AsyncStorage from '@react-native-async-storage/async-storage';

// Fall detection on this phone (Settings → Fall detection). Per device, like
// shake-to-SOS (lib/shakeSettings.ts): it's about this phone's sensor.
const FALL_DETECTION_KEY = 'safecircle.fallDetection.v1';

export async function getFallDetectionEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(FALL_DETECTION_KEY)) === '1';
}

export async function setFallDetectionEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await AsyncStorage.setItem(FALL_DETECTION_KEY, '1');
  } else {
    await AsyncStorage.removeItem(FALL_DETECTION_KEY);
  }
}
