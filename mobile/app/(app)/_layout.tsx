import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { CircleProvider, useCircles } from '@/contexts/CircleContext';

export default function AppLayout() {
  return (
    <CircleProvider>
      <AppNavigator />
    </CircleProvider>
  );
}

function AppNavigator() {
  const { circles, isLoading } = useCircles();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const hasCircle = circles.length > 0;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={hasCircle}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>

      <Stack.Protected guard={!hasCircle}>
        <Stack.Screen name="circle-setup" />
      </Stack.Protected>
    </Stack>
  );
}
