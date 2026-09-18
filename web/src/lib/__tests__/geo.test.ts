import { formatDistanceMiles, haversineMeters, metersToMiles } from '../geo'

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0)
  })

  it('is symmetric', () => {
    const a = haversineMeters(37.7749, -122.4194, 34.0522, -118.2437)
    const b = haversineMeters(34.0522, -118.2437, 37.7749, -122.4194)
    expect(a).toBeCloseTo(b, 6)
  })

  it('roughly matches the known San Francisco -> Los Angeles distance', () => {
    // ~559 km in reality; a spherical-earth approximation lands close but
    // not exact, so allow a loose tolerance rather than pin a precise figure.
    const meters = haversineMeters(37.7749, -122.4194, 34.0522, -118.2437)
    expect(meters).toBeGreaterThan(550_000)
    expect(meters).toBeLessThan(570_000)
  })
})

describe('metersToMiles', () => {
  it('converts meters to miles', () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 5)
  })
})

describe('formatDistanceMiles', () => {
  it('shows "nearby" for very short distances', () => {
    expect(formatDistanceMiles(50)).toBe('nearby')
  })

  it('shows one decimal place under 10 miles', () => {
    expect(formatDistanceMiles(3 * 1609.344)).toBe('3.0 mi')
  })

  it('rounds to a whole number at 10 miles or more', () => {
    expect(formatDistanceMiles(12.6 * 1609.344)).toBe('13 mi')
  })
})
