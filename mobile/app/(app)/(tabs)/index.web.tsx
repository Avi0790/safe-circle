import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/lib/theme';

// react-native-maps has no web renderer. This mobile app targets iOS/Android
// only (the read-only web experience is the separate `web/` dashboard) —
// this file exists so `expo start --web` doesn't crash while developing,
// not as a real feature.
export default function MapTabWebFallback() {
  return (
    <View style={styles.container}>
      <Text style={typography.heading}>Map view isn't available in the browser.</Text>
      <Text style={[typography.body, styles.hint]}>
        Run this app on iOS or Android to see the live map, or use the Safe Circle web dashboard.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.bg,
  },
  hint: { textAlign: 'center' },
});
