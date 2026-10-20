import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import type { CarPlayState } from '@/lib/carplay';

// The native CarPlay module (ios/SafeCircleCarPlayModule.swift). Absent in
// Expo Go, on Android and in tests, so everything here is optional.
interface SafeCircleCarPlayNative {
  isConnected(): boolean;
  setState(state: CarPlayState): void;
  showMessage(text: string): void;
  addListener(event: 'onAction', listener: (e: { id: string }) => void): EventSubscription;
  addListener(event: 'onConnection', listener: (e: { connected: boolean }) => void): EventSubscription;
}

export const CarPlay = requireOptionalNativeModule<SafeCircleCarPlayNative>('SafeCircleCarPlay');
