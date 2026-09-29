import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleOnboarding } from '@/components/CircleOnboarding';
import { colors } from '@/lib/theme';

// First-run only — reachable while you have zero circles (see the guard in
// app/(app)/_layout.tsx). No `onDone`: becoming a member is itself what
// flips that guard and takes you into the app, so there's nothing else to
// navigate to from here. Once you have at least one circle, adding another
// happens from Settings → app/(app)/add-circle.tsx instead, which shares
// the same CircleOnboarding component.
export default function CircleSetupScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <CircleOnboarding />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
});
