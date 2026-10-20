import React from 'react';
import { TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import { fake } from '../../test-support/fakeSupabase';
import { allText, press, render, unmountAll } from '../../test-support/render';

// Joining or creating a work organization — at first-run onboarding and from
// Settings → Work (with onDone). The server and the account are faked; the
// account's refresh re-reads the memberships the fake server holds.
type Org = { org_id: string; name: string; status: 'invited' | 'active' };
const mockAccount = {
  orgs: [] as Org[],
  listeners: new Set<() => void>(),
  set(orgs: Org[]) {
    this.orgs = orgs;
    this.listeners.forEach((l) => l());
  },
  refresh: jest.fn(async () => {}),
};
jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('@/contexts/AccountContext', () => ({
  useAccount: () => {
    const orgs = require('react').useSyncExternalStore(
      (l: () => void) => (mockAccount.listeners.add(l), () => mockAccount.listeners.delete(l)),
      () => mockAccount.orgs,
    ) as Org[];
    return { orgs, pendingInvite: orgs.find((o) => o.status === 'invited') ?? null, refresh: mockAccount.refresh };
  },
}));

import { OrgOnboarding } from '../OrgOnboarding';

let server: Org[] = [];
beforeEach(() => {
  fake.reset();
  mockAccount.orgs = [];
  server = [];
  mockAccount.refresh.mockReset();
  mockAccount.refresh.mockImplementation(async () => mockAccount.set(server.map((o) => ({ ...o }))));
  fake.rpcHandlers.redeem_org_invite_code = ({ p_code }) => {
    if (p_code !== 'AB12CD') return { data: null };
    if (!server.some((o) => o.org_id === 'o1')) server.push({ org_id: 'o1', name: 'Riverside Utilities', status: 'invited' });
    return { data: 'o1' };
  };
  fake.rpcHandlers.accept_org_consent = () => {
    server = server.map((o) => ({ ...o, status: 'active' }));
    return {};
  };
  fake.rpcHandlers.leave_org = () => {
    server = [];
    return {};
  };
});
afterEach(unmountAll);

async function typeCode(r: Awaited<ReturnType<typeof render>>, code: string) {
  await act(async () => r.root.findByType(TextInput).props.onChangeText(code));
}

describe('OrgOnboarding', () => {
  it('from Settings: join with a code, read what they can see, accept, and go back', async () => {
    const done = jest.fn();
    const r = await render(<OrgOnboarding heading="Add work" intro="Your family circles stay exactly as they are." onDone={done} />);
    expect(allText(r)).toContain('Add work');
    expect(allText(r)).toContain('Your family circles stay exactly as they are.');
    await press(r, 'Join with a code');
    await typeCode(r, 'ab12cd');
    await press(r, 'Continue');
    expect(fake.rpcsOf('redeem_org_invite_code')).toEqual([{ p_code: 'AB12CD' }]);
    expect(allText(r)).toContain('Join Riverside Utilities');
    expect(allText(r)).toContain('only while you are clocked in');
    expect(done).not.toHaveBeenCalled(); // nobody sees you until you accept
    await press(r, 'I understand — join');
    expect(fake.rpcsOf('accept_org_consent')).toEqual([{ p_org: 'o1' }]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('declining leaves the invitation and stays here', async () => {
    const done = jest.fn();
    const r = await render(<OrgOnboarding onDone={done} />);
    await press(r, 'Join with a code');
    await typeCode(r, 'AB12CD');
    await press(r, 'Continue');
    await press(r, 'Decline');
    expect(fake.rpcsOf('leave_org')).toEqual([{ p_org: 'o1' }]);
    expect(done).not.toHaveBeenCalled();
    expect(allText(r)).toContain('Create an organization');
  });

  it('a wrong code, or one for an organization you are already in, says so', async () => {
    const r = await render(<OrgOnboarding onDone={jest.fn()} />);
    await press(r, 'Join with a code');
    await typeCode(r, 'ZZZZZZ');
    await press(r, 'Continue');
    expect(allText(r)).toContain('Invalid or expired invite code.');

    server = [{ org_id: 'o1', name: 'Riverside Utilities', status: 'active' }];
    mockAccount.orgs = server.map((o) => ({ ...o }));
    const r2 = await render(<OrgOnboarding onDone={jest.fn()} />);
    await press(r2, 'Join with a code');
    await typeCode(r2, 'AB12CD');
    await press(r2, 'Continue');
    expect(allText(r2)).toContain("You're already in this organization.");
    expect(mockAccount.refresh).not.toHaveBeenCalled();
  });

  it('creating one shows the code once, then goes back on Done', async () => {
    fake.rpcResults.create_organization = { data: [{ invite_code: 'XY34ZW' }] };
    const done = jest.fn();
    const r = await render(<OrgOnboarding onDone={done} />);
    await press(r, 'Create an organization');
    await act(async () => r.root.findByType(TextInput).props.onChangeText('  Riverside Utilities '));
    await press(r, 'Create');
    expect(fake.rpcsOf('create_organization')).toEqual([{ p_name: 'Riverside Utilities' }]);
    expect(allText(r)).toContain('XY34ZW');
    expect(done).not.toHaveBeenCalled();
    await press(r, 'Done');
    expect(mockAccount.refresh).toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('first-run onboarding (no onDone) keeps its welcome text', async () => {
    const r = await render(<OrgOnboarding />);
    expect(allText(r)).toContain('Welcome');
    expect(allText(r)).toContain('the code your manager gave you');
  });
});
