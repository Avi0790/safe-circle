import React from 'react';
import { Alert, Share, Switch, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from 'react-test-renderer';
import { fake, supabase } from '../../test-support/fakeSupabase';
import { allText, press, pressables, text, render, switchFor, tapAlertButton, toggle, unmountAll } from '../../test-support/render';

// The Settings tab with its real logic, sharing window and sign-out cleanup.
// Faked: the server, the signed-in user and circles, and the phone features
// it drives (background location, push registration, the photo picker, the
// export share sheet, shake and app-lock preferences).
const mockPush = jest.fn();
const mockCircles = { refresh: jest.fn(async () => {}), select: jest.fn() };
const mockTracking = {
  active: false,
  background: true,
  start: jest.fn(async () => ({ ok: true as const, backgroundGranted: true })),
  stop: jest.fn(async () => {}),
};
const mockRegisterPush = jest.fn(async () => ({ ok: true as const }));
const mockExport = jest.fn(async (_data: unknown) => ({ ok: true as const }));
const mockLock = { enabled: false, set: jest.fn(async (_v: boolean) => null as string | null) };
const mockShake = { enabled: false, set: jest.fn() };

jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
// Stable like the real AuthContext's: Settings reloads your profile when it changes.
const mockSession = { user: { id: 'me', email: 'me@example.com' } };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock('@/contexts/CircleContext', () => ({
  useCircles: () => ({
    circles: [
      { id: 'c1', name: 'Family', created_by: 'me' },
      { id: 'c2', name: 'Roommates', created_by: 'sam' },
    ],
    selectedCircle: { id: 'c1', name: 'Family', created_by: 'me' },
    setSelectedCircleId: mockCircles.select,
    refresh: mockCircles.refresh,
  }),
}));
const mockAccount: { orgs: { org_id: string; name: string; status: string }[]; pendingInvite: { org_id: string; name: string } | null } = {
  orgs: [],
  pendingInvite: null,
};
jest.mock('@/contexts/AccountContext', () => ({ useAccount: () => mockAccount }));
jest.mock('@/contexts/ShakeSettingsContext', () => ({
  useShakeSettings: () => ({ enabled: mockShake.enabled, setEnabled: mockShake.set }),
}));
jest.mock('@/contexts/AppLockContext', () => ({
  useAppLock: () => ({ enabled: mockLock.enabled, setEnabled: mockLock.set }),
}));
jest.mock('@/lib/locationTracking', () => ({
  isTrackingActive: async () => mockTracking.active,
  isBackgroundTaskActive: async () => mockTracking.background,
  getShareUntil: async () => null,
  setShareUntil: async () => {},
  stopIfShareWindowEnded: async () => false,
  startBackgroundTracking: () => mockTracking.start(),
  stopBackgroundTracking: () => mockTracking.stop(),
}));
jest.mock('@/lib/pushNotifications', () => ({
  ...jest.requireActual('@/lib/pushNotifications'),
  registerForPushNotifications: () => mockRegisterPush(),
}));
jest.mock('@/lib/avatarUpload', () => ({
  pickAndUploadAvatar: async () => ({ ok: true, url: 'https://example.invalid/new.jpg' }),
  removeAvatar: async () => ({ ok: true, url: null }),
}));
jest.mock('@/lib/dataExport', () => ({ exportDataToFile: (d: unknown) => mockExport(d) }));

import SettingsTab from '../../app/(app)/(tabs)/settings';

const later = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const inputLabelled = (r: Awaited<ReturnType<typeof render>>, placeholderOrValue: string) =>
  r.root.findAll((n) => n.type === TextInput && (n.props.placeholder === placeholderOrValue || n.props.value === placeholderOrValue))[0];

beforeEach(async () => {
  fake.reset();
  await AsyncStorage.clear();
  fake.tables.profiles = [
    { full_name: 'Surendra', avatar_url: null, status_emoji: '📚', status_expires_at: later(60), phone_number: null, nearby_alerts: false },
  ];
  fake.tables.push_tokens = [];
  mockPush.mockReset();
  mockCircles.refresh.mockClear();
  mockCircles.select.mockClear();
  mockTracking.active = false;
  mockTracking.start.mockClear();
  mockTracking.start.mockImplementation(async () => ({ ok: true as const, backgroundGranted: true }));
  mockTracking.stop.mockClear();
  mockRegisterPush.mockReset();
  mockRegisterPush.mockImplementation(async () => ({ ok: true as const }));
  mockExport.mockClear();
  mockLock.enabled = false;
  mockLock.set.mockClear();
  mockShake.set.mockClear();
  mockAccount.orgs = [];
  mockAccount.pendingInvite = null;
});
afterEach(unmountAll);

describe('Settings tab: you', () => {
  it('shows who you are, from your profile', async () => {
    const r = await render(<SettingsTab />);
    const t = allText(r);
    expect(t).toContain('me@example.com');
    expect(t).toContain('Surendra');
    expect(t).toContain('Not set'); // no phone number yet
    expect(fake.queriesOf('profiles', 'select')[0].calls).toContainEqual(['eq', 'id', 'me']);
  });

  it('renames you, and refuses an empty name', async () => {
    const r = await render(<SettingsTab />);
    await press(r, 'Edit', 0);
    await act(async () => inputLabelled(r, 'Surendra').props.onChangeText('   '));
    await press(r, 'Save');
    expect(allText(r)).toContain('Enter your name.');
    expect(fake.queriesOf('profiles', 'update')).toHaveLength(0);

    await act(async () => inputLabelled(r, '   ').props.onChangeText(' Surendra B K '));
    await press(r, 'Save');
    const upd = fake.queriesOf('profiles', 'update');
    expect(upd.map((q) => q.payload)).toEqual([{ full_name: 'Surendra B K' }]);
    expect(upd[0].calls).toEqual([['eq', 'id', 'me']]);
    expect(allText(r)).toContain('Surendra B K');
  });

  it('saves a phone number (only used for Text for help)', async () => {
    const r = await render(<SettingsTab />);
    await press(r, 'Edit', 1);
    await act(async () => inputLabelled(r, '+1 555 123 4567').props.onChangeText('+1 870 555 0100'));
    await press(r, 'Save');
    expect(fake.queriesOf('profiles', 'update').map((q) => q.payload)).toEqual([{ phone_number: '+1 870 555 0100' }]);
    expect(allText(r)).toContain('+1 870 555 0100');
  });

  it('a quick status sets for 4 hours; tapping the current one clears it', async () => {
    const r = await render(<SettingsTab />);
    await press(r, 'On my way');
    expect(fake.rpcsOf('set_status')).toEqual([{ p_emoji: '🚗', p_text: 'On my way', p_minutes: 240 }]);
    await press(r, 'On my way');
    expect(fake.rpcsOf('clear_status')).toHaveLength(1);
  });

  it('changes and removes the profile photo', async () => {
    const r = await render(<SettingsTab />);
    await press(r, 'Choose photo');
    expect(allText(r)).toContain('Change photo');
    await press(r, 'Remove', 0);
    expect(allText(r)).toContain('Choose photo');
  });
});

describe('Settings tab: sharing and alerts', () => {
  it('shares for one hour: opens the window on the server, then starts tracking', async () => {
    fake.rpcResults.set_share_window = { data: later(60) };
    const r = await render(<SettingsTab />);
    expect(allText(r)).toContain('Choose how long to share, then switch it on.');
    await press(r, '1 hour');
    await toggle(switchFor(r, 'Share my location', Switch), true);
    expect(fake.rpcsOf('set_share_window')).toEqual([{ p_minutes: 60 }]);
    expect(mockTracking.start).toHaveBeenCalled();
    expect(allText(r)).toMatch(/Sharing until .*, then it stops on its own\./);
    expect(switchFor(r, 'Share my location', Switch).props.value).toBe(true);
  });

  it('if tracking cannot start, closes the window again and says why', async () => {
    mockTracking.start.mockImplementation(async () => ({ ok: false, reason: 'Location permission was denied.' }) as any);
    const r = await render(<SettingsTab />);
    await press(r, '1 hour');
    await toggle(switchFor(r, 'Share my location', Switch), true);
    expect(fake.rpcsOf('set_share_window')).toEqual([{ p_minutes: 60 }, { p_minutes: 0 }]);
    expect(allText(r)).toContain('Location permission was denied.');
    expect(switchFor(r, 'Share my location', Switch).props.value).toBe(false);
  });

  it('stopping turns tracking off', async () => {
    mockTracking.active = true;
    const r = await render(<SettingsTab />);
    expect(allText(r)).toContain('Runs in the background, even when the app is closed.');
    await toggle(switchFor(r, 'Share my location', Switch), false);
    expect(mockTracking.stop).toHaveBeenCalled();
    expect(switchFor(r, 'Share my location', Switch).props.value).toBe(false);
  });

  it('push: reflects whether this account has a device registered, and explains a failure', async () => {
    fake.tables.push_tokens = [{ token: 'ExponentPushToken[x]' }];
    let r = await render(<SettingsTab />);
    expect(switchFor(r, 'Push notifications', Switch).props.value).toBe(true);
    await toggle(switchFor(r, 'Push notifications', Switch), false);
    expect(fake.queriesOf('push_tokens', 'delete')[0].calls).toEqual([['eq', 'user_id', 'me']]);
    await unmountAll();

    fake.tables.push_tokens = [];
    mockRegisterPush.mockImplementation(async () => ({ ok: false, message: 'Push needs a real device.' }) as any);
    r = await render(<SettingsTab />);
    await toggle(switchFor(r, 'Push notifications', Switch), true);
    expect(allText(r)).toContain('Push needs a real device.');
    expect(switchFor(r, 'Push notifications', Switch).props.value).toBe(false);
  });

  it('nearby alerts save to your profile, and stay off if that fails', async () => {
    const r = await render(<SettingsTab />);
    await toggle(switchFor(r, 'Nearby alerts', Switch), true);
    expect(fake.queriesOf('profiles', 'update').map((q) => q.payload)).toEqual([{ nearby_alerts: true }]);
    expect(switchFor(r, 'Nearby alerts', Switch).props.value).toBe(true);

    fake.errors['profiles.update'] = { message: 'Offline' };
    await toggle(switchFor(r, 'Nearby alerts', Switch), false);
    expect(allText(r)).toContain('Offline');
    expect(switchFor(r, 'Nearby alerts', Switch).props.value).toBe(true);
  });

  it('shake for SOS and app lock pass through, and an app-lock problem is shown', async () => {
    mockLock.set.mockImplementation(async () => 'Set up a passcode on this phone first.');
    const r = await render(<SettingsTab />);
    await toggle(switchFor(r, 'Shake for SOS', Switch), true);
    expect(mockShake.set).toHaveBeenCalledWith(true);
    await toggle(switchFor(r, 'Lock the app', Switch), true);
    expect(mockLock.set).toHaveBeenCalledWith(true);
    expect(allText(r)).toContain('Set up a passcode on this phone first.');
  });
});

describe('Settings tab: circles', () => {
  it('you can rename or delete circles you made, and leave the others', async () => {
    const r = await render(<SettingsTab />);
    expect(pressables(r, 'Rename')).toHaveLength(1);
    // exactly "Delete" (not "Delete my account")
    expect(pressables(r, 'Delete').filter((h) => text({ children: h.children }) === 'Delete')).toHaveLength(1);
    expect(pressables(r, 'Leave')).toHaveLength(1);
  });

  it('renames a circle, and needs a name', async () => {
    const r = await render(<SettingsTab />);
    await press(r, 'Rename');
    await act(async () => inputLabelled(r, 'Family').props.onChangeText(''));
    await press(r, 'Save');
    expect(allText(r)).toContain('Give your circle a name.');
    await act(async () => inputLabelled(r, '').props.onChangeText('The Family'));
    await press(r, 'Save');
    const upd = fake.queriesOf('circles', 'update');
    expect(upd.map((q) => q.payload)).toEqual([{ name: 'The Family' }]);
    expect(upd[0].calls).toEqual([['eq', 'id', 'c1']]);
    expect(mockCircles.refresh).toHaveBeenCalled();
  });

  it('leaves a circle after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<SettingsTab />);
    await press(r, 'Leave');
    expect(alert.mock.calls[0][0]).toBe('Leave Roommates?');
    await tapAlertButton(alert, 'Leave');
    expect(fake.queriesOf('circle_members', 'delete')[0].calls).toEqual([
      ['eq', 'circle_id', 'c2'],
      ['eq', 'user_id', 'me'],
    ]);
    expect(mockCircles.refresh).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('deletes your own circle after confirming, and shows a refusal', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<SettingsTab />);
    await press(r, 'Delete');
    expect(alert.mock.calls[0][0]).toBe('Delete Family?');
    fake.errors['circles.delete'] = { message: 'permission denied' };
    await tapAlertButton(alert, 'Delete');
    expect(fake.queriesOf('circles', 'delete')[0].calls).toEqual([['eq', 'id', 'c1']]);
    expect(allText(r)).toContain('permission denied');
    expect(mockCircles.refresh).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('switches the selected circle', async () => {
    const r = await render(<SettingsTab />);
    expect(allText(r)).toContain('✓ Family');
    await press(r, 'Roommates');
    expect(mockCircles.select).toHaveBeenCalledWith('c2');
  });

  it('makes an invite code with a QR, and shares it', async () => {
    fake.rpcResults.regenerate_invite_code = { data: 'ABCD-2345' };
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const r = await render(<SettingsTab />);
    await press(r, 'Get invite code');
    expect(fake.rpcsOf('regenerate_invite_code')).toEqual([{ target_circle_id: 'c1' }]);
    expect(allText(r)).toContain('ABCD-2345');
    await press(r, 'Share invite');
    expect(share).toHaveBeenCalledWith({ message: 'Join my Safe Circle "Family"! Use invite code ABCD-2345 in the app.' });
    share.mockRestore();
  });
});

describe('Settings tab: work', () => {
  it('any account can join or create an organization, keeping its circles', async () => {
    const r = await render(<SettingsTab />);
    expect(allText(r)).toContain("Use this same account for work");
    await press(r, 'Join or create an organization');
    expect(mockPush).toHaveBeenCalledWith('/add-org');
  });

  it('names the organizations you are in, and lets you join another', async () => {
    mockAccount.orgs = [
      { org_id: 'o1', name: 'Riverside Utilities', status: 'active' },
      { org_id: 'o2', name: 'Pending Co', status: 'invited' },
    ];
    const r = await render(<SettingsTab />);
    expect(allText(r)).toContain("You're in Riverside Utilities. Clock in and out from the Work tab.");
    await press(r, 'Join another organization');
    expect(mockPush).toHaveBeenCalledWith('/add-org');
  });

  it('brings you back to an invitation you have not answered yet', async () => {
    mockAccount.pendingInvite = { org_id: 'o2', name: 'Pending Co' };
    const r = await render(<SettingsTab />);
    expect(allText(r)).toContain('You started joining Pending Co.');
    await press(r, 'Finish joining Pending Co');
    expect(mockPush).toHaveBeenCalledWith('/add-org');
  });
});

describe('Settings tab: your data and signing out', () => {
  it('exports everything held about you through the share sheet', async () => {
    fake.rpcResults.export_my_data = { data: { profile: { full_name: 'Surendra' } } };
    const r = await render(<SettingsTab />);
    await press(r, 'Download my data');
    expect(mockExport).toHaveBeenCalledWith({ profile: { full_name: 'Surendra' } });
  });

  it('says so when the export fails', async () => {
    fake.rpcResults.export_my_data = { error: { message: 'Too many requests' } };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<SettingsTab />);
    await press(r, 'Download my data');
    expect(alert).toHaveBeenCalledWith("Couldn't export your data", 'Too many requests');
    expect(mockExport).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("signing out removes this phone's push registration and the cached locations of other people", async () => {
    await AsyncStorage.setItem('safecircle.membersCache.v1.me.c1', '{"members":[]}');
    await AsyncStorage.setItem('safecircle.travelMode.v1', 'walk'); // a plain preference stays
    const signOut = jest.spyOn(supabase.auth, 'signOut');
    const r = await render(<SettingsTab />);
    await press(r, 'Sign out');
    expect(fake.queriesOf('push_tokens', 'delete')[0].calls).toEqual([['eq', 'user_id', 'me']]);
    expect(await AsyncStorage.getItem('safecircle.membersCache.v1.me.c1')).toBeNull();
    expect(await AsyncStorage.getItem('safecircle.travelMode.v1')).toBe('walk');
    expect(signOut).toHaveBeenCalled();
    signOut.mockRestore();
  });

  it('links to the privacy and safety screens', async () => {
    const r = await render(<SettingsTab />);
    for (const [label, path] of [
      ['How your privacy works', '/privacy'],
      ['Ghost mode', '/ghost-mode'],
      ['Medical card', '/medical-card'],
      ['Delete my account', '/delete-account'],
    ] as const) {
      await press(r, label);
      expect(mockPush).toHaveBeenLastCalledWith(path);
    }
  });
});
