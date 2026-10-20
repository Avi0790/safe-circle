import React from 'react';
import { Alert } from 'react-native';
import { fake } from '../../test-support/fakeSupabase';
import { allText, pressables, press, render, tapAlertButton, unmountAll } from '../../test-support/render';

// The Members tab with its real rows and actions; only the server, the
// signed-in user, the selected circle and the members provider are faked.
const mockPush = jest.fn();
const mockRefreshMembers = jest.fn(async () => {});
const mockRefreshCircles = jest.fn(async () => {});
const mockState: { members: unknown[]; createdBy: string; loading: boolean } = { members: [], createdBy: 'me', loading: false };

jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
const mockSession = { user: { id: 'me' } };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock('@/contexts/CircleContext', () => ({
  useCircles: () => ({ selectedCircle: { id: 'c1', name: 'Family', created_by: mockState.createdBy }, refresh: mockRefreshCircles }),
}));
jest.mock('@/contexts/CircleMembersContext', () => ({
  useCircleMembersContext: () => ({ members: mockState.members, isLoading: mockState.loading, error: null, refresh: mockRefreshMembers }),
}));

import MembersTab from '../../app/(app)/(tabs)/members';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const later = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

const member = (id: string, name: string, loc: Partial<{ lat: number; lon: number; at: string; speed: number; battery: number }> | null, extra = {}) => ({
  id, full_name: name, avatar_url: null, share_until: null, status_emoji: null, status_text: null, status_expires_at: null,
  phone_number: null,
  location: loc
    ? { id: 1, user_id: id, latitude: loc.lat ?? 35.84, longitude: loc.lon ?? -90.7, accuracy: 10,
        battery_level: loc.battery ?? 0.8, speed: loc.speed ?? 0, recorded_at: loc.at ?? ago(0) }
    : null,
  ...extra,
});

beforeEach(() => {
  fake.reset();
  mockPush.mockReset();
  mockRefreshMembers.mockClear();
  mockRefreshCircles.mockClear();
  mockState.createdBy = 'me';
  mockState.loading = false;
  mockState.members = [
    member('me', 'Me', { lat: 35.84, lon: -90.7 }),
    member('sam', 'Sam', { lat: 35.85, lon: -90.7 }, { status_emoji: '📚', status_text: 'Studying', status_expires_at: later(30) }),
    member('dee', 'Dee', { speed: 13.4, battery: 0.1 }),
    member('old', 'Old Phone', { at: ago(120) }),
    member('kim', 'Kim', null),
    member('gone', 'Gone', { at: ago(1) }, { share_until: ago(5) }),
  ];
});

afterEach(unmountAll);

describe('Members tab', () => {
  it('lists everyone with what you need at a glance', async () => {
    const r = await render(<MembersTab />);
    const t = allText(r);
    expect(t).toContain('Family');
    expect(t).toContain('6 members');
    expect(t).toContain('📚 Studying'); // a live status chip
    expect(t).toMatch(/Updated just now · 0\.7 mi away · 80% battery/); // Sam, measured from me
    expect(t).toMatch(/🚗 Driving 30 mph/);
    expect(t).toMatch(/10% battery ⚠️/); // low battery is flagged
    expect(t).toMatch(/Last seen 2h ago — may not be current/);
    expect(t).toContain('No location shared yet');
    expect(t).toContain('Stopped sharing'); // a temporary window that has ended
  });

  it('never measures a distance to yourself', async () => {
    mockState.members = [member('me', 'Me', {})];
    const r = await render(<MembersTab />);
    expect(allText(r)).not.toMatch(/away/);
    expect(allText(r)).toContain('1 member');
  });

  it('opens a member', async () => {
    const r = await render(<MembersTab />);
    await press(r, 'Sam');
    expect(mockPush).toHaveBeenCalledWith('/member/sam');
  });

  it('shows no owner actions to an ordinary member', async () => {
    mockState.createdBy = 'someone-else';
    const r = await render(<MembersTab />);
    expect(pressables(r, 'Remove')).toHaveLength(0);
    expect(pressables(r, 'Make owner')).toHaveLength(0);
  });

  it("the owner can remove someone, but isn't offered removing themselves", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<MembersTab />);
    expect(pressables(r, 'Remove')).toHaveLength(5); // everyone but me
    await press(r, 'Remove', 0); // Sam is listed first after me
    expect(alert.mock.calls[0][0]).toBe('Remove Sam?');
    await tapAlertButton(alert, 'Remove');
    const del = fake.queriesOf('circle_members', 'delete');
    expect(del).toHaveLength(1);
    expect(del[0].calls).toEqual([
      ['eq', 'circle_id', 'c1'],
      ['eq', 'user_id', 'sam'],
    ]);
    expect(mockRefreshMembers).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('says so when a removal is refused', async () => {
    fake.errors['circle_members.delete'] = { message: 'permission denied' };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<MembersTab />);
    await press(r, 'Remove', 0);
    await tapAlertButton(alert, 'Remove');
    expect(alert.mock.calls[1]).toEqual(['Could not remove member', 'permission denied']);
    expect(mockRefreshMembers).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('the owner can hand the circle over', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<MembersTab />);
    await press(r, 'Make owner', 0);
    expect(alert.mock.calls[0][0]).toBe('Make Sam the owner?');
    await tapAlertButton(alert, 'Make owner');
    expect(fake.rpcsOf('transfer_circle_ownership')).toEqual([{ p_circle_id: 'c1', p_new_owner: 'sam' }]);
    expect(mockRefreshCircles).toHaveBeenCalled();

    fake.rpcResults.transfer_circle_ownership = { error: { message: 'Only the owner can do that.' } };
    await tapAlertButton(alert, 'Make owner');
    expect(alert.mock.calls[1]).toEqual(["Couldn't transfer ownership", 'Only the owner can do that.']);
    alert.mockRestore();
  });

  it('says when nobody is here yet', async () => {
    mockState.members = [];
    const r = await render(<MembersTab />);
    expect(allText(r)).toContain('No one in this circle yet.');
    expect(allText(r)).toContain('0 members');
  });
});
