import { isTripLive, liveTripsOfOthers, tripEtaText, tripHeadline, TRIP_LIVE_WINDOW_MS, type SharedTrip } from '../sharedTrips'

const now = Date.parse('2026-10-12T15:00:00Z')

const trip = (over: Partial<SharedTrip>): SharedTrip => ({
  id: 't',
  user_id: 'u1',
  circle_id: 'c',
  destination: 'Mall',
  eta: new Date(now + 600_000).toISOString(),
  mode: 'drive',
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

describe('tripHeadline', () => {
  it('says driving or walking', () => {
    expect(tripHeadline(trip({}))).toBe('🚗 Sam is heading to Mall')
    expect(tripHeadline(trip({ mode: 'walk', destination: 'City Library' }))).toBe('🚶 Sam is walking to City Library')
    expect(tripHeadline(trip({ profiles: null }))).toBe('🚗 Someone is heading to Mall')
  })
})

describe('bus, train and flight trips', () => {
  const silent = new Date(now - 3 * 3_600_000).toISOString()

  it('a flight stays up while silent for hours, because it goes by its ETA', () => {
    expect(isTripLive(trip({ mode: 'flight', updated_at: silent, eta: new Date(now + 3_600_000).toISOString() }), now)).toBe(true)
    expect(isTripLive(trip({ mode: 'drive', updated_at: silent }), now)).toBe(false)
  })

  it('fades out after the ETA plus each kind\'s grace', () => {
    const late = (mode: 'bus' | 'train' | 'flight', minutes: number) =>
      isTripLive(trip({ mode, updated_at: silent, eta: new Date(now - minutes * 60_000).toISOString() }), now)
    expect([late('bus', 29), late('bus', 31)]).toEqual([true, false])
    expect([late('train', 44), late('train', 46)]).toEqual([true, false])
    expect([late('flight', 119), late('flight', 121)]).toEqual([true, false])
  })

  it('words each kind and reads long trips in hours', () => {
    expect(tripHeadline(trip({ mode: 'bus', destination: 'Campus' }))).toBe('🚌 Sam is on the bus to Campus')
    expect(tripHeadline(trip({ mode: 'train', destination: 'Chicago' }))).toBe('🚆 Sam is on the train to Chicago')
    expect(tripHeadline(trip({ mode: 'flight', destination: 'Denver' }))).toBe('✈️ Sam is flying to Denver')
    expect(tripEtaText(new Date(now + 245 * 60_000).toISOString(), now, 'flight')).toMatch(/^landing in about 4 h 5 min \(/)
    expect(tripEtaText(new Date(now - 60_000).toISOString(), now, 'bus')).toMatch(/^was due at /)
    expect(tripEtaText(new Date(now - 60_000).toISOString(), now, 'drive')).toBe('arriving now')
  })
})
