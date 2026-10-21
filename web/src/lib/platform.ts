// What platform_stats() returns (migration ...000066): counts and sums only,
// never a name, location or id. Read only by the platform owner's dashboard.
export interface PlatformStats {
  generated_at: string
  seat_price_cents: number
  accounts: {
    total: number
    new_7d: number
    active_24h: number
    signups_14d: { day: string; count: number }[] | null
  }
  circles: { total: number; avg_size: number }
  work: {
    organizations: number
    trial: number
    active: number
    grace: number
    ended: number
    paid_seats: number
    workers: number
    on_shift: number
    monthly_revenue_cents: number
  }
  safety: { sos_7d: number; sos_7d_acknowledged: number; sos_open: number }
  health: { push_failures_24h: number | null }
}

// 1,284 · 12.9K · 4.2M
export function compact(n: number): string {
  if (Math.abs(n) < 10_000) return n.toLocaleString('en-US')
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

// $20 · $1,240 · $12.5K, whole dollars unless there are cents
export function money(cents: number): string {
  const dollars = cents / 100
  if (Math.abs(dollars) >= 10_000) {
    return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(dollars)
  }
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${compact(n)} ${n === 1 ? one : many}`
}

// "2 of 3 acknowledged" — how often an SOS got an answer this week.
export function sosAnswered(s: PlatformStats['safety']): string {
  if (s.sos_7d === 0) return 'No SOS alerts this week'
  return `${s.sos_7d_acknowledged} of ${s.sos_7d} acknowledged`
}

// The 14 days of sign-ups as bars: each day's share of the busiest day, so
// the tallest bar fills the plot. An all-zero fortnight draws no bars.
export function signupBars(stats: PlatformStats): { day: string; label: string; count: number; share: number }[] {
  const days = stats.accounts.signups_14d ?? []
  const max = Math.max(0, ...days.map((d) => d.count))
  return days.map((d) => {
    const date = new Date(`${d.day}T12:00:00`)
    return {
      day: d.day,
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: d.count,
      share: max === 0 ? 0 : d.count / max,
    }
  })
}
