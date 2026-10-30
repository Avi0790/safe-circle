import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'
import { hourBars, needsAttention, normalizeWeeks, summarize, type SafetyWeek } from '../lib/safety'
import { language, t } from '../lib/i18n'

const WEEKS = 8

// The safety report (org_safety_report, migration ...000073): the last eight
// weeks of hours, SOS alerts and how fast they were answered, missed
// check-ins, quiet phones, incident reports and location views. Owners and
// admins see the whole organization; a manager sees their teams.
export function OrgSafety({ org }: { org: OrgMembership }) {
  const [weeks, setWeeks] = useState<SafetyWeek[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: rpcError } = await supabase.rpc('org_safety_report', {
        p_org: org.org_id,
        p_weeks: WEEKS,
        p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      if (cancelled) return
      if (rpcError) setError(rpcError.message)
      else {
        setError(null)
        setWeeks(normalizeWeeks((data as unknown[]) ?? []))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [org.org_id])

  if (error) {
    return (
      <div className="org-page">
        <p className="org-error" role="alert">{t(error)}</p>
      </div>
    )
  }
  if (!weeks) return <div className="centered">{t('Loading…')}</div>

  const s = summarize(weeks)
  const locale = language() === 'es' ? 'es-US' : 'en-US'
  const bars = hourBars(weeks, locale)
  const weekLabel = (w: SafetyWeek) =>
    new Date(w.week_start + 'T12:00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric' })

  return (
    <div className="org-page">
      <p className="org-note">
        {t('The last {n} weeks for the people you oversee. Counts and times only; no locations.', { n: WEEKS })}
      </p>

      <section className="org-block">
        <h3>{t('At a glance')}</h3>
        <div className="pf-tiles">
          <Tile label={t('Hours worked')} value={String(s.hours)} sub={t('{n} shifts', { n: s.shifts })} />
          <Tile
            label={t('SOS answered')}
            value={`${s.sosAnswered} / ${s.sos}`}
            sub={
              s.slowestMedianMinutes == null
                ? t('No SOS answered yet')
                : t('slowest weekly median: {m} min', { m: s.slowestMedianMinutes })
            }
            warn={s.sos > s.sosAnswered}
          />
          <Tile label={t('Missed check-ins')} value={String(s.missedCheckins)} sub={t('alerts to managers')} warn={s.missedCheckins > 0} />
          <Tile label={t('Quiet phones')} value={String(s.quietPhones)} sub={t('on shift, about 20 min silent')} warn={s.quietPhones > 0} />
          <Tile
            label={t('Incident reports')}
            value={String(s.incidents)}
            sub={t('{n} still open', { n: s.incidentsOpen })}
            warn={s.incidentsOpen > 0}
          />
          <Tile label={t('Location views')} value={String(s.locationViews)} sub={t('each one shown to the worker')} />
        </div>
      </section>

      <section className="org-block">
        <h3>{t('Hours worked per week')}</h3>
        <div
          className="pf-chart"
          role="img"
          aria-label={t('Hours worked per week for the last {n} weeks, {h} hours in total', { n: WEEKS, h: s.hours })}
        >
          {bars.map((b) => (
            <div key={b.week} className="pf-col" tabIndex={0} aria-label={`${b.label}: ${b.hours} h`}>
              {b.hours > 0 && <div className="pf-bar" style={{ height: `${Math.max(b.share * 100, 3)}%` }} />}
              <span className="pf-tip">
                {b.label} · {b.hours} h
              </span>
            </div>
          ))}
        </div>
        {bars.length > 0 && (
          <div className="pf-axis">
            <span>{bars[0].label}</span>
            <span>{t('This week')}</span>
          </div>
        )}
      </section>

      <section className="org-block">
        <h3>{t('Week by week')}</h3>
        <table className="org-table ts-table">
          <thead>
            <tr>
              <th scope="col">{t('Week of')}</th>
              <th scope="col" className="ts-num">{t('Hours')}</th>
              <th scope="col" className="ts-num">{t('SOS (answered)')}</th>
              <th scope="col" className="ts-num">{t('Median answer')}</th>
              <th scope="col" className="ts-num">{t('Missed check-ins')}</th>
              <th scope="col" className="ts-num">{t('Quiet phones')}</th>
              <th scope="col" className="ts-num">{t('Incidents (open)')}</th>
              <th scope="col" className="ts-num">{t('Location views')}</th>
            </tr>
          </thead>
          <tbody>
            {[...weeks].reverse().map((w) => (
              <tr key={w.week_start}>
                <td>
                  {weekLabel(w)}
                  {needsAttention(w) && <span className="pf-warn"> {t('needs a look')}</span>}
                </td>
                <td className="ts-num">{w.hours}</td>
                <td className="ts-num">
                  {w.sos} ({w.sos_answered})
                </td>
                <td className="ts-num">{w.median_response_minutes == null ? '—' : `${w.median_response_minutes} min`}</td>
                <td className={`ts-num${w.missed_checkins === 0 ? ' ts-zero' : ''}`}>{w.missed_checkins}</td>
                <td className={`ts-num${w.quiet_phones === 0 ? ' ts-zero' : ''}`}>{w.quiet_phones}</td>
                <td className="ts-num">
                  {w.incidents} ({w.incidents - w.incidents_resolved})
                </td>
                <td className="ts-num">{w.location_views}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
