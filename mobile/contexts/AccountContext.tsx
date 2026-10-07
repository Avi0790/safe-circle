import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { DEFAULT_ACCOUNT_TYPE, parseAccountType, type AccountType } from '@/lib/accountType';
import { activeOrgs, pendingInvite, type OrgMembership } from '@/lib/orgInfo';

interface AccountContextValue {
  accountType: AccountType;
  orgs: OrgMembership[];
  hasActiveOrg: boolean;
  pendingInvite: OrgMembership | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue>({
  accountType: DEFAULT_ACCOUNT_TYPE,
  orgs: [],
  hasActiveOrg: false,
  pendingInvite: null,
  isLoading: true,
  refresh: async () => {},
});

// The signup choice (individual / family / industry) and any organization
// memberships. Together with the circle list these decide which onboarding
// someone sees and whether they're let into the app yet.
export function AccountProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [accountType, setAccountType] = useState<AccountType>(DEFAULT_ACCOUNT_TYPE);
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const [{ data: profile }, { data: orgRows }] = await Promise.all([
      supabase.from('profiles').select('account_type').eq('id', userId).single(),
      supabase.rpc('my_orgs'),
    ]);
    setAccountType(parseAccountType(profile?.account_type));
    setOrgs((orgRows as OrgMembership[] | null) ?? []);
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AccountContext.Provider
      value={{
        accountType,
        orgs,
        hasActiveOrg: activeOrgs(orgs).length > 0,
        pendingInvite: pendingInvite(orgs),
        isLoading,
        refresh,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}
