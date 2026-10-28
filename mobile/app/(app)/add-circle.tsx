import { Stack, useRouter } from 'expo-router';
import { CircleOnboarding } from '@/components/CircleOnboarding';
import { CardScreen } from '@/components/ui/AuthScreen';
import { useThemeVersion } from '@/lib/theme';

// Create or join an additional circle — e.g. a family circle and a
// separate friend group, or a study group for campus and a family one at
// home. Reachable from Settings → Add another circle any time, unlike
// app/(app)/circle-setup.tsx, which only exists for first-run onboarding
// (its guard requires zero circles). Same CircleOnboarding flow either way.
export default function AddCircleScreen() {
  useThemeVersion(); // redraw on a theme switch (lib/theme.ts)
  const router = useRouter();

  return (
    <CardScreen>
      <Stack.Screen options={{ title: 'Add a circle' }} />
      <CircleOnboarding
        heading="Add a circle"
        intro="Create a new circle, or join one with an invite code. You'll stay in every circle you're already part of."
        onDone={() => router.back()}
      />
    </CardScreen>
  );
}
