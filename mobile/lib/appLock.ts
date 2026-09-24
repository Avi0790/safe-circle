import AsyncStorage from '@react-native-async-storage/async-storage';

// Optional Face ID / fingerprint / passcode lock: someone who picks up your
// unlocked phone shouldn't be able to open a live map of your family. A
// per-device preference (like shake-to-SOS), stored locally.
const APP_LOCK_KEY = 'safecircle.appLock.v1';

// Coming back to the app within this long doesn't ask again — otherwise
// answering a text and switching back would prompt every single time.
export const APP_LOCK_GRACE_MS = 30_000;

export async function getAppLockEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(APP_LOCK_KEY)) === '1';
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  if (enabled) await AsyncStorage.setItem(APP_LOCK_KEY, '1');
  else await AsyncStorage.removeItem(APP_LOCK_KEY);
}

// Whether returning to the foreground should re-lock. `leftAt` is when the
// app last went to the background (null = it was never backgrounded, e.g. a
// cold start, which always locks).
export function shouldRelock(enabled: boolean, leftAt: number | null, now: number): boolean {
  if (!enabled) return false;
  if (leftAt == null) return true;
  return now - leftAt >= APP_LOCK_GRACE_MS;
}
