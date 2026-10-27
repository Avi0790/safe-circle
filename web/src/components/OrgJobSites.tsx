import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'

interface Site {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_m: number
}

// The organization's job sites (migration ...000068), listed for owners and
// admins with a way to remove them. They're added from the phone app, where
// "add where I am now" works. Workers who opt in are reminded by their own
// phone on arrival; nobody here is told.
export function OrgJobSites({ org }: { org: OrgMembership }) {
  const [sites, setSites] = useState<Site[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: rpcError } = await supabase.rpc('org_job_sites', { p_org: org.org_id })
      if (cancelled) return
      if (rpcError) setError(rpcError.message)
      else setSites((data as Site[] | null) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [org.org_id, reloads])

  async function remove(site: Site) {
    if (!window.confirm(`Remove ${site.name}? Workers stop getting reminders there.`)) return
    const { error: rpcError } = await supabase.rpc('delete_job_site', { p_site: site.id })
    if (rpcError) setError(rpcError.message)
    setReloads((n) => n + 1)
  }

  return (
    <div className="org-block">
      <h3>Job sites ({sites.length} of 20)</h3>
      <p className="org-note">
        Add sites from the Safe Circle phone app. Workers who turn on job site reminders get a nudge from their own
        phone when they arrive without clocking in; nobody here is told they were there.
      </p>
      {sites.length === 0 ? (
        <p className="org-note">No job sites yet.</p>
      ) : (
        <table className="org-table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Radius</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.radius_m} m</td>
                <td className="org-actions">
                  <button className="org-small" onClick={() => remove(s)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="org-error">{error}</p>}
    </div>
  )
}
