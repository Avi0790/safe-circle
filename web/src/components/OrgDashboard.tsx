import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { SosEvent } from '../lib/types'
import { eventsMissingNames, fillSosNames, type SosDetailRow } from '../lib/sosNames'
import { isAdminRole, type OrgMembership } from '../lib/org'
import { billingReturnNotice } from '../lib/billing'
import { planSummary } from '../lib/plan'
import { OrgLive } from './OrgLive'
import { OrgPeople } from './OrgPeople'
import { OrgPlan } from './OrgPlan'
import { OrgShifts } from './OrgShifts'
import { OrgSettings } from './OrgSettings'
import { OrgSosBanner } from './OrgSosBanner'
import { OrgTimesheets } from './OrgTimesheets'

type Tab = 'live' | 'people' | 'shifts' | 'timesheets' | 'plan' | 'settings'

// The work view for owners, admins and managers: a live crew map, people and
// teams (owners/admins), and shift history. Unlike the circle dashboard this
// one writes — roles, teams, resolving an SOS — but it still never tracks
// anyone: location only ever comes from workers' phones. Owners and admins
// also see the plan; timesheets are for anyone who oversees workers.
export function OrgDashboard({
  orgs,
  myUserId,
  onOrgsChanged,
}: {
  orgs: OrgMembership[]
  myUserId: string
  onOrgsChanged: () => Promise<void> | void
}) {
  const [orgId, setOrgId] = useState(orgs[0].org_id)
  // back from Stripe (?billing=…): open the Plan tab and say what happened
  const [billingNotice] = useState(() => billingReturnNotice(window.location.search))
  const [tab, setTab] = useState<Tab>(billingNotice ? 'plan' : 'live')
  const [sosEvents, setSosEvents] = useState<SosEvent[]>([])

  const org = orgs.find((o) => o.org_id === orgId) ?? orgs[0]
  const admin = isAdminRole(org.role)
  const plan = admin ? planSummary(org) : null

  const loadSos = useCallback(async () => {
    // sos_events has two FKs to profiles, so the embed needs the hint.
    const { data } = await supabase
      .from('sos_events')
      .select('*, profiles!sos_events_user_id_fkey(full_name), sos_acknowledgements(user_id, profiles(full_name))')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
    let loaded = (data as unknown as SosEvent[]) ?? []
    // An overseer isn't a circle-mate of the worker, so the sender's profile
    // comes back empty; fetch just the names (migration ...000055).
    const missing = eventsMissingNames(loaded)
    if (missing.length > 0) {
      const { data: names } = await supabase.rpc('org_sos_details', { p_event_ids: missing })
      loaded = fillSosNames(loaded, (names as SosDetailRow[] | null) ?? [])
    }
    setSosEvents(loaded)
  }, [])

  useEffect(() => {
    if (!billingNotice) return
    window.history.replaceState(null, '', window.location.pathname)
    // Stripe's webhook usually lands within seconds of the redirect
    const timers = [3_000, 10_000].map((ms) => setTimeout(() => onOrgsChanged(), ms))
    return () => timers.forEach(clearTimeout)
  }, [billingNotice, onOrgsChanged])

  useEffect(() => {
    loadSos()
    const channel = supabase
      .channel('org-sos-events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_events' }, () => loadSos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_acknowledgements' }, () => loadSos())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadSos])

  const activeTab: Tab =
    ((tab === 'people' || tab === 'settings') && !admin) || (tab === 'plan' && !plan) ? 'live' : tab
  const tabButton = (t: Tab, label: string) => (
    <button className={activeTab === t ? 'org-tab org-tab-on' : 'org-tab'} onClick={() => setTab(t)}>
      {label}
    </button>
  )

  return (
    <div className="org-dashboard">
      <header className="org-header">
        {orgs.length > 1 ? (
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            {orgs.map((o) => (
              <option key={o.org_id} value={o.org_id}>
                {o.name}
              </option>
            ))}
          </select>
        ) : (
          <strong className="org-title">{org.name}</strong>
        )}
        <span className="org-note">you are {org.role === 'admin' ? 'an admin' : `a${org.role === 'owner' ? 'n' : ''} ${org.role}`}</span>
        {plan && (
          <button className={`plan-badge${plan.tone === 'ok' ? '' : ` plan-badge-${plan.tone}`}`} onClick={() => setTab('plan')}>
            {plan.title}
          </button>
        )}
        <nav className="org-tabs">
          {tabButton('live', 'Live crew')}
          {admin && tabButton('people', 'People & teams')}
          {tabButton('shifts', 'Shifts')}
          {tabButton('timesheets', 'Timesheets')}
          {plan && tabButton('plan', 'Plan')}
          {admin && tabButton('settings', 'Settings')}
        </nav>
      </header>

      <OrgSosBanner events={sosEvents} onChanged={loadSos} />

      <main className="org-body">
        {activeTab === 'live' && <OrgLive key={org.org_id} org={org} />}
        {activeTab === 'people' && <OrgPeople key={org.org_id} org={org} myUserId={myUserId} />}
        {activeTab === 'shifts' && <OrgShifts key={org.org_id} org={org} />}
        {activeTab === 'timesheets' && <OrgTimesheets key={org.org_id} org={org} />}
        {activeTab === 'plan' && <OrgPlan key={org.org_id} org={org} onChanged={onOrgsChanged} notice={billingNotice} />}
        {activeTab === 'settings' && (
          <OrgSettings key={org.org_id} org={org} onChanged={onOrgsChanged} onOpenTimesheets={() => setTab('timesheets')} />
        )}
      </main>
    </div>
  )
}
