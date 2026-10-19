import React from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { TripBanner } from '../TripBanner';
import type { SharedTrip } from '@/lib/sharedTrips';

function text(node: any): string {
  if (typeof node === 'string') return node;
  return (node?.children ?? []).map(text).join('');
}

const trip = (over: Partial<SharedTrip>): SharedTrip => ({
  id: 't', user_id: 'u1', circle_id: 'c', destination: 'Walmart', eta: new Date(Date.now() + 12 * 60_000).toISOString(),
  mode: 'drive', status: 'active', started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  profiles: { full_name: 'Sam' }, ...over,
});

describe('TripBanner', () => {
  it("shows who is heading where and when, for other people's live trips only", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<TripBanner trips={[trip({}), trip({ id: 'mine', user_id: 'me', destination: 'Secret' })]} />);
    });
    const out = text(tree.toJSON());
    expect(out).toContain('Sam is heading to Walmart');
    expect(out).toMatch(/arriving in about 1[12] min/);
    expect(out).not.toContain('Secret');
    await act(async () => tree.unmount());
  });

  it('says walking, with a walker, for a walk', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<TripBanner trips={[trip({ mode: 'walk', destination: 'City Library' })]} />);
    });
    const out = text(tree.toJSON());
    expect(out).toContain('🚶 Sam is walking to City Library');
    expect(out).not.toContain('heading to');
    await act(async () => tree.unmount());
  });

  it('keeps showing a flight that has not reported in for hours, until it lands', async () => {
    const hoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <TripBanner
          trips={[
            trip({ mode: 'flight', destination: 'Denver', updated_at: hoursAgo, eta: new Date(Date.now() + 2 * 3_600_000 + 5 * 60_000).toISOString() }),
            trip({ id: 'drive', mode: 'drive', destination: 'Walmart', updated_at: hoursAgo }),
          ]}
        />,
      );
    });
    const out = text(tree.toJSON());
    expect(out).toContain('✈️ Sam is flying to Denver');
    expect(out).toMatch(/landing in about 2 h (4|5) min/);
    expect(out).not.toContain('Walmart'); // a drive that quiet is gone
    await act(async () => tree.unmount());
  });

  it('shows the bus and the train', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<TripBanner trips={[trip({ mode: 'bus', destination: 'Campus' }), trip({ id: 'tr', mode: 'train', destination: 'Chicago' })]} />);
    });
    const out = text(tree.toJSON());
    expect(out).toContain('🚌 Sam is on the bus to Campus');
    expect(out).toContain('🚆 Sam is on the train to Chicago');
    await act(async () => tree.unmount());
  });

  it('renders nothing when nobody is driving', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<TripBanner trips={[trip({ status: 'arrived' })]} />);
    });
    expect(tree.toJSON()).toBeNull();
    await act(async () => tree.unmount());
  });
});
