import { CircleOnboarding } from '@/components/CircleOnboarding';
import { OrgOnboarding } from '@/components/OrgOnboarding';
import { useAccount } from '@/contexts/AccountContext';
import { AuthScreen } from '@/components/ui/AuthScreen';

// First-run only — reachable while the app's entry rule isn't met yet (see
// the guard in app/(app)/_layout.tsx): family accounts with no circle, or
// work-crew accounts with no active organization. Individuals never land
// here. No `onDone`: joining is itself what flips the guard and takes you
// into the app. Once you're in, adding another circle happens from
// Settings → app/(app)/add-circle.tsx, which shares CircleOnboarding.
export default function CircleSetupScreen() {
  const { accountType } = useAccount();
  return (
    <AuthScreen tagline={accountType === 'industry' ? "Let's set up your crew." : "Let's set up your circle."}>
      {accountType === 'industry' ? <OrgOnboarding /> : <CircleOnboarding />}
    </AuthScreen>
  );
}
