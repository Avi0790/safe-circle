import { compact, money, plural, signupBars, sosAnswered, type PlatformStats } from '../platform'

const stats = (signups: number[]): PlatformStats => ({
  generated_at: '2026-10-21T18:00:00Z',
  seat_price_cents: 400,
  accounts: {
    total: 12,
    new_7d: 3,
    active_24h: 4,
    signups_14d: signups.map((count, i) => ({ day: `2026-10-${String(8 + i).padStart(2, '0')}`, count })),
  },
  circles: { total: 3, avg_size: 2.7 },
  work: { organizations: 2, trial: 1, active: 1, grace: 0, ended: 0, paid_seats: 5, workers: 2, on_shift: 1, monthly_revenue_cents: 2000 },
  safety: { sos_7d: 3, sos_7d_acknowledged: 2, sos_open: 1 },
  health: { push_failures_24h: 0 },
})

describe('platform dashboard formatting', () => {
  it('compacts big numbers and keeps small ones exact', () => {
    expect(compact(7)).toBe('7')
    expect(compact(1284)).toBe('1,284')
    expect(compact(12_900)).toBe('12.9K')
    expect(compact(4_200_000)).toBe('4.2M')
  })

  it('shows money in whole dollars unless there are cents', () => {
    expect(money(2000)).toBe('$20')
    expect(money(400)).toBe('$4')
    expect(money(124_050)).toBe('$1,240.50')
    expect(money(1_250_000)).toBe('$12.5K')
  })

  it('pluralises', () => {
    expect(plural(1, 'paid seat')).toBe('1 paid seat')
    expect(plural(5, 'paid seat')).toBe('5 paid seats')
  })

  it('says how many SOS alerts got an answer', () => {
    expect(sosAnswered(stats([]).safety)).toBe('2 of 3 acknowledged')
    expect(sosAnswered({ sos_7d: 0, sos_7d_acknowledged: 0, sos_open: 0 })).toBe('No SOS alerts this week')
  })

  it('scales sign-up bars to the busiest day, and draws none for an empty fortnight', () => {
    const bars = signupBars(stats([0, 1, 4, 2]))
    expect(bars.map((b) => b.share)).toEqual([0, 0.25, 1, 0.5])
    expect(bars[2]).toMatchObject({ day: '2026-10-10', label: 'Oct 10', count: 4 })
    expect(signupBars(stats([0, 0])).every((b) => b.share === 0)).toBe(true)
    expect(signupBars({ ...stats([]), accounts: { ...stats([]).accounts, signups_14d: null } })).toEqual([])
  })
})
