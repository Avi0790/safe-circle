import { hourBars, needsAttention, normalizeWeeks, summarize } from '../safety'

const raw = [
  { week_start: '2026-10-12', hours: '32.5', shifts: 5, workers: 2, sos: 0, sos_answered: 0, median_response_minutes: null, missed_checkins: 0, quiet_phones: 0, incidents: 1, incidents_resolved: 1, location_views: 3 },
  { week_start: '2026-10-19', hours: '41', shifts: 6, workers: 3, sos: 2, sos_answered: 2, median_response_minutes: '3.5', missed_checkins: 1, quiet_phones: 0, incidents: 0, incidents_resolved: 0, location_views: 7 },
  { week_start: '2026-10-26', hours: '12.0', shifts: 2, workers: 2, sos: 1, sos_answered: 0, median_response_minutes: null, missed_checkins: 0, quiet_phones: 2, incidents: 2, incidents_resolved: 0, location_views: 1 },
]

describe('safety report', () => {
  const weeks = normalizeWeeks(raw)

  it('reads Postgres numerics (strings) as numbers', () => {
    expect(weeks[0].hours).toBe(32.5)
    expect(weeks[1].median_response_minutes).toBe(3.5)
    expect(weeks[2].median_response_minutes).toBeNull()
  })

  it('totals the weeks, and counts open incidents', () => {
    expect(summarize(weeks)).toEqual({
      hours: 85.5, shifts: 13, sos: 3, sosAnswered: 2, missedCheckins: 1, quietPhones: 2,
      incidents: 3, incidentsOpen: 2, locationViews: 11, slowestMedianMinutes: 3.5,
    })
  })

  it('has no answer time when no SOS was answered', () => {
    expect(summarize([weeks[0]]).slowestMedianMinutes).toBeNull()
  })

  it('scales bars to the busiest week', () => {
    const bars = hourBars(weeks, 'en-US')
    expect(bars.map((b) => Math.round(b.share * 100))).toEqual([79, 100, 29])
    expect(bars[1].label).toBe('Oct 19')
    expect(hourBars([]).length).toBe(0)
  })

  it('flags weeks with something unanswered or open', () => {
    expect(weeks.map(needsAttention)).toEqual([false, true, true])
  })
})
