import { StyleSheet, Text, View } from 'react-native';
import { useActiveSosEvents } from '@/hooks/useActiveSosEvents';
import { SosBanner } from '@/components/SosBanner';
import { SosButton } from '@/components/SosButton';
import { colors, spacing, themed, typography } from '@/lib/theme';

// react-native-maps has no web renderer. This mobile app targets iOS/Android
// only (the read-only web experience is the separate `web/` dashboard) —
// this file exists so `expo start --web` doesn't crash while developing,
// not as a real feature. The SOS banner/button work fine here since
// they don't depend on the map.
export default function MapTabWebFallback() {
  const { events: sosEvents, refresh: refreshSos } = useActiveSosEvents();

  return (
    <View style={styles.container}>
      <SosBanner events={sosEvents} onChanged={refreshSos} />

      <View style={styles.centerContent}>
        <Text style={typography.heading}>Map view isn't available in the browser.</Text>
        <Text style={[typography.body, styles.hint]}>
          Run this app on iOS or Android to see the live map, or use the Safe Circle web dashboard.
        </Text>
      </View>

      <SosButton onSent={refreshSos} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  hint: { textAlign: 'center' },
}));
