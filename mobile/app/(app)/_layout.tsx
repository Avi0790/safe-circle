import { useState } from 'react';
import type { ReactNode } from 'react';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, View } from 'react-native';
import { AppLockProvider } from '@/contexts/AppLockContext';
import { CircleProvider, useCircles } from '@/contexts/CircleContext';
import { CircleMembersProvider } from '@/contexts/CircleMembersContext';
import { ShakeSettingsProvider, useShakeSettings } from '@/contexts/ShakeSettingsContext';
import { useShakeToSos } from '@/hooks/useShakeToSos';
import { offerTextForHelp, sendSos } from '@/lib/sos';

export default function AppLayout() {
  return (
    <AppLockProvider>
      <CircleProvider>
        <ShakeSettingsProvider>
          <MembersScope>
            <AppNavigator />
          </MembersScope>
        </ShakeSettingsProvider>
      </CircleProvider>
    </AppLockProvider>
  );
}

// Owns the single shared copy of the selected circle's members (see
// contexts/CircleMembersContext.tsx).
function MembersScope({ children }: { children: ReactNode }) {
  const { selectedCircleId } = useCircles();
  return <CircleMembersProvider circleId={selectedCircleId}>{children}</CircleMembersProvider>;
}

function AppNavigator() {
  const { circles, isLoading } = useCircles();
  const hasCircle = circles.length > 0;

  // Mounted for the lifetime of the signed-in app regardless of loading
  // state or which screen is in front, so a shake works from any tab —
  // not just the Map tab's SOS button.
  return (
    <>
      <ShakeSosListener enabled={hasCircle && !isLoading} />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={hasCircle}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="places" options={{ headerShown: true }} />
            <Stack.Screen name="add-circle" options={{ headerShown: true }} />
            <Stack.Screen name="walk" options={{ headerShown: true }} />
            <Stack.Screen name="safety-timer" options={{ headerShown: true }} />
            <Stack.Screen name="location-views" options={{ headerShown: true }} />
            <Stack.Screen name="history-retention" options={{ headerShown: true }} />
            <Stack.Screen name="privacy" options={{ headerShown: true }} />
            <Stack.Screen name="ghost-mode" options={{ headerShown: true }} />
            <Stack.Screen name="drop-pin" options={{ headerShown: true, presentation: 'modal' }} />
            <Stack.Screen name="curfew" options={{ headerShown: true }} />
            <Stack.Screen name="join-requests" options={{ headerShown: true }} />
            <Stack.Screen name="delete-account" options={{ headerShown: true }} />
            <Stack.Screen name="medical-card" options={{ headerShown: true }} />
            <Stack.Screen name="share-link" options={{ headerShown: true }} />
            <Stack.Screen name="backup-contacts" options={{ headerShown: true }} />
            <Stack.Screen name="text-for-help" options={{ headerShown: true, presentation: 'modal' }} />
            <Stack.Screen name="ai-help" options={{ headerShown: true, presentation: 'modal' }} />
            <Stack.Screen name="member/[userId]" options={{ headerShown: true }} />
          </Stack.Protected>

          <Stack.Protected guard={!hasCircle}>
            <Stack.Screen name="circle-setup" />
          </Stack.Protected>
        </Stack>
      )}
    </>
  );
}

// Shake-to-SOS: opt-in (Settings → Shake for SOS), and off entirely without
// a circle to alert. Always confirms before sending — a shake is a coarse
// signal (running, a car door slamming) and this pages everyone in the
// circle, so it gets the same one-tap-away-from-accidental guard the SOS
// button itself has, not a silent auto-send.
function ShakeSosListener({ enabled }: { enabled: boolean }) {
  const { enabled: shakeEnabled } = useShakeSettings();
  const router = useRouter();
  const [sending, setSending] = useState(false);

  useShakeToSos(enabled && shakeEnabled && !sending, () => {
    Alert.alert(
      'Shake detected — send SOS?',
      'This alerts everyone in your circle with your current location.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send SOS',
          style: 'destructive',
          onPress: async () => {
            setSending(true);
            const result = await sendSos();
            setSending(false);
            if (!result.ok) offerTextForHelp(result.message, () => router.push('/text-for-help'));
          },
        },
      ],
    );
  });

  return null;
}
