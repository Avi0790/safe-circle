import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// Same guard as useActiveSosEvents: several screens mount this hook, and
// supabase-js returns the SAME channel for the same name.
const mockChannels = new Map<string, { subscribed: boolean }>();
const mockNames: string[] = [];

jest.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) q[m] = () => q;
  q.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return {
    supabase: {
      from: () => q,
      channel: (name: string) => {
        mockNames.push(name);
        const ch = mockChannels.get(name) ?? { subscribed: false };
        mockChannels.set(name, ch);
        const handle = {
          topic: name,
          on() {
            if (ch.subscribed) throw new Error('cannot add `postgres_changes` callbacks after `subscribe()`.');
            return handle;
          },
          subscribe() {
            ch.subscribed = true;
            return handle;
          },
        };
        return handle;
      },
      removeChannel: (h: { topic: string }) => void mockChannels.delete(h.topic),
    },
  };
});

import { useActiveTrips } from '../useActiveTrips';

function Probe() {
  useActiveTrips();
  return null;
}

it('can be mounted by several screens at once without sharing a realtime channel', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<><Probe /><Probe /></>);
  });
  expect(new Set(mockNames).size).toBe(2);
  await act(async () => r.unmount());
  expect(mockChannels.size).toBe(0);
});
