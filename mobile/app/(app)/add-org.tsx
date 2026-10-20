import { StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgOnboarding } from '@/components/OrgOnboarding';
import { colors } from '@/lib/theme';

// Join or create a work organization from Settings → Work, whatever account
// type you signed up with — the signup choice only picks the first screen
// (see lib/accountType.ts). Same OrgOnboarding flow, disclosure included, as
// first-run onboarding in app/(app)/circle-setup.tsx. Your circles are
// untouched: family sees you by circle rules, the organization only while
// you're clocked in.
export default function AddOrgScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Work' }} />
      <OrgOnboarding
        heading="Add work"
        intro="Join your workplace with the code your manager gave you, or create an organization for your crew. Your family circles stay exactly as they are, and your workplace can see you only while you're clocked in."
        onDone={() => router.back()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
});
