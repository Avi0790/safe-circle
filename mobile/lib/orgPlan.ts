import type { OrgMembership } from '@/lib/orgInfo';

// Work organizations are paid; family circles are free (migration ...000064).
// The database enforces the plan; this only words it. An ended plan stops new
// workers joining and new shifts starting, never SOS, clocking out, a shift
// already running, or anyone's family circles.

export type PlanState = 'trial' | 'active' | 'grace' | 'ended';

export interface PlanSummary {
  title: string;
  detail: string;
  tone: 'ok' | 'warn' | 'ended';
}

// Demo billing: seat choices the owner can "buy" (no money moves).
export const DEMO_SEAT_OPTIONS = [5, 10, 25];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / DAY_MS));
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function seats(org: Pick<OrgMembership, 'seats_used' | 'seat_limit'>) {
  return org.seat_limit != null && org.seats_used != null
    ? `${org.seats_used} of ${org.seat_limit} worker seats used`
    : null;
}

// For owners and admins: what the plan is and what happens next.
export function planSummary(org: OrgMembership, now = Date.now()): PlanSummary {
  const used = seats(org);
  switch (org.plan_state) {
    case 'trial':
      return {
        title: `Free trial · ${plural(daysLeft(org.trial_ends_at, now), 'day')} left`,
        detail: [used, 'When the trial ends, workers can’t start new shifts until you choose a plan.'].filter(Boolean).join('. '),
        tone: 'ok',
      };
    case 'active':
      return { title: 'Plan active', detail: used ?? 'Paid by the seat.', tone: 'ok' };
    case 'grace':
      return {
        title: 'Payment failed',
        detail: `Everything keeps working for ${plural(daysLeft(org.grace_ends_at, now), 'more day')}. Update the payment before then or new shifts stop.`,
        tone: 'warn',
      };
    default:
      return {
        title: 'Plan ended',
        detail: 'Workers can’t start new shifts and nobody new can join. Shifts already running, clocking out and SOS still work.',
        tone: 'ended',
      };
  }
}

// For a worker whose organization's plan has ended.
export function workerPlanNotice(org: OrgMembership): string | null {
  return org.plan_state === 'ended'
    ? `${org.name}'s plan has ended, so you can't start a new shift. Ask your owner to renew it. SOS still works.`
    : null;
}

// Before a full organization's invite is shared, say so.
export function seatsFull(org: OrgMembership): boolean {
  return org.seat_limit != null && org.seats_used != null && org.seats_used >= org.seat_limit;
}
