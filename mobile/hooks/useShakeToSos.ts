import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { ShakeDetector } from '@/lib/shakeDetector';

const UPDATE_INTERVAL_MS = 100;

// Wires the device accelerometer to ShakeDetector and calls onShake when a
// shake is recognized. Opt-in (see Settings' "Shake for SOS" switch) —
// always-on shake detection would risk firing from ordinary bumps (running,
// a car door), which is the wrong failure mode for something that pages
// your whole circle.
export function useShakeToSos(enabled: boolean, onShake: () => void): void {
  // Avoids re-subscribing every render if the caller passes a new function
  // identity each time — only `enabled` should start/stop the subscription.
  const onShakeRef = useRef(onShake);
  onShakeRef.current = onShake;

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;

    const detector = new ShakeDetector(() => onShakeRef.current());
    Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS);
    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      detector.feed(magnitude, Date.now());
    });

    return () => {
      subscription.remove();
    };
  }, [enabled]);
}
