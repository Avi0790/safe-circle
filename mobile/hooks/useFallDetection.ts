import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { FallDetector } from '@/lib/fallDetector';

// Faster than shake detection (100 ms): a landing lasts a few tens of ms.
const UPDATE_INTERVAL_MS = 50;

// Wires the accelerometer to FallDetector (lib/fallDetector.ts). Phones give
// apps motion data while they're open; this listens while Safe Circle is.
export function useFallDetection(enabled: boolean, onFall: () => void): void {
  const onFallRef = useRef(onFall);
  onFallRef.current = onFall;

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    const detector = new FallDetector(() => onFallRef.current());
    Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS);
    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      detector.feed(Math.sqrt(x * x + y * y + z * z), Date.now());
    });
    return () => subscription.remove();
  }, [enabled]);
}
