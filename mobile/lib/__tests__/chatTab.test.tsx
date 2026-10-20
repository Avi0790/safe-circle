import React from 'react';
import { Linking, TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import { fake } from '../../test-support/fakeSupabase';
import { allText, flush, pressables, press, render, unmountAll } from '../../test-support/render';

// The Chat tab with its real messages hook; only the server, GPS, the
// signed-in user, circle, members provider and read-state are faked.
const mockMarkRead = jest.fn();
const mockFocus = { current: true };
const mockPermission = { current: 'granted' };

jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocus.current }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
const mockSession = { user: { id: 'me' } };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock('@/contexts/CircleContext', () => ({ useCircles: () => ({ selectedCircle: { id: 'c1', name: 'Family' } }) }));
jest.mock('@/contexts/CircleMembersContext', () => ({
  useCircleMembersContext: () => ({
    members: [
      { id: 'me', full_name: 'Me', avatar_url: null },
      { id: 'sam', full_name: 'Sam', avatar_url: null },
    ],
    isLoading: false,
    refresh: jest.fn(),
  }),
}));
jest.mock('@/contexts/ChatReadContext', () => ({ useChatRead: () => ({ markRead: mockMarkRead }) }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => ({ status: mockPermission.current }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: 35.84, longitude: -90.7 } }),
}));

import ChatTab from '../../app/(app)/(tabs)/chat';

const msg = (id: number, user: string, body: string, extra = {}) => ({
  id, circle_id: 'c1', user_id: user, body, latitude: null, longitude: null,
  created_at: new Date(Date.now() - 5 * 60_000).toISOString(), ...extra,
});

const input = (r: Awaited<ReturnType<typeof render>>) => r.root.findAll((n) => n.type === TextInput)[0];
async function type(r: Awaited<ReturnType<typeof render>>, value: string) {
  await act(async () => input(r).props.onChangeText(value));
}

beforeEach(() => {
  fake.reset();
  mockMarkRead.mockClear();
  mockFocus.current = true;
  mockPermission.current = 'granted';
  fake.tables.messages = [msg(1, 'sam', 'Where are you?'), msg(2, 'me', 'Almost home'), msg(3, 'sam', '📍 Checked in', { latitude: 35.8, longitude: -90.6 })];
});

afterEach(unmountAll);

describe('Chat tab', () => {
  it("shows the circle's messages, with names on other people's", async () => {
    const r = await render(<ChatTab />);
    const t = allText(r);
    expect(t).toContain('Family');
    expect(t).toContain('SamWhere are you?');
    expect(t).toContain('Almost home');
    expect(t).not.toContain('MeAlmost home'); // no name on your own bubbles
    expect(t).toContain('5m ago');
    const q = fake.queriesOf('messages', 'select')[0];
    expect(q.calls).toContainEqual(['eq', 'circle_id', 'c1']);
  });

  it('a check-in links to the map', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const r = await render(<ChatTab />);
    await press(r, 'View on map');
    expect(open).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=35.8,-90.6');
    open.mockRestore();
  });

  it('sends a trimmed message, clears the box, and shows it once when it comes back live', async () => {
    const r = await render(<ChatTab />);
    expect(pressables(r, 'Send')).toHaveLength(0); // nothing to send yet
    await type(r, '  On my way  ');
    await press(r, 'Send');
    expect(fake.queriesOf('messages', 'insert').map((q) => q.payload)).toEqual([{ circle_id: 'c1', body: 'On my way' }]);
    expect(input(r).props.value).toBe('');
    expect(allText(r)).not.toContain('On my way'); // not shown until the server confirms
    await act(async () => fake.emit('messages', { new: msg(4, 'me', 'On my way') }));
    expect(allText(r).split('On my way').length - 1).toBe(1);
  });

  it('keeps the draft and says why when sending fails', async () => {
    fake.errors['messages.insert'] = { message: 'You are offline' };
    const r = await render(<ChatTab />);
    await type(r, 'Hello');
    await press(r, 'Send');
    expect(allText(r)).toContain('You are offline');
    expect(input(r).props.value).toBe('Hello');
  });

  it('checks in with where you are', async () => {
    const r = await render(<ChatTab />);
    await press(r, 'Check in — share where you are with your circle');
    expect(fake.queriesOf('messages', 'insert')[0].payload).toEqual({
      circle_id: 'c1', body: '📍 Checked in', latitude: 35.84, longitude: -90.7,
    });
  });

  it('says so when location is off, and sends nothing', async () => {
    mockPermission.current = 'denied';
    const r = await render(<ChatTab />);
    await press(r, 'Check in — share where you are with your circle');
    expect(allText(r)).toContain('Location permission denied.');
    expect(fake.queriesOf('messages', 'insert')).toHaveLength(0);
  });

  it('marks the chat read while it is on screen, including for new messages', async () => {
    const r = await render(<ChatTab />);
    const before = mockMarkRead.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    await act(async () => fake.emit('messages', { new: msg(5, 'sam', 'Hi') }));
    await flush();
    expect(mockMarkRead.mock.calls.length).toBeGreaterThan(before);
    void r;
  });

  it('does not mark it read while another tab is in front', async () => {
    mockFocus.current = false;
    await render(<ChatTab />);
    await act(async () => fake.emit('messages', { new: msg(6, 'sam', 'Hi') }));
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('shows an empty state and a loading error', async () => {
    fake.tables.messages = [];
    let r = await render(<ChatTab />);
    expect(allText(r)).toContain('No messages yet — say hi to your circle.');
    fake.errors['messages.select'] = { message: 'Could not load messages' };
    r = await render(<ChatTab />);
    expect(allText(r)).toContain('Could not load messages');
  });
});
