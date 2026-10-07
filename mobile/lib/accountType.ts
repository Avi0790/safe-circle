export type AccountType = 'individual' | 'family' | 'industry';

export interface AccountTypeOption {
  id: AccountType;
  emoji: string;
  title: string;
  description: string;
}

export const ACCOUNT_TYPES: AccountTypeOption[] = [
  {
    id: 'individual',
    emoji: '🧍',
    title: 'Just me',
    description: 'Your own map, trips and privacy tools. Add people any time.',
  },
  {
    id: 'family',
    emoji: '👪',
    title: 'Family & friends',
    description: 'Share locations with a circle of people you choose.',
  },
  {
    id: 'industry',
    emoji: '🏗️',
    title: 'Work crew',
    description: 'Field crews: clock in and out, and managers see the crew on shift.',
  },
];

export const DEFAULT_ACCOUNT_TYPE: AccountType = 'family';

// Anything missing or unrecognised is treated as family — the same fallback
// the database trigger uses — so an old or odd value can't strand anyone.
export function parseAccountType(value: unknown): AccountType {
  return value === 'individual' || value === 'family' || value === 'industry'
    ? value
    : DEFAULT_ACCOUNT_TYPE;
}

// Who gets past onboarding into the main app. It used to be "has a circle";
// individuals have nothing to join, and org workers belong to an
// organization instead. Account type is only a routing preference — what
// anyone can see is still decided by the circle and organization rules.
export function canEnterApp(state: {
  hasCircle: boolean;
  hasActiveOrg: boolean;
  accountType: AccountType;
}): boolean {
  return state.hasCircle || state.hasActiveOrg || state.accountType === 'individual';
}
