jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

import {
  ETA_CHANGE_MS,
  ETA_HEARTBEAT_MS,
  ETA_MIN_INTERVAL_MS,
  liveTripsOfOthers,
  shouldSendEtaUpdate,
  tripEtaText,
  type SharedTrip,
} from '../sharedTrips';

describe('shouldSendEtaUpdate', () => {
  const t0 = 1_000_000;
  const eta = t0 + 10 * 60_000;

  it('never sends before the first report (the start call carried it)', () => {
    expect(shouldSendEtaUpdate(null, null, t0, eta)).toBe(false);
  });

  it('waits at least a minute between updates, however much the ETA moved', () => {
    expect(shouldSendEtaUpdate(t0, eta, t0 + ETA_MIN_INTERVAL_MS - 1, eta + 10 * 60_000)).toBe(false);
  });

  it('sends once the ETA has moved by a minute', () => {
    expect(shouldSendEtaUpdate(t0, eta, t0 + ETA_MIN_INTERVAL_MS, eta + ETA_CHANGE_MS)).toBe(true);
    expect(shouldSendEtaUpdate(t0, eta, t0 + ETA_MIN_INTERVAL_MS, eta + ETA_CHANGE_MS - 1)).toBe(false);
  });

  it('sends a heartbeat when the ETA is steady, so the trip does not look dead', () => {
    expect(shouldSendEtaUpdate(t0, eta, t0 + ETA_HEARTBEAT_MS - 1, eta)).toBe(false);
    expect(shouldSendEtaUpdate(t0, eta, t0 + ETA_HEARTBEAT_MS, eta)).toBe(true);
  });
});

describe('tripEtaText', () => {
  const now = Date.parse('2026-10-12T15:00:00Z');
  it('counts down in minutes and shows the clock time', () => {
    const text = tripEtaText(new Date(now + 12 * 60_000).toISOString(), now);
    expect(text).toMatch(/^arriving in about 12 min \(/);
  });
  it('says arriving now once the ETA has passed', () => {
    expect(tripEtaText(new Date(now - 60_000).toISOString(), now)).toBe('arriving now');
  });
});

describe('liveTripsOfOthers', () => {
  const now = Date.parse('2026-10-12T15:00:00Z');
  const trip = (over: Partial<SharedTrip>): SharedTrip => ({
    id: 't', user_id: 'u1', circle_id: 'c', destination: 'Mall', eta: new Date(now + 600_000).toISOString(),
    status: 'active', started_at: new Date(now - 60_000).toISOString(), updated_at: new Date(now - 30_000).toISOString(),
    profiles: { full_name: 'Sam' }, ...over,
  });

  it("keeps other people's live trips and drops mine, finished ones and ones gone quiet", () => {
    const trips = [
      trip({ id: 'live' }),
      trip({ id: 'mine', user_id: 'me' }),
      trip({ id: 'done', status: 'arrived' }),
      trip({ id: 'quiet', updated_at: new Date(now - 11 * 60_000).toISOString() }),
    ];
    expect(liveTripsOfOthers(trips, 'me', now).map((t) => t.id)).toEqual(['live']);
  });
});
