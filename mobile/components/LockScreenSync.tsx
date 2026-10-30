import { useEffect, useRef } from 'react';
import { useAccount } from '@/contexts/AccountContext';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveSafetyTimers } from '@/hooks/useActiveSafetyTimers';
import { useActiveWalks } from '@/hooks/useActiveWalks';
import { lockScreenItems, syncLockScreen } from '@/lib/liveActivity';
import { useThemeVersion } from '@/lib/theme';

// Keeps the lock screen in step with your walk, check-on-me timer and shift
// (lib/liveActivity.ts). Draws nothing.
export function LockScreenSync() {
  const version = useThemeVersion(); // a language switch rewords them
  const { session } = useAuth();
  const { orgs } = useAccount();
  const { walks } = useActiveWalks();
  const { timers } = useActiveSafetyTimers();
  const running = useRef(new Map<string, string>());

  useEffect(() => {
    running.current = syncLockScreen(lockScreenItems(walks, timers, orgs, session?.user.id), running.current);
  }, [walks, timers, orgs, session?.user.id, version]);

  return null;
}
