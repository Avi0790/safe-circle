import { Stack } from 'expo-router';
import { useThemeVersion } from '@/lib/theme';

export default function AuthLayout() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}
