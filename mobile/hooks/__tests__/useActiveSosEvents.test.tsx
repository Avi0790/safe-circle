import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// Behaves like supabase-js's realtime client where it matters here: the same
// name returns the same channel, and adding a listener after subscribe()
// throws. That is exactly what crashed the Work tab when it mounted this hook
// alongside the Map tab's copy.
const mockChannels = new Map<string, { subscribed: boolean; name: string }>();
const mockChannelNames: string[] = [];

jest.mock('@/lib/supabase', () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'is', 'order']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    return q;
  };
  return {
    supabase: {
      from: () => makeQuery(),
      rpc: async () => ({ data: [], error: null }),
      channel: (name: string) => {
        mockChannelNames.push(name);
        let ch = mockChannels.get(name);
        if (!ch) {
          ch = { subscribed: false, name };
          mockChannels.set(name, ch);
        }
        const handle = {
          on() {
            if (ch!.subscribed) {
              throw new Error('cannot add `postgres_changes` callbacks for realtime events after `subscribe()`.');
            }
            return handle;
          },
          subscribe() {
            ch!.subscribed = true;
            return handle;
          },
          topic: name,
        };
        return handle;
      },
      removeChannel: (handle: { topic: string }) => {
        mockChannels.delete(handle.topic);
      },
    },
  };
});

import { useActiveSosEvents } from '../useActiveSosEvents';

function Probe() {
  useActiveSosEvents();
  return null;
}

beforeEach(() => {
  mockChannels.clear();
  mockChannelNames.length = 0;
});

describe('useActiveSosEvents', () => {
  it('can be mounted by several screens at once without sharing a realtime channel', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <>
          <Probe />
          <Probe />
          <Probe />
        </>,
      );
    });
    expect(mockChannelNames).toHaveLength(3);
    expect(new Set(mockChannelNames).size).toBe(3);
    await act(async () => {
      renderer.unmount();
    });
    expect(mockChannels.size).toBe(0);
  });
});
