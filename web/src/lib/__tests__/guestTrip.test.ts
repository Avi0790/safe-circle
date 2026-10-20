import { guestTripSummary, type GuestTripFields } from '../guestTrip'

const now = Date.parse('2026-10-19T15:00:00Z')
const row = (over: Partial<GuestTripFields> = {}): GuestTripFields => ({
  first_name: 'Alex',
  trip_destination: 'Walmart Supercenter',
  trip_eta: new Date(now + 12 * 60_000).toISOString(),
  trip_mode: 'drive',
  trip_status: 'active',
  ...over,
})

describe('guestTripSummary', () => {
  it('a plain guest link has no trip', () => {
    expect(guestTripSummary(row({ trip_destination: null, trip_status: null }), now)).toBeNull()
  })

  it('on the way: who, where to, and when', () => {
    const s = guestTripSummary(row(), now)!
    expect(s.title).toBe('🚗 Alex is heading to Walmart Supercenter')
    expect(s.detail).toMatch(/^arriving in about 12 min \(/)
    expect(s.arrived).toBe(false)
  })

  it('uses the way they travel', () => {
    expect(guestTripSummary(row({ trip_mode: 'walk', trip_destination: 'the library' }), now)!.title).toBe('🚶 Alex is walking to the library')
    expect(guestTripSummary(row({ trip_mode: 'flight', trip_destination: 'Denver' }), now)!.detail).toMatch(/^landing in about/)
    expect(guestTripSummary(row({ trip_mode: 'hovercraft' }), now)!.title).toMatch(/^🚗/) // unknown → a drive
  })

  it('arrived: says so, and explains why the map is gone', () => {
    const s = guestTripSummary(row({ trip_status: 'arrived' }), now)!
    expect(s).toEqual({
      title: '✅ Alex arrived at Walmart Supercenter',
      detail: 'They got there, so this link no longer shows where they are.',
      arrived: true,
    })
  })
})
