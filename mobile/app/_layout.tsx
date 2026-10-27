import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { colors, isDark } from '@/lib/theme';
// Side-effect import: registers the background location task (AJ's
// layer) at module scope. Must happen unconditionally on every app
// launch, not inside a component — see lib/locationTracking.ts.
import { resumeForegroundWatchIfActive, startQueueFlushOnReconnect } from '@/lib/locationTracking';
// Side-effect import too: the job-site geofence task, for the same reason.
import '@/lib/jobSiteReminders';

// Headers, screen backgrounds and the tab bar follow the app's theme
// (lib/theme.ts: light or dark, chosen when the app starts).
const navigationTheme = {
  ...(isDark ? DarkTheme : DefaultTheme),
  colors: {
    ...(isDark ? DarkTheme : DefaultTheme).colors,
    primary: colors.accent,
    background: colors.page,
    card: colors.card,
    text: colors.ink,
    border: colors.line,
  },
};

export default function RootLayout() {
  useEffect(() => startQueueFlushOnReconnect(), []);
  useEffect(() => {
    resumeForegroundWatchIfActive();
  }, []);

  return (
    <ThemeProvider value={navigationTheme}>
      <AuthProvider>
        <StatusBar style="auto" />
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.page }}>
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
