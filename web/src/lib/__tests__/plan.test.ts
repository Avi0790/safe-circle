import type { OrgMembership } from '../org'
import { planSummary, seatsFull } from '../plan'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const days = (d: number) => new Date(NOW + d * 86_400_000).toISOString()

const org = (over: Partial<OrgMembership> = {}): OrgMembership => ({
  org_id: 'o1', name: 'Acme Roofing', type: 'field_crew', role: 'owner', status: 'active',
  consented_at: null, on_shift: false, shift_started_at: null,
  plan_state: 'trial', trial_ends_at: days(9.5), grace_ends_at: null, seat_limit: 10, seats_used: 2,
  ...over,
})

describe('planSummary (web)', () => {
  it('words each state the same as the phone app', () => {
    expect(planSummary(org(), NOW)).toMatchObject({ title: 'Free trial · 10 days left', tone: 'ok' })
    expect(planSummary(org(), NOW)!.detail).toContain('2 of 10 worker seats used')
    expect(planSummary(org({ plan_state: 'active', seat_limit: 25, seats_used: 7 }), NOW)).toEqual({
      title: 'Plan active', detail: '7 of 25 worker seats used', tone: 'ok',
    })
    expect(planSummary(org({ plan_state: 'grace', grace_ends_at: days(7) }), NOW)).toMatchObject({ title: 'Payment failed', tone: 'warn' })
    expect(planSummary(org({ plan_state: 'ended' }), NOW)).toMatchObject({ title: 'Plan ended', tone: 'ended' })
  })

  it('shows nothing for a server without plans, rather than a wrong "Plan ended"', () => {
    expect(planSummary(org({ plan_state: undefined }), NOW)).toBeNull()
  })

  it('knows when every seat is taken', () => {
    expect(seatsFull(org({ seat_limit: 5, seats_used: 5 }))).toBe(true)
    expect(seatsFull(org({ seat_limit: 5, seats_used: 4 }))).toBe(false)
    expect(seatsFull(org({ seat_limit: null, seats_used: null }))).toBe(false)
  })
})
