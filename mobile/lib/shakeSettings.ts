import AsyncStorage from '@react-native-async-storage/async-storage';

// A per-device preference, not a circle-shared one (see
// hooks/useShakeToSos.ts) — how sensitive this phone's motion sensor
// should be to isn't something that belongs on profiles.
const SHAKE_TO_SOS_KEY = 'safecircle.shakeToSos.v1';

export async function getShakeToSosEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(SHAKE_TO_SOS_KEY)) === '1';
}

export async function setShakeToSosEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await AsyncStorage.setItem(SHAKE_TO_SOS_KEY, '1');
  } else {
    await AsyncStorage.removeItem(SHAKE_TO_SOS_KEY);
  }
}
