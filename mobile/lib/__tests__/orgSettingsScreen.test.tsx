import React from 'react';
import { TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import { fake } from '../../test-support/fakeSupabase';
import { allText, pressables, press, render, unmountAll } from '../../test-support/render';
import { confirmsName } from '@/lib/orgSettings';

// Organization settings: rename (owners, admins) and delete (owners, typing
// the name). The server and the account are faked.
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockRefresh = jest.fn(async () => {});
const mockRole: { current: string } = { current: 'owner' };
jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ orgId: 'o1' }),
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('@/contexts/AccountContext', () => ({
  useAccount: () => ({ orgs: [{ org_id: 'o1', name: 'Riverside', role: mockRole.current }], refresh: mockRefresh }),
}));

import OrgSettingsScreen from '../../app/(app)/org-settings';

const inputs = (r: Awaited<ReturnType<typeof render>>) => r.root.findAll((n) => n.type === TextInput);

beforeEach(() => {
  fake.reset();
  mockBack.mockClear();
  mockPush.mockClear();
  mockRefresh.mockClear();
  mockRole.current = 'owner';
});
afterEach(unmountAll);

describe('confirmsName', () => {
  it('matches the name ignoring case and spaces, never an empty box', () => {
    expect(confirmsName(' riverside ', 'Riverside')).toBe(true);
    expect(confirmsName('Riversid', 'Riverside')).toBe(false);
    expect(confirmsName('  ', '  ')).toBe(false);
  });
});

describe('Organization settings', () => {
  it('renames it and refreshes', async () => {
    const r = await render(<OrgSettingsScreen />);
    expect(pressables(r, 'Save name')).toHaveLength(0); // unchanged name
    await act(async () => inputs(r)[0].props.onChangeText('Riverside Crew'));
    await press(r, 'Save name');
    expect(fake.rpcsOf('rename_organization')).toEqual([{ p_org: 'o1', p_name: 'Riverside Crew' }]);
    expect(mockRefresh).toHaveBeenCalled();
    expect(allText(r)).toContain('Renamed.');
  });

  it('deletes only once the name is typed, offering the timesheets first', async () => {
    const r = await render(<OrgSettingsScreen />);
    const t = allText(r);
    expect(t).toContain('Delete Riverside');
    expect(t).toContain('All shifts, timesheets, teams');
    expect(t).toContain('Nobody’s circles or own location history are touched.');
    await press(r, 'Open timesheets');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/timesheets', params: { orgId: 'o1', orgName: 'Riverside' } });

    expect(pressables(r, 'Delete organization')).toHaveLength(0);
    await act(async () => inputs(r)[1].props.onChangeText('riverside'));
    await press(r, 'Delete organization');
    expect(fake.rpcsOf('delete_organization')).toEqual([{ p_org: 'o1', p_confirm_name: 'riverside' }]);
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

  it('shows why the server refused, and stays', async () => {
    fake.rpcResults.delete_organization = { error: { message: 'Only an owner can delete the organization.' } };
    const r = await render(<OrgSettingsScreen />);
    await act(async () => inputs(r)[1].props.onChangeText('Riverside'));
    await press(r, 'Delete organization');
    expect(allText(r)).toContain('Only an owner can delete the organization.');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('an admin can rename but is not offered delete', async () => {
    mockRole.current = 'admin';
    const r = await render(<OrgSettingsScreen />);
    expect(allText(r)).toContain('Organization name');
    expect(allText(r)).not.toContain('Delete Riverside');
  });

  it('a worker or manager gets neither', async () => {
    mockRole.current = 'manager';
    const r = await render(<OrgSettingsScreen />);
    expect(allText(r)).toContain('Only owners and admins can change the organization.');
    expect(inputs(r)).toHaveLength(0);
  });
});
