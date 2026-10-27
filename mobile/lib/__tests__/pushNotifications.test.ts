import { fake } from '../../test-support/fakeSupabase';

// Registering for push: a build without Apple's push entitlement (local
// builds signed with a free developer account) gets a plain explanation,
// not iOS's raw error.
const mockToken: { result: () => Promise<{ data: string }> } = { result: async () => ({ data: 'ExponentPushToken[abc]' }) };
jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'p1' } } } } }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => ({ status: 'granted' }),
  requestPermissionsAsync: async () => ({ status: 'granted' }),
  getExpoPushTokenAsync: () => mockToken.result(),
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: async () => {},
}));

import { PUSH_UNAVAILABLE_IN_BUILD, registerForPushNotifications } from '@/lib/pushNotifications';

beforeEach(() => fake.reset());

describe('registerForPushNotifications', () => {
  it('saves the token when push works', async () => {
    mockToken.result = async () => ({ data: 'ExponentPushToken[abc]' });
    expect(await registerForPushNotifications()).toEqual({ ok: true, token: 'ExponentPushToken[abc]' });
    expect(fake.queriesOf('push_tokens', 'upsert')[0].payload).toMatchObject({ token: 'ExponentPushToken[abc]' });
  });

  it('explains a build without the push entitlement in plain words', async () => {
    mockToken.result = async () => {
      throw new Error('UnexpectedException: no valid "aps-environment" entitlement string found for application');
    };
    expect(await registerForPushNotifications()).toEqual({ ok: false, reason: 'not-configured', message: PUSH_UNAVAILABLE_IN_BUILD });
    expect(PUSH_UNAVAILABLE_IN_BUILD).toContain('free Apple developer account');
    expect(fake.queriesOf('push_tokens')).toHaveLength(0);
  });

  it('passes other errors through', async () => {
    mockToken.result = async () => {
      throw new Error('The network connection was lost.');
    };
    expect(await registerForPushNotifications()).toEqual({ ok: false, reason: 'error', message: 'The network connection was lost.' });
  });
});
