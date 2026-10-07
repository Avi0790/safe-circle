import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleOnboarding } from '@/components/CircleOnboarding';
import { OrgOnboarding } from '@/components/OrgOnboarding';
import { useAccount } from '@/contexts/AccountContext';
import { colors } from '@/lib/theme';

// First-run only — reachable while the app's entry rule isn't met yet (see
// the guard in app/(app)/_layout.tsx): family accounts with no circle, or
// work-crew accounts with no active organization. Individuals never land
// here. No `onDone`: joining is itself what flips the guard and takes you
// into the app. Once you're in, adding another circle happens from
// Settings → app/(app)/add-circle.tsx, which shares CircleOnboarding.
export default function CircleSetupScreen() {
  const { accountType } = useAccount();
  return (
    <SafeAreaView style={styles.safeArea}>
      {accountType === 'industry' ? <OrgOnboarding /> : <CircleOnboarding />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
});
