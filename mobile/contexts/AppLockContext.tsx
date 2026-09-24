import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Button } from '@/components/Button';
import { getAppLockEnabled, setAppLockEnabled, shouldRelock } from '@/lib/appLock';
import { colors, spacing, typography } from '@/lib/theme';

interface AppLockValue {
  enabled: boolean;
  // Resolves to an error message, or null on success.
  setEnabled: (next: boolean) => Promise<string | null>;
}

const AppLockContext = createContext<AppLockValue>({ enabled: false, setEnabled: async () => null });

const isNative = Platform.OS !== 'web';

async function authenticate(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Safe Circle',
      // Face ID / fingerprint first, the phone's passcode as the fallback.
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}

// Optional Face ID / fingerprint / passcode lock. The app stays mounted
// underneath (location sharing, realtime and alerts keep working while
// locked) and an opaque screen covers it — also whenever the app is not
// active, so the map doesn't show up in the phone's app-switcher preview.
export function AppLockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const enabledRef = useRef(false);
  const leftAt = useRef<number | null>(null);
  // The auth prompt itself briefly makes the app inactive; without this a
  // prompt could trigger the very re-lock that opened it.
  const prompting = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    const ok = await authenticate();
    prompting.current = false;
    if (ok) setLocked(false);
  }, []);

  useEffect(() => {
    if (!isNative) {
      setLocked(false);
      return;
    }
    getAppLockEnabled().then((on) => {
      enabledRef.current = on;
      setEnabledState(on);
      if (on) unlock();
      else setLocked(false);
    });
  }, [unlock]);

  useEffect(() => {
    if (!isNative) return;
    const subscription = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active');
      if (next === 'background') leftAt.current = Date.now();
      if (next === 'active' && leftAt.current != null) {
        if (shouldRelock(enabledRef.current, leftAt.current, Date.now())) {
          setLocked(true);
          unlock();
        }
        leftAt.current = null;
      }
    });
    return () => subscription.remove();
  }, [unlock]);

  const setEnabled = useCallback(async (next: boolean): Promise<string | null> => {
    if (!isNative) return 'App lock is only available on the phone app.';
    if (next) {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) {
        return "Set up Face ID, a fingerprint, or a passcode in your phone's Settings first.";
      }
      // Prove it works before turning it on, so a broken setup can't lock
      // you out of your own family's app.
      prompting.current = true;
      const ok = await authenticate();
      prompting.current = false;
      if (!ok) return "Couldn't verify it's you, so the lock stays off.";
    }
    await setAppLockEnabled(next);
    enabledRef.current = next;
    setEnabledState(next);
    setLocked(false);
    return null;
  }, []);

  const covered = enabled && (locked || !appActive);

  return (
    <AppLockContext.Provider value={{ enabled, setEnabled }}>
      {children}
      {covered && (
        <View style={styles.cover} pointerEvents="auto">
          <Text style={typography.title}>Safe Circle</Text>
          <Text style={[typography.body, styles.text]}>
            {locked ? 'Locked to keep your family’s locations private.' : ''}
          </Text>
          {locked && appActive && <Button title="Unlock" onPress={unlock} />}
        </View>
      )}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  return useContext(AppLockContext);
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    zIndex: 1000,
    elevation: 1000,
  },
  text: { textAlign: 'center' },
});
