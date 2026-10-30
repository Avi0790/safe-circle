import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, View } from 'react-native';
import { AccountProvider, useAccount } from '@/contexts/AccountContext';
import { AppLockProvider } from '@/contexts/AppLockContext';
import { CircleProvider, useCircles } from '@/contexts/CircleContext';
import { CircleMembersProvider } from '@/contexts/CircleMembersContext';
import { ShakeSettingsProvider, useShakeSettings } from '@/contexts/ShakeSettingsContext';
import { useProfileLanguage } from '@/hooks/useProfileLanguage';
import { useFallDetection } from '@/hooks/useFallDetection';
import { useShakeToSos } from '@/hooks/useShakeToSos';
import { CarPlayBridge } from '@/components/CarPlayBridge';
import { FallCheck } from '@/components/FallCheck';
import { LockScreenSync } from '@/components/LockScreenSync';
import { canEnterApp } from '@/lib/accountType';
import { announce } from '@/lib/announce';
import { offerTextForHelp, sendSos } from '@/lib/sos';
import { useThemeVersion } from '@/lib/theme';
import { t } from '@/lib/i18n';

export default function AppLayout() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  useProfileLanguage(); // notifications in the language you read the app in
  return (
    <AppLockProvider>
      <AccountProvider>
        <CircleProvider>
          <ShakeSettingsProvider>
            <MembersScope>
              <AppNavigator />
              <CarPlayBridge />
              <LockScreenSync />
            </MembersScope>
          </ShakeSettingsProvider>
        </CircleProvider>
      </AccountProvider>
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
  const { circles, isLoading: circlesLoading } = useCircles();
  const { accountType, hasActiveOrg, isLoading: accountLoading } = useAccount();
  const isLoading = circlesLoading || accountLoading;
  const hasCircle = circles.length > 0;
  // Family accounts still need a circle; individuals need nothing; work-crew
  // members get in once they've accepted an organization's disclosure.
  const canEnter = canEnterApp({ hasCircle, hasActiveOrg, accountType });

  // Mounted for the lifetime of the signed-in app regardless of loading
  // state or which screen is in front, so a shake works from any tab —
  // not just the Map tab's SOS button.
  return (
    <>
      <ShakeSosListener enabled={hasCircle && !isLoading} />
      <FallListener enabled={(hasCircle || hasActiveOrg) && !isLoading} />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={canEnter}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="places" options={{ headerShown: true }} />
            <Stack.Screen name="add-circle" options={{ headerShown: true }} />
            <Stack.Screen name="add-org" options={{ headerShown: true }} />
            <Stack.Screen name="walk" options={{ headerShown: true }} />
            <Stack.Screen name="safety-timer" options={{ headerShown: true }} />
            <Stack.Screen name="location-views" options={{ headerShown: true }} />
            <Stack.Screen name="history-retention" options={{ headerShown: true }} />
            <Stack.Screen name="privacy" options={{ headerShown: true }} />
            <Stack.Screen name="drive" options={{ headerShown: false }} />
            <Stack.Screen name="share-trip" options={{ headerShown: true }} />
            <Stack.Screen name="crew" options={{ headerShown: true }} />
            <Stack.Screen name="crew-worker" options={{ headerShown: true }} />
            <Stack.Screen name="crew-manage" options={{ headerShown: true }} />
            <Stack.Screen name="timesheets" options={{ headerShown: true }} />
            <Stack.Screen name="org-settings" options={{ headerShown: true }} />
            <Stack.Screen name="job-sites" options={{ headerShown: true }} />
            <Stack.Screen name="report-incident" options={{ headerShown: true }} />
            <Stack.Screen name="incidents" options={{ headerShown: true }} />
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

          <Stack.Protected guard={!canEnter}>
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
      t('Shake detected — send SOS?'),
      t('This alerts everyone in your circle with your current location.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Send SOS'),
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

// Fall detection: opt-in (Settings → Fall detection). A possible fall opens
// a 30-second "Are you OK?" countdown (components/FallCheck.tsx); only no
// answer, or "Send SOS now", sends the SOS, to the circle and, on shift, to
// the managers who oversee you (the same path as the SOS button).
function FallListener({ enabled }: { enabled: boolean }) {
  const { fallEnabled } = useShakeSettings();
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  useFallDetection(enabled && fallEnabled && !checking, () => setChecking(true));

  const send = useCallback(
    async (message: string) => {
      setChecking(false);
      const result = await sendSos(message);
      if (result.ok) announce(t('SOS sent. Your circle has your location.'));
      else offerTextForHelp(result.message, () => router.push('/text-for-help'));
    },
    [router],
  );

  return <FallCheck visible={checking} onDismiss={() => setChecking(false)} onSend={send} />;
}

