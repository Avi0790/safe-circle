import { StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/lib/theme';

// Navigation needs a phone: live GPS, the map view and voice prompts.
export default function DriveScreenWeb() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: 'Directions' }} />
      <View style={styles.body}>
        <Text style={typography.title}>Directions are on the phone app</Text>
        <Text style={typography.body}>
          Turn-by-turn directions and the live speedometer use your phone's GPS, so they're only in
          the mobile app.
        </Text>
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
});
