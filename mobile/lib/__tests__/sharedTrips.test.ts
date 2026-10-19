jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

import {
  ETA_CHANGE_MS,
  ETA_HEARTBEAT_MS,
  ETA_MIN_INTERVAL_MS,
  isTripLive,
  liveTripsOfOthers,
  maxTripMinutes,
  myManualTrips,
  shouldSendEtaUpdate,
  stepTripMinutes,
  TRIP_PRESET_MINUTES,
  formatTripDuration,
  startSharedTrip,
  tripEtaText,
  tripHeadline,
  type SharedTrip,
} from '../sharedTrips';
import { supabase } from '../supabase';

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
    mode: 'drive', status: 'active', started_at: new Date(now - 60_000).toISOString(), updated_at: new Date(now - 30_000).toISOString(),
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

describe('walking trips', () => {
  it('words a walk differently from a drive', () => {
    const profiles = { full_name: 'Sam' };
    expect(tripHeadline({ mode: 'drive', destination: 'Walmart', profiles })).toBe('🚗 Sam is heading to Walmart');
    expect(tripHeadline({ mode: 'walk', destination: 'City Library', profiles })).toBe('🚶 Sam is walking to City Library');
    expect(tripHeadline({ mode: 'walk', destination: 'Park', profiles: null })).toBe('🚶 Someone is walking to Park');
  });

  it('sends the mode to the server, defaulting to a drive', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'trip-1', error: null });
    await startSharedTrip('c', 'Library', 1_000_000, 'walk');
    expect((supabase.rpc as jest.Mock).mock.calls[0][1]).toMatchObject({ p_destination: 'Library', p_mode: 'walk' });
    await startSharedTrip('c', 'Walmart', 1_000_000);
    expect((supabase.rpc as jest.Mock).mock.calls[1][1]).toMatchObject({ p_mode: 'drive' });
  });
});

describe('bus, train and flight trips', () => {
  const now = Date.parse('2026-10-19T15:00:00Z');
  const base = (over: Partial<SharedTrip>): SharedTrip => ({
    id: 't', user_id: 'u1', circle_id: 'c', destination: 'Denver', eta: new Date(now + 4 * 3_600_000).toISOString(),
    mode: 'flight', status: 'active', started_at: new Date(now - 3 * 3_600_000).toISOString(),
    updated_at: new Date(now - 3 * 3_600_000).toISOString(), profiles: { full_name: 'Sam' }, ...over,
  });

  it('stays up while nothing reports in (a plane is in airplane mode), because it goes by ETA', () => {
    expect(isTripLive(base({}), now)).toBe(true); // silent for 3 hours
    expect(isTripLive(base({ mode: 'drive' }), now)).toBe(false); // a drive that quiet is gone
  });

  it('fades out after the ETA plus the grace for each kind', () => {
    const late = (mode: 'bus' | 'train' | 'flight', minutes: number) =>
      isTripLive(base({ mode, eta: new Date(now - minutes * 60_000).toISOString() }), now);
    expect(late('bus', 29)).toBe(true);
    expect(late('bus', 31)).toBe(false);
    expect(late('train', 44)).toBe(true);
    expect(late('train', 46)).toBe(false);
    expect(late('flight', 119)).toBe(true);
    expect(late('flight', 121)).toBe(false);
  });

  it('never shows a finished trip, mine, or a stale one', () => {
    expect(isTripLive(base({ status: 'arrived' }), now)).toBe(false);
    expect(isTripLive(base({ status: 'stale' }), now)).toBe(false);
    const list = [base({ id: 'theirs' }), base({ id: 'mine', user_id: 'me' })];
    expect(liveTripsOfOthers(list, 'me', now).map((t) => t.id)).toEqual(['theirs']);
    expect(myManualTrips(list, 'me', now).map((t) => t.id)).toEqual(['mine']);
    expect(myManualTrips([base({ id: 'drive', user_id: 'me', mode: 'drive', updated_at: new Date(now).toISOString() })], 'me', now)).toEqual([]);
  });

  it('words each kind, and reads long trips in hours', () => {
    const p = { full_name: 'Sam' };
    expect(tripHeadline({ mode: 'bus', destination: 'Campus', profiles: p })).toBe('🚌 Sam is on the bus to Campus');
    expect(tripHeadline({ mode: 'train', destination: 'Chicago', profiles: p })).toBe('🚆 Sam is on the train to Chicago');
    expect(tripHeadline({ mode: 'flight', destination: 'Denver', profiles: p })).toBe('✈️ Sam is flying to Denver');
    expect(formatTripDuration(25)).toBe('25 min');
    expect(formatTripDuration(89)).toBe('89 min');
    expect(formatTripDuration(105)).toBe('1 h 45 min');
    expect(formatTripDuration(120)).toBe('2 h');
    expect(tripEtaText(new Date(now + 245 * 60_000).toISOString(), now, 'flight')).toMatch(/^landing in about 4 h 5 min \(/);
    expect(tripEtaText(new Date(now + 25 * 60_000).toISOString(), now, 'bus')).toMatch(/^arriving in about 25 min \(/);
  });

  it('says a late bus or flight was due, not "arriving now"', () => {
    const past = new Date(now - 10 * 60_000).toISOString();
    expect(tripEtaText(past, now, 'bus')).toMatch(/^was due at /);
    expect(tripEtaText(past, now, 'flight')).toMatch(/^was due at /);
    expect(tripEtaText(past, now, 'drive')).toBe('arriving now');
  });

  it('steps the arrival time within what the server accepts', () => {
    expect(stepTripMinutes('bus', 30, 1)).toBe(35);
    expect(stepTripMinutes('flight', 120, 1)).toBe(135);
    expect(stepTripMinutes('bus', 5, -1)).toBe(5);
    expect(stepTripMinutes('bus', maxTripMinutes('bus'), 1)).toBe(maxTripMinutes('bus'));
    expect(maxTripMinutes('bus')).toBeLessThan(24 * 60);
    expect(maxTripMinutes('flight')).toBeLessThan(48 * 60);
    expect(maxTripMinutes('flight')).toBeGreaterThan(24 * 60);
    for (const mode of ['bus', 'train', 'flight'] as const) {
      for (const m of TRIP_PRESET_MINUTES[mode]) expect(m).toBeLessThanOrEqual(maxTripMinutes(mode));
    }
  });
});
