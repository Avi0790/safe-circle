import { liveTripsOfOthers, tripEtaText, TRIP_LIVE_WINDOW_MS, type SharedTrip } from '../sharedTrips'

const now = Date.parse('2026-10-12T15:00:00Z')

const trip = (over: Partial<SharedTrip>): SharedTrip => ({
  id: 't',
  user_id: 'u1',
  circle_id: 'c',
  destination: 'Mall',
  eta: new Date(now + 600_000).toISOString(),
  status: 'active',
  started_at: new Date(now - 60_000).toISOString(),
  updated_at: new Date(now - 30_000).toISOString(),
  profiles: { full_name: 'Sam' },
  ...over,
})

describe('tripEtaText', () => {
  it('counts down in minutes and shows the clock time', () => {
    expect(tripEtaText(new Date(now + 12 * 60_000).toISOString(), now)).toMatch(/^arriving in about 12 min \(/)
  })

  it('rounds up, so it never says 0 minutes while still on the way', () => {
    expect(tripEtaText(new Date(now + 20_000).toISOString(), now)).toMatch(/^arriving in about 1 min/)
  })

  it('says arriving now once the ETA has passed', () => {
    expect(tripEtaText(new Date(now - 60_000).toISOString(), now)).toBe('arriving now')
  })
})

describe('liveTripsOfOthers', () => {
  it("keeps other people's live trips and drops mine, finished ones and ones gone quiet", () => {
    const trips = [
      trip({ id: 'live' }),
      trip({ id: 'mine', user_id: 'me' }),
      trip({ id: 'arrived', status: 'arrived' }),
      trip({ id: 'stale', status: 'stale' }),
      trip({ id: 'quiet', updated_at: new Date(now - TRIP_LIVE_WINDOW_MS - 1_000).toISOString() }),
    ]
    expect(liveTripsOfOthers(trips, 'me', now).map((t) => t.id)).toEqual(['live'])
  })

  it('shows a trip that has been quiet for just under the window', () => {
    const t = trip({ updated_at: new Date(now - TRIP_LIVE_WINDOW_MS + 1_000).toISOString() })
    expect(liveTripsOfOthers([t], 'me', now)).toHaveLength(1)
  })
})
