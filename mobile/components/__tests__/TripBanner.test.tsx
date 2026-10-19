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

  it('renders nothing when nobody is driving', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<TripBanner trips={[trip({ status: 'arrived' })]} />);
    });
    expect(tree.toJSON()).toBeNull();
    await act(async () => tree.unmount());
  });
});
