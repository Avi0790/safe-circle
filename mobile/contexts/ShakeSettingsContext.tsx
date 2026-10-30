import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getFallDetectionEnabled, setFallDetectionEnabled } from '@/lib/fallSettings';
import { getShakeToSosEnabled, setShakeToSosEnabled } from '@/lib/shakeSettings';

interface ShakeSettingsContextValue {
  enabled: boolean;
  setEnabled: (next: boolean) => Promise<void>;
  // fall detection: the other motion-sensor safety setting (lib/fallSettings.ts)
  fallEnabled: boolean;
  setFallEnabled: (next: boolean) => Promise<void>;
}

const ShakeSettingsContext = createContext<ShakeSettingsContextValue>({
  enabled: false,
  setEnabled: async () => {},
  fallEnabled: false,
  setFallEnabled: async () => {},
});

// A context (not a plain hook read separately in Settings and in the
// sensor-listening layer) so flipping the Settings switch takes effect
// immediately for the one accelerometer subscription that's actually
// listening — two independent AsyncStorage reads would otherwise leave the
// listener running on stale state until next app launch.
export function ShakeSettingsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [fallEnabled, setFallEnabledState] = useState(false);

  useEffect(() => {
    getShakeToSosEnabled().then(setEnabledState);
    getFallDetectionEnabled().then(setFallEnabledState);
  }, []);

  async function setEnabled(next: boolean) {
    setEnabledState(next);
    await setShakeToSosEnabled(next);
  }

  async function setFallEnabled(next: boolean) {
    setFallEnabledState(next);
    await setFallDetectionEnabled(next);
  }

  return (
    <ShakeSettingsContext.Provider value={{ enabled, setEnabled, fallEnabled, setFallEnabled }}>
      {children}
    </ShakeSettingsContext.Provider>
  );
}

export function useShakeSettings() {
  return useContext(ShakeSettingsContext);
}
