import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';

export type SendSosResult =
  | { ok: true }
  | { ok: false; reason: 'permission-denied' | 'location-failed' | 'insert-failed'; message: string };

// Shared by the SOS button and shake-to-SOS (lib/shakeDetector.ts /
// hooks/useShakeToSos.ts) — one place that gets the current position and
// inserts sos_events, so both triggers go through the exact same path
// (rate limit, trigger, push) with no chance of drifting apart.
export async function sendSos(message?: string): Promise<SendSosResult> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return { ok: false, reason: 'permission-denied', message: t("Can't send your location with the SOS.") };
  }

  let position;
  try {
    position = await Location.getCurrentPositionAsync({});
  } catch {
    return { ok: false, reason: 'location-failed', message: t('Could not get your location.') };
  }

  const { error } = await supabase.from('sos_events').insert({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    ...(message ? { message } : {}),
  });
  if (error) {
    return { ok: false, reason: 'insert-failed', message: error.message };
  }
  return { ok: true };
}

// When the SOS can't be sent — most often because there's no internet, the
// exact moment an app that depends on it fails — don't just show an error:
// offer the text-message fallback, which can go through where data can't.
export function offerTextForHelp(reason: string, openTextForHelp: () => void): void {
  Alert.alert(t('Could not send SOS'), `${reason}\n\n${t('No internet? You can text your circle instead.')}`, [
    { text: t('Close'), style: 'cancel' },
    { text: t('Text for help'), onPress: openTextForHelp },
  ]);
}
