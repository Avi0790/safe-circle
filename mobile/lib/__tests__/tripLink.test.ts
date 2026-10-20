import { createTripLink, finishTripLink, tripShareMessage, updateTripLink } from '../tripLink';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { webUrl: 'https://safecircle.example' } } }));

const rpc = supabase.rpc as jest.Mock;
const eta = new Date(2026, 9, 19, 15, 41).getTime();

describe('tripShareMessage', () => {
  it('reads naturally for each way of travelling', () => {
    expect(tripShareMessage('Walmart', eta, 'drive')).toBe("I'm on my way to Walmart, arriving around 3:41 PM.");
    expect(tripShareMessage('the library', eta, 'walk')).toBe("I'm walking to the library, arriving around 3:41 PM.");
    expect(tripShareMessage('Denver', eta, 'flight')).toBe("I'm flying to Denver, landing around 3:41 PM.");
  });

  it('adds the live link when there is one', () => {
    expect(tripShareMessage('Walmart', eta, 'drive', 'https://x/track/t')).toBe(
      "I'm on my way to Walmart, arriving around 3:41 PM. Follow along live until I get there: https://x/track/t",
    );
  });
});

describe('trip links', () => {
  beforeEach(() => rpc.mockReset());

  it('creates one and builds its web address from the one-time token', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'link-1', token: 'abc' }], error: null });
    expect(await createTripLink('Walmart', eta, 'drive')).toEqual({ ok: true, id: 'link-1', url: 'https://safecircle.example/track/abc' });
    expect(rpc).toHaveBeenCalledWith('create_trip_share_link', {
      p_destination: 'Walmart', p_eta: new Date(eta).toISOString(), p_mode: 'drive',
    });
  });

  it("passes on the server's refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'You already have 5 active links. Revoke one first.' } });
    expect(await createTripLink('Walmart', eta, 'drive')).toEqual({ ok: false, error: 'You already have 5 active links. Revoke one first.' });
  });

  it('updates and finishes quietly, even if the network fails', async () => {
    rpc.mockRejectedValue(new Error('offline'));
    await expect(updateTripLink('link-1', eta)).resolves.toBeUndefined();
    await expect(finishTripLink('link-1', true)).resolves.toBeUndefined();
    expect(rpc.mock.calls).toEqual([
      ['update_trip_share_link', { p_id: 'link-1', p_eta: new Date(eta).toISOString() }],
      ['finish_trip_share_link', { p_id: 'link-1', p_arrived: true }],
    ]);
  });
});
