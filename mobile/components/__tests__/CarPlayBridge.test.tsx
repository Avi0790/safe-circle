import React from 'react';
import { act } from 'react-test-renderer';
import { fake } from '../../test-support/fakeSupabase';
import { flush, render, unmountAll } from '../../test-support/render';

// The bridge between the app and the CarPlay screen, with a fake native
// module standing in for the car.
const mockSession: { current: { user: { id: string } } | null } = { current: { user: { id: 'me' } } };
const mockCircle: { current: { id: string; name: string } | null } = { current: { id: 'c1', name: 'Family' } };
jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('@/modules/safecircle-carplay', () => ({ CarPlay: null }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ session: mockSession.current }) }));
jest.mock('@/contexts/CircleContext', () => ({ useCircles: () => ({ selectedCircle: mockCircle.current }) }));
jest.mock('@/contexts/CircleMembersContext', () => ({
  useCircleMembersContext: () => ({
    members: [
      { id: 'me', full_name: 'Me', location: null, share_until: null, status_emoji: null, status_text: null, status_expires_at: null },
      { id: 'sam', full_name: 'Sam', location: null, share_until: null, status_emoji: null, status_text: null, status_expires_at: null },
    ],
  }),
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: 35.84, longitude: -90.7 } }),
}));

import { CarPlayBridge } from '../CarPlayBridge';

function fakeCar() {
  const listeners: ((e: { id: string }) => unknown)[] = [];
  const remove = jest.fn();
  return {
    listeners,
    remove,
    isConnected: () => true,
    setState: jest.fn(),
    showMessage: jest.fn(),
    addListener: jest.fn((_event: string, cb: (e: { id: string }) => unknown) => {
      listeners.push(cb);
      return { remove };
    }),
  };
}

async function tap(car: ReturnType<typeof fakeCar>, id: string) {
  await act(async () => {
    await car.listeners[0]({ id });
  });
  await flush();
}

beforeEach(() => {
  fake.reset();
  mockSession.current = { user: { id: 'me' } };
  mockCircle.current = { id: 'c1', name: 'Family' };
});

afterEach(unmountAll);

describe('CarPlayBridge', () => {
  it('sends the circle to the car, without you in it', async () => {
    const car = fakeCar();
    const r = await render(<CarPlayBridge carplay={car as never} />);
    expect(r.toJSON()).toBeNull();
    const state = car.setState.mock.calls.at(-1)![0];
    expect(state).toMatchObject({ signedIn: true, circleName: 'Family' });
    expect(state.members.map((m: { title: string }) => m.title)).toEqual(['Sam']);
    expect(state.actions.map((a: { id: string }) => a.id)).toEqual(['on-my-way', 'check-in', 'sos']);
  });

  it('tells the car when you are signed out', async () => {
    mockSession.current = null;
    mockCircle.current = null;
    const car = fakeCar();
    await render(<CarPlayBridge carplay={car as never} />);
    expect(car.setState.mock.calls.at(-1)![0]).toMatchObject({ signedIn: false, circleName: null });
  });

  it('carries out a tap on the car screen and answers there', async () => {
    const car = fakeCar();
    await render(<CarPlayBridge carplay={car as never} />);
    await tap(car, 'on-my-way');
    expect(fake.rpcsOf('set_status')).toHaveLength(1);
    expect(car.showMessage).toHaveBeenLastCalledWith('Status set: On my way');
  });

  it('checks in to the circle selected now', async () => {
    const car = fakeCar();
    const r = await render(<CarPlayBridge carplay={car as never} />);
    mockCircle.current = { id: 'c2', name: 'Work' };
    await act(async () => r.update(<CarPlayBridge carplay={car as never} />));
    await tap(car, 'check-in');
    expect(fake.queriesOf('messages', 'insert')[0].payload).toMatchObject({ circle_id: 'c2' });
    expect(car.showMessage).toHaveBeenLastCalledWith('Checked in with your circle');
    expect(car.addListener).toHaveBeenCalledTimes(1); // not re-subscribed on every render
  });

  it('stops listening when it goes away', async () => {
    const car = fakeCar();
    await render(<CarPlayBridge carplay={car as never} />);
    await unmountAll();
    expect(car.remove).toHaveBeenCalled();
  });

  it('does nothing without the native module (Expo Go, Android)', async () => {
    const r = await render(<CarPlayBridge />);
    expect(r.toJSON()).toBeNull();
  });
});
