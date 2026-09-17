import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
// Side-effect import: registers the background location task (AJ's
// layer) at module scope. Must happen unconditionally on every app
// launch, not inside a component — see lib/locationTracking.ts.
import { resumeForegroundWatchIfActive, startQueueFlushOnReconnect } from '@/lib/locationTracking';

export default function RootLayout() {
  useEffect(() => startQueueFlushOnReconnect(), []);
  useEffect(() => {
    resumeForegroundWatchIfActive();
  }, []);

  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </AuthProvider>
  );
}

function RootNavigator() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      {/* Unguarded: reachable via the safecircle://reset-password deep
          link regardless of whether the tapper is currently signed in —
          see reset-password.tsx. */}
      <Stack.Screen name="reset-password" />
    </Stack>
  );
}
