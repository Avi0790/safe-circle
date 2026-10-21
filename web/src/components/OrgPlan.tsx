import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'
import { DEMO_SEAT_OPTIONS, planSummary, seatsFull } from '../lib/plan'

// The organization's plan for owners and admins (migration ...000064). Only
// the owner can change it, and for now that's demo billing: no money moves.
// Real billing would run on this page too (a payment provider's checkout,
// then its webhook updating the plan), keeping payments out of the phone app.
export function OrgPlan({ org, onChanged }: { org: OrgMembership; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const summary = planSummary(org)
  const owner = org.role === 'owner'

  async function bill(action: string, seats?: number) {
    if (
      (action === 'cancel' || action === 'end_trial') &&
      !window.confirm(
        `${action === 'cancel' ? `Cancel ${org.name}'s plan?` : 'End the trial now?'}\n\nWorkers won't be able to start new shifts and nobody new can join. Shifts already running, clocking out and SOS keep working.`,
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('org_demo_billing', {
      p_org: org.org_id,
      p_action: action,
      p_seats: seats ?? null,
    })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else await onChanged()
  }

  if (!summary) return <div className="org-page"><p className="org-note">Plans aren&apos;t set up on this server yet.</p></div>

  return (
    <div className="org-page">
      <div className={`plan-card plan-${summary.tone}`}>
        <h3>{summary.title}</h3>
        <p>{summary.detail}</p>
      </div>
      {seatsFull(org) && org.plan_state !== 'ended' && (
        <p className="org-warn">Every seat is taken. Add seats before inviting more workers, or they won’t be able to join.</p>
      )}

      <div className="org-block">
        <h3>How pricing works</h3>
        <p className="org-note">
          Family circles are always free. Work organizations get a 14-day trial for up to 10 workers, then pay per
          worker seat; owners, admins and managers are free. If a plan ends, SOS, clocking out and shifts already
          running keep working. Money never decides whether someone is safe.
        </p>
      </div>

      {owner ? (
        <div className="org-block">
          <h3>Change the plan (demo)</h3>
          <p className="org-note">Demo billing: no real money moves.</p>
          <div className="org-inline">
            {DEMO_SEAT_OPTIONS.map((n) => (
              <button
                key={n}
                className={org.plan_state === 'active' && org.seat_limit === n ? 'plan-current' : undefined}
                onClick={() => bill('activate', n)}
                disabled={busy}
              >
                Pay for {n} seats
              </button>
            ))}
            {org.plan_state === 'trial' && (
              <button onClick={() => bill('end_trial')} disabled={busy}>
                End the trial now
              </button>
            )}
            {org.plan_state === 'active' && (
              <button onClick={() => bill('payment_failed')} disabled={busy}>
                Simulate a failed payment
              </button>
            )}
            {(org.plan_state === 'active' || org.plan_state === 'grace') && (
              <button onClick={() => bill('cancel')} disabled={busy}>
                Cancel plan
              </button>
            )}
          </div>
          {error && <p className="org-error">{error}</p>}
        </div>
      ) : (
        <p className="org-note">Only the owner can change the plan.</p>
      )}
    </div>
  )
}
