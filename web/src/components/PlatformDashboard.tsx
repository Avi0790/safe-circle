import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { compact, money, plural, signupBars, sosAnswered, type PlatformStats } from '../lib/platform'

// The platform owner's view of Safe Circle as a whole (migration ...000066).
// Everything here comes from platform_stats(), which returns counts only: no
// names, locations, messages or ids reach this page, so even the owner's own
// dashboard can't be used to watch someone.
export function PlatformDashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showTable, setShowTable] = useState(false)

  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: rpcError } = await supabase.rpc('platform_stats')
      if (cancelled) return
      if (rpcError) setError(rpcError.message)
      else {
        setError(null)
        setStats(data as PlatformStats)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloads])

  if (error) {
    return (
      <div className="org-page">
        <p className="org-error">{error}</p>
      </div>
    )
  }
  if (!stats) return <div className="centered">Loading…</div>

  const { accounts, circles, work, safety, health } = stats
  const bars = signupBars(stats)

  return (
    <div className="org-page">
      <div className="org-inline">
        <h2 className="org-title">Safe Circle at a glance</h2>
        <span className="shell-spacer" />
        <span className="org-note">Updated {new Date(stats.generated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <button className="org-small" onClick={() => setReloads((n) => n + 1)}>
          Refresh
        </button>
      </div>
      <p className="org-note">
        Totals only. This page never receives anyone&apos;s name, location or messages.
      </p>

      <section className="org-block">
        <h3>People</h3>
        <div className="pf-tiles">
          <Tile label="Accounts" value={compact(accounts.total)} sub={`${compact(accounts.new_7d)} new this week`} />
          <Tile label="Active in the last 24 hours" value={compact(accounts.active_24h)} sub="sent a location" />
          <Tile label="Circles" value={compact(circles.total)} sub={`${circles.avg_size} people on average`} />
        </div>
      </section>

      <section className="org-block">
        <h3>Sign-ups, last 14 days</h3>
        {bars.length > 0 && (
          <>
            <div className="pf-chart" role="img" aria-label={`Sign-ups per day for the last 14 days, ${bars.reduce((t, b) => t + b.count, 0)} in total`}>
              {bars.map((b) => (
                <div key={b.day} className="pf-col" tabIndex={0} aria-label={`${b.label}: ${plural(b.count, 'sign-up')}`}>
                  {b.count > 0 && <div className="pf-bar" style={{ height: `${Math.max(b.share * 100, 3)}%` }} />}
                  <span className="pf-tip">
                    {b.label} · {plural(b.count, 'sign-up')}
                  </span>
                </div>
              ))}
            </div>
            <div className="pf-axis">
              <span>{bars[0].label}</span>
              <span>Today</span>
            </div>
          </>
        )}
        <button className="link-button org-small" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide table' : 'Show as table'}
        </button>
        {showTable && (
          <table className="org-table ts-table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="ts-num">Sign-ups</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.day}>
                  <td>{b.label}</td>
                  <td className="ts-num">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="org-block">
        <h3>Work organizations</h3>
        <div className="pf-tiles">
          <Tile
            label="Estimated monthly revenue"
            value={money(work.monthly_revenue_cents)}
            sub={`${plural(work.paid_seats, 'paid seat')} × ${money(stats.seat_price_cents)}`}
          />
          <Tile
            label="Organizations"
            value={compact(work.organizations)}
            sub={`${work.active} paying · ${work.trial} on trial · ${work.grace} payment failed · ${work.ended} ended`}
          />
          <Tile label="Workers" value={compact(work.workers)} sub={`${compact(work.on_shift)} on shift now`} />
        </div>
      </section>

      <section className="org-block">
        <h3>Safety and health</h3>
        <div className="pf-tiles">
          <Tile label="SOS alerts this week" value={compact(safety.sos_7d)} sub={sosAnswered(safety)} />
          <Tile
            label="SOS alerts still open"
            value={compact(safety.sos_open)}
            sub={safety.sos_open > 0 ? 'not yet marked resolved' : 'all resolved'}
            warn={safety.sos_open > 0}
          />
          <Tile
            label="Failed notifications, 24 hours"
            value={health.push_failures_24h == null ? '–' : compact(health.push_failures_24h)}
            sub={
              health.push_failures_24h == null
                ? 'not available on this server'
                : health.push_failures_24h > 0
                  ? 'check the Edge Function logs in Supabase'
                  : 'all delivered to the push service'
            }
            warn={(health.push_failures_24h ?? 0) > 0}
          />
        </div>
      </section>
    </div>
  )
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="pf-tile">
      <span className="pf-label">{label}</span>
      <span className="pf-value">{value}</span>
      <span className={warn ? 'pf-sub pf-warn' : 'pf-sub'}>{sub}</span>
    </div>
  )
}
