import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'
import { parseSeats, priceLine } from '../lib/billing'
import { DEMO_SEAT_OPTIONS, planSummary, seatsFull } from '../lib/plan'

// Stripe checkout is offered when the web app is built with
// VITE_STRIPE_BILLING=on and the server has its keys (backend/README.md).
const STRIPE_ON = import.meta.env.VITE_STRIPE_BILLING === 'on'

// The Edge Function's own error message, when it sent one.
async function functionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context
  try {
    const body = context ? await context.json() : null
    if (body?.error) return String(body.error)
  } catch {
    // not JSON
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}

// The organization's plan for owners and admins (migration ...000064). Only
// the owner can change it: by card through Stripe when that's switched on
// (migration ...000069; Stripe's own pages take the card, and only its signed
// webhook changes the plan), or with the demo buttons, where no money moves.
// Payments live here on the web, never in the phone app.
export function OrgPlan({
  org,
  onChanged,
  notice,
}: {
  org: OrgMembership
  onChanged: () => Promise<void> | void
  notice?: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [onStripe, setOnStripe] = useState(false)
  const [seatsInput, setSeatsInput] = useState(String(Math.max(org.seats_used ?? 0, 5)))

  useEffect(() => {
    let cancelled = false
    supabase.rpc('org_on_stripe', { p_org: org.org_id }).then(({ data }) => {
      if (!cancelled) setOnStripe(data === true)
    })
    return () => {
      cancelled = true
    }
  }, [org.org_id, org.plan_state, org.seat_limit])

  async function stripe(action: 'checkout' | 'portal') {
    const seats = parseSeats(seatsInput)
    if (action === 'checkout' && seats == null) {
      setError('Choose between 1 and 500 seats.')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error: fnError } = await supabase.functions.invoke('billing', {
      body: { action, org_id: org.org_id, seats },
    })
    if (fnError || !data?.url) {
      setBusy(false)
      setError(fnError ? await functionError(fnError) : 'Stripe didn’t return a page to open.')
      return
    }
    window.location.assign(data.url)
  }
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

  const seats = parseSeats(seatsInput)

  return (
    <div className="org-page">
      {notice && <p className="org-note plan-notice">{notice}</p>}
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

      {owner && STRIPE_ON && (
        <div className="org-block">
          <h3>Pay by card</h3>
          {onStripe ? (
            <>
              <p className="org-note">
                This organization pays through Stripe. Change seats, update the card or cancel on Stripe&apos;s billing
                page.
              </p>
              <button onClick={() => stripe('portal')} disabled={busy}>
                Manage billing
              </button>
            </>
          ) : (
            <>
              <p className="org-note">
                You&apos;ll enter the card on Stripe&apos;s page; Safe Circle never sees it. Test mode: use card 4242 4242
                4242 4242, any future date and any CVC.
              </p>
              <div className="org-inline">
                <label className="org-note" htmlFor="seats">
                  Worker seats
                </label>
                <input id="seats" inputMode="numeric" value={seatsInput} onChange={(e) => setSeatsInput(e.target.value)} />
                <button onClick={() => stripe('checkout')} disabled={busy || seats == null}>
                  {seats == null ? 'Pay by card' : `Pay by card · ${priceLine(seats)}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {owner && !onStripe ? (
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
          {error && <p className="org-error" role="alert">{error}</p>}
        </div>
      ) : (
        !owner && <p className="org-note">Only the owner can change the plan.</p>
      )}
    </div>
  )
}
