import type { OrgMembership } from '@/lib/orgInfo';
import { planSummary, seatsFull, workerPlanNotice } from '@/lib/orgPlan';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const days = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const org = (over: Partial<OrgMembership> = {}): OrgMembership => ({
  org_id: 'o1', name: 'Acme Roofing', type: 'field_crew', role: 'owner', status: 'active',
  consented_at: null, on_shift: false, shift_started_at: null, needs_reconsent: false,
  checkin_minutes: null, next_checkin_due: null,
  plan_state: 'trial', trial_ends_at: days(9.5), grace_ends_at: null, seat_limit: 10, seats_used: 2,
  ...over,
});

describe('planSummary', () => {
  it('a trial counts down and says what happens at the end', () => {
    const s = planSummary(org(), NOW);
    expect(s.title).toBe('Free trial · 10 days left');
    expect(s.detail).toBe('2 of 10 worker seats used. When the trial ends, workers can’t start new shifts until you choose a plan.');
    expect(s.tone).toBe('ok');
    expect(planSummary(org({ trial_ends_at: days(0.5) }), NOW).title).toBe('Free trial · 1 day left');
  });

  it('an active plan shows its seats', () => {
    expect(planSummary(org({ plan_state: 'active', seat_limit: 25, seats_used: 7 }), NOW)).toEqual({
      title: 'Plan active', detail: '7 of 25 worker seats used', tone: 'ok',
    });
  });

  it('a failed payment warns with the days of grace left', () => {
    const s = planSummary(org({ plan_state: 'grace', grace_ends_at: days(7) }), NOW);
    expect(s).toMatchObject({ title: 'Payment failed', tone: 'warn' });
    expect(s.detail).toContain('7 more days');
  });

  it('an ended plan says what stops and what never does', () => {
    const s = planSummary(org({ plan_state: 'ended', seat_limit: 0 }), NOW);
    expect(s).toMatchObject({ title: 'Plan ended', tone: 'ended' });
    expect(s.detail).toContain('SOS still work');
  });
});

describe('worker notice and seats', () => {
  it('a worker hears about an ended plan only', () => {
    expect(workerPlanNotice(org({ role: 'worker', plan_state: 'trial' }))).toBeNull();
    expect(workerPlanNotice(org({ role: 'worker', plan_state: 'grace' }))).toBeNull();
    expect(workerPlanNotice(org({ role: 'worker', plan_state: 'ended' }))).toBe(
      "Acme Roofing's plan has ended, so you can't start a new shift. Ask your owner to renew it. SOS still works.",
    );
  });

  it('knows when every seat is taken (and that a worker sees no counts)', () => {
    expect(seatsFull(org({ seat_limit: 5, seats_used: 5 }))).toBe(true);
    expect(seatsFull(org({ seat_limit: 5, seats_used: 4 }))).toBe(false);
    expect(seatsFull(org({ seat_limit: null, seats_used: null }))).toBe(false);
  });
});
