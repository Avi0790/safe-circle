import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// Registers this device for push notifications and stores the token in
// push_tokens, so the backend's send-geofence-push Edge Function has
// somewhere to deliver arrive/leave alerts (see backend/README.md).
//
// Requires the project to be registered with EAS (`eas init`) — Expo push
// tokens are scoped to an EAS project id. That's a one-time setup step
// tied to a real Expo account, so this fails gracefully with a specific
// "not configured" result instead of crashing when it's missing, rather
// than assuming it's been done.
export type PushRegistrationResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'not-configured' | 'permission-denied' | 'error'; message: string };

function getEasProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  // expo-notifications only supports iOS/Android; guard the same way as
  // lib/locationTracking.ts so this stays safe to call from universal code.
  if (Platform.OS === 'web') {
    return { ok: false, reason: 'not-configured', message: 'Not available on web.' };
  }

  const projectId = getEasProjectId();
  if (!projectId) {
    return {
      ok: false,
      reason: 'not-configured',
      message: 'Push notifications need an EAS project (run `eas init`) — not set up yet.',
    };
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') {
    return { ok: false, reason: 'permission-denied', message: 'Notification permission denied.' };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Safe Circle',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    const { error } = await supabase
      .from('push_tokens')
      .upsert({ token, platform: Platform.OS as 'ios' | 'android' }, { onConflict: 'user_id,token' });

    if (error) {
      return { ok: false, reason: 'error', message: error.message };
    }

    return { ok: true, token };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Could not get a push token.',
    };
  }
}

// Called on sign out. push_tokens has no device identifier, only
// (user_id, token) — and on a shared device (a family tablet, or two
// teammates testing on one simulator) a second account signing in can
// otherwise keep receiving the first account's geofence/SOS pushes,
// since the physical push token doesn't change with who's logged in.
// Clearing every token row for this account on sign-out means an old
// session can never receive alerts meant for whoever's using the device
// now; re-enabling push after signing back in is one tap in Settings.
export async function deregisterPushNotifications(userId: string): Promise<void> {
  await supabase.from('push_tokens').delete().eq('user_id', userId);
}
