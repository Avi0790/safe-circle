import type { OrgMembership } from './org'

// The web twin of mobile/lib/orgPlan.ts (keep them in step). Work
// organizations are paid; family circles are free (migration ...000064). The
// database enforces the plan; this only words it. An ended plan stops new
// workers joining and new shifts starting, never SOS, clocking out, a shift
// already running, or anyone's family circles.

export interface PlanSummary {
  title: string
  detail: string
  tone: 'ok' | 'warn' | 'ended'
}

// Demo billing: seat choices the owner can "buy" (no money moves).
export const DEMO_SEAT_OPTIONS = [5, 10, 25]

const DAY_MS = 24 * 60 * 60 * 1000

function daysLeft(iso: string | null | undefined, now: number): number {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / DAY_MS))
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function seats(org: OrgMembership) {
  return org.seat_limit != null && org.seats_used != null
    ? `${org.seats_used} of ${org.seat_limit} worker seats used`
    : null
}

// Null for a server without plans yet, so nothing is shown rather than a
// wrong "Plan ended".
export function planSummary(org: OrgMembership, now = Date.now()): PlanSummary | null {
  const used = seats(org)
  switch (org.plan_state) {
    case 'trial':
      return {
        title: `Free trial · ${plural(daysLeft(org.trial_ends_at, now), 'day')} left`,
        detail: [used, 'When the trial ends, workers can’t start new shifts until you choose a plan.'].filter(Boolean).join('. '),
        tone: 'ok',
      }
    case 'active':
      return { title: 'Plan active', detail: used ?? 'Paid by the seat.', tone: 'ok' }
    case 'grace':
      return {
        title: 'Payment failed',
        detail: `Everything keeps working for ${plural(daysLeft(org.grace_ends_at, now), 'more day')}. Update the payment before then or new shifts stop.`,
        tone: 'warn',
      }
    case 'ended':
      return {
        title: 'Plan ended',
        detail: 'Workers can’t start new shifts and nobody new can join. Shifts already running, clocking out and SOS still work.',
        tone: 'ended',
      }
    default:
      return null
  }
}

export function seatsFull(org: OrgMembership): boolean {
  return org.seat_limit != null && org.seats_used != null && org.seats_used >= org.seat_limit
}
