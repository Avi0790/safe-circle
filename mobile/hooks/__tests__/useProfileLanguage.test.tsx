import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { applyLanguagePref } from '@/lib/i18n';

// Records each profiles update: { values, id }.
const mockUpdates: { values: Record<string, unknown>; id: unknown }[] = [];
let mockUserId: string | null = 'user-1';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, id: unknown) => {
          if (table === 'profiles') mockUpdates.push({ values, id });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: mockUserId ? { user: { id: mockUserId } } : null }),
}));

// eslint-disable-next-line import/first
import { useProfileLanguage } from '../useProfileLanguage';

function Probe() {
  useProfileLanguage();
  return null;
}

async function mount() {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<Probe />);
  });
  return r;
}

beforeEach(() => {
  mockUpdates.length = 0;
  mockUserId = 'user-1';
  applyLanguagePref('en');
});
afterAll(() => applyLanguagePref('en'));

describe('useProfileLanguage', () => {
  it('tells the server your language when you sign in', async () => {
    await mount();
    expect(mockUpdates).toEqual([{ values: { language: 'en' }, id: 'user-1' }]);
  });

  it('and again when you switch, so the next notification arrives in Spanish', async () => {
    await mount();
    await act(async () => applyLanguagePref('es'));
    expect(mockUpdates.at(-1)).toEqual({ values: { language: 'es' }, id: 'user-1' });
  });

  it('says nothing when nobody is signed in', async () => {
    mockUserId = null;
    await mount();
    expect(mockUpdates).toEqual([]);
  });
});
