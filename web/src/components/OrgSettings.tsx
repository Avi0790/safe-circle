import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'
import { confirmsName, DELETE_EFFECTS } from '../lib/orgSettings'
import { OrgJobSites } from './OrgJobSites'

// Rename the organization (owners and admins), manage its job sites, or
// delete it (owners only, typing its name). The database checks each
// (migrations ...000067, ...000068).
export function OrgSettings({
  org,
  onChanged,
  onOpenTimesheets,
}: {
  org: OrgMembership
  onChanged: () => Promise<void> | void
  onOpenTimesheets: () => void
}) {
  const [name, setName] = useState(org.name)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const owner = org.role === 'owner'

  async function rename() {
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error: rpcError } = await supabase.rpc('rename_organization', { p_org: org.org_id, p_name: name })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else {
      setNotice('Renamed.')
      await onChanged()
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('delete_organization', { p_org: org.org_id, p_confirm_name: typed })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else await onChanged()
  }

  return (
    <div className="org-page">
      <div className="org-block">
        <h3>Name</h3>
        <div className="org-inline">
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Organization name" />
          <button onClick={rename} disabled={busy || name.trim() === '' || name.trim() === org.name}>
            Save name
          </button>
          {notice && <span className="org-note">{notice}</span>}
        </div>
      </div>

      <OrgJobSites org={org} />

      {owner && (
        <div className="org-block danger-zone">
          <h3>Delete {org.name}</h3>
          <ul className="org-note">
            {DELETE_EFFECTS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="org-note">
            Need the hours for payroll?{' '}
            <button className="link-button" onClick={onOpenTimesheets}>
              Download the timesheets first
            </button>
            .
          </p>
          <div className="org-inline">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={`Type ${org.name} to confirm`}
              aria-label={`Type ${org.name} to confirm`}
            />
            <button className="danger-button" onClick={remove} disabled={busy || !confirmsName(typed, org.name)}>
              Delete organization
            </button>
          </div>
        </div>
      )}
      {error && <p className="org-error" role="alert">{error}</p>}
    </div>
  )
}
