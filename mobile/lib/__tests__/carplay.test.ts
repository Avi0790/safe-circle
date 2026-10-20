import { fake } from '../../test-support/fakeSupabase';
import { CARPLAY_ACTIONS, carPlayState, runCarPlayAction } from '@/lib/carplay';
import { STATUS_DURATION_MINUTES } from '@/lib/status';
import type { MemberWithLocation } from '@/lib/types';

// What the CarPlay screen shows and what its buttons do; only the server
// and GPS are faked.
const mockPermission = { current: 'granted' };
jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => ({ status: mockPermission.current }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: 35.84, longitude: -90.7 } }),
}));

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

function member(id: string, name: string, at: { dLat: number; speed?: number; recorded?: string; battery?: number } | null, extra: Partial<MemberWithLocation> = {}): MemberWithLocation {
  return {
    id, full_name: name, avatar_url: null, share_until: null, status_emoji: null, status_text: null,
    status_expires_at: null, phone_number: null,
    location: at && {
      id: 1, user_id: id, latitude: 35.84 + at.dLat, longitude: -90.7, accuracy: 5,
      battery_level: at.battery ?? null, speed: at.speed ?? null, recorded_at: at.recorded ?? ago(2 * 60_000),
    },
    ...extra,
  };
}

const members = [
  member('me', 'Me', { dLat: 0 }),
  member('none', 'Nobody Yet', null),
  member('far', 'Far Away', { dLat: 0.3, recorded: ago(3 * 3600_000) }),
  member('drive', 'Driver', { dLat: 0.06, speed: 13.41 }),
  member('gone', 'Gone', { dLat: 0.03 }, { share_until: ago(60_000) }),
  member('near', 'Near', { dLat: 0.0101, battery: 0.8 }, { status_emoji: '📚', status_text: 'Studying', status_expires_at: later(3600_000) }),
  member('tiny', 'Next Door', { dLat: 0.001 }),
];

beforeEach(() => {
  fake.reset();
  mockPermission.current = 'granted';
});

describe('carPlayState', () => {
  const state = carPlayState({ signedIn: true, circleName: 'Family', members, myUserId: 'me' });
  const row = (id: string) => state.members.find((m) => m.id === id)!;

  it('lists everyone but you, nearest first, unknown distance last', () => {
    expect(state.members.map((m) => m.id)).toEqual(['tiny', 'near', 'gone', 'drive', 'far', 'none']);
    expect(state.circleName).toBe('Family');
    expect(state.actions).toBe(CARPLAY_ACTIONS);
  });

  it('says status, distance and freshness in one glanceable line', () => {
    expect(row('near')).toMatchObject({ title: 'Near', detail: '📚 Studying · 0.7 mi away · Updated 2m ago' });
    expect(row('drive').detail).toBe('4.1 mi away · Driving 30 mph');
    expect(row('far').detail).toBe('21 mi away · Last seen 3h ago');
    expect(row('gone').detail).toBe('2.1 mi away · Stopped sharing');
    expect(row('none').detail).toBe('No location yet');
    expect(row('tiny').detail).toBe('Nearby · Updated 2m ago');
  });

  it('a tapped member shows status, where, last update and battery', () => {
    expect(row('near').lines).toEqual([
      { title: 'Status', detail: '📚 Studying' },
      { title: 'Where', detail: '0.7 mi away' },
      { title: 'Last update', detail: 'Updated 2m ago' },
      { title: 'Battery', detail: '80%' },
    ]);
    expect(row('none').lines).toEqual([{ title: 'Where', detail: 'No location yet' }]);
  });

  it('drops an expired status', () => {
    const s = carPlayState({
      signedIn: true, circleName: null, myUserId: 'me',
      members: [member('a', 'A', null, { status_emoji: '🚗', status_text: 'On my way', status_expires_at: ago(1000) })],
    });
    expect(s.members[0].detail).toBe('No location yet');
  });

  it('without your own location, nobody has a distance and names decide the order', () => {
    const s = carPlayState({ signedIn: true, circleName: null, members: members.filter((m) => m.id !== 'me'), myUserId: 'me' });
    expect(s.members.map((m) => m.title)).toEqual(['Driver', 'Far Away', 'Gone', 'Near', 'Next Door', 'Nobody Yet']);
    expect(s.members.find((m) => m.id === 'drive')!.detail).toBe('Driving 30 mph');
  });

  it('only SOS asks before sending', () => {
    expect(CARPLAY_ACTIONS.filter((a) => a.confirm).map((a) => a.id)).toEqual(['sos']);
  });
});

describe('runCarPlayAction', () => {
  it('"On my way" sets your status', async () => {
    expect(await runCarPlayAction('on-my-way', 'c1')).toBe('Status set: On my way');
    expect(fake.rpcsOf('set_status')).toEqual([{ p_emoji: '🚗', p_text: 'On my way', p_minutes: STATUS_DURATION_MINUTES }]);
  });

  it('says why the status could not be set', async () => {
    fake.rpcResults.set_status = { error: { message: 'Network request failed' } };
    expect(await runCarPlayAction('on-my-way', 'c1')).toBe("Couldn't set status: Network request failed");
  });

  it('"Check in" posts your location to the circle chat', async () => {
    expect(await runCarPlayAction('check-in', 'c1')).toBe('Checked in with your circle');
    expect(fake.queriesOf('messages', 'insert')[0].payload).toEqual({ circle_id: 'c1', body: '📍 Checked in', latitude: 35.84, longitude: -90.7 });
  });

  it('a check-in needs a circle and location permission', async () => {
    expect(await runCarPlayAction('check-in', null)).toBe("Couldn't check in: No circle selected.");
    mockPermission.current = 'denied';
    expect(await runCarPlayAction('check-in', 'c1')).toBe("Couldn't check in: Location permission denied.");
    expect(fake.queriesOf('messages', 'insert')).toHaveLength(0);
  });

  it('SOS sends an SOS event with your location', async () => {
    expect(await runCarPlayAction('sos', 'c1')).toBe('SOS sent to your circle');
    expect(fake.queriesOf('sos_events', 'insert')[0].payload).toEqual({ latitude: 35.84, longitude: -90.7 });
  });

  it('says when the SOS did not go out', async () => {
    fake.errors['sos_events.insert'] = { message: 'Too many SOS alerts' };
    expect(await runCarPlayAction('sos', 'c1')).toBe('SOS not sent: Too many SOS alerts');
  });

  it('ignores anything else', async () => {
    expect(await runCarPlayAction('self-destruct', 'c1')).toBe('Unknown action');
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.queries).toHaveLength(0);
  });
});
