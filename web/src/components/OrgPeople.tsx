import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership, OrgRole } from '../lib/org'
import type { RosterMember } from '../lib/crew'
import { allowedMemberActions, buildTeams, type MemberAction, type TeamMemberRow, type TeamRow } from '../lib/teams'

const ROLE_RANK: Record<OrgRole, number> = { owner: 0, admin: 1, manager: 2, worker: 3 }

// People and teams for owners and admins. A manager sees only the workers on
// teams they lead, so setup is: make someone a manager, make them a team's
// lead, add the workers they oversee. The database decides who may do what
// (migration ...000048); the buttons here just mirror those rules.
export function OrgPeople({ org, myUserId }: { org: OrgMembership; myUserId: string }) {
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [teamRows, setTeamRows] = useState<TeamRow[]>([])
  const [teamMemberRows, setTeamMemberRows] = useState<TeamMemberRow[]>([])
  const [newTeam, setNewTeam] = useState('')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [rosterRes, teamsRes] = await Promise.all([
      supabase.rpc('org_roster', { p_org: org.org_id }),
      supabase.from('teams').select('id, name').eq('org_id', org.org_id).order('name'),
    ])
    const failure = rosterRes.error ?? teamsRes.error
    if (failure) {
      setError(failure.message)
      return
    }
    const teams = (teamsRes.data as TeamRow[]) ?? []
    let members: TeamMemberRow[] = []
    if (teams.length > 0) {
      const { data } = await supabase
        .from('team_members')
        .select('team_id, user_id, is_lead')
        .in('team_id', teams.map((t) => t.id))
      members = (data as TeamMemberRow[]) ?? []
    }
    setRoster((rosterRes.data as RosterMember[]) ?? [])
    setTeamRows(teams)
    setTeamMemberRows(members)
  }, [org.org_id])

  useEffect(() => {
    load()
  }, [load])

  async function run(call: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null)
    setBusy(true)
    const { error: rpcError } = await call()
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    await load()
  }

  function apply(person: RosterMember, action: MemberAction) {
    if (action.kind === 'role') {
      run(() => supabase.rpc('set_org_member_role', { p_org: org.org_id, p_user: person.user_id, p_role: action.role }))
      return
    }
    if (window.confirm(`Remove ${person.full_name}? They lose access, are clocked out if on shift, and leave every team.`)) {
      run(() => supabase.rpc('remove_org_member', { p_org: org.org_id, p_user: person.user_id }))
    }
  }

  async function newCode() {
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('regenerate_org_invite_code', { p_org: org.org_id })
    if (rpcError) setError(rpcError.message)
    else setInviteCode(data as string)
  }

  const people = [...roster].sort(
    (a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.full_name.localeCompare(b.full_name),
  )
  const teams = buildTeams(teamRows, teamMemberRows, roster)

  return (
    <div className="org-page">
      <p className="org-note">
        A manager sees the workers on teams they lead. Make someone a manager, add them to a team as
        its lead, then add the workers they oversee.
      </p>
      {error && <p className="org-error" role="alert">{error}</p>}

      <section className="org-block">
        <h3>Invite your crew</h3>
        {inviteCode ? (
          <p className="org-code">{inviteCode}</p>
        ) : (
          <p className="org-note">Codes expire after 48 hours and are shown once. A new one replaces the old.</p>
        )}
        <button onClick={newCode}>Get a new invite code</button>
      </section>

      <section className="org-block">
        <h3>People</h3>
        <table className="org-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const actions = allowedMemberActions(org.role, p, p.user_id === myUserId)
              return (
                <tr key={p.user_id}>
                  <td>
                    {p.full_name}
                    {p.user_id === myUserId ? ' (you)' : ''}
                  </td>
                  <td>{p.role}</td>
                  <td>{p.status === 'invited' ? 'waiting to accept' : 'active'}</td>
                  <td>
                    <div className="org-actions">
                      {actions.map((a) => (
                        <button key={a.label} className="org-small" disabled={busy} onClick={() => apply(p, a)}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="org-block">
        <h3>Teams</h3>
        <form
          className="org-inline"
          onSubmit={(e) => {
            e.preventDefault()
            const name = newTeam.trim()
            if (!name) return
            setNewTeam('')
            run(() => supabase.rpc('create_team', { p_org: org.org_id, p_name: name }))
          }}
        >
          <input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="New team name" aria-label="New team name" maxLength={60} />
          <button type="submit" disabled={busy}>
            Create team
          </button>
        </form>

        {teams.length === 0 && <p className="org-note">No teams yet.</p>}
        {teams.map((team) => (
          <div key={team.id} className="org-card">
            <strong>{team.name}</strong>
            {team.members.map((m) => (
              <div key={m.user_id} className="org-inline">
                <span>
                  {m.full_name} ({m.role}){m.is_lead ? ' · lead' : ''}
                </span>
                {m.role === 'manager' && (
                  <button
                    className="org-small"
                    disabled={busy}
                    onClick={() =>
                      run(() => supabase.rpc('set_team_member', { p_team: team.id, p_user: m.user_id, p_is_lead: !m.is_lead }))
                    }
                  >
                    {m.is_lead ? 'Remove as lead' : 'Make lead'}
                  </button>
                )}
                <button
                  className="org-small"
                  disabled={busy}
                  onClick={() => run(() => supabase.rpc('remove_team_member', { p_team: team.id, p_user: m.user_id }))}
                >
                  Take off team
                </button>
              </div>
            ))}
            {team.candidates.length > 0 && (
              <div className="org-inline">
                <select
                  value=""
                  disabled={busy}
                  aria-label={`Add someone to ${team.name}`}
                  onChange={(e) => {
                    const userId = e.target.value
                    if (userId) run(() => supabase.rpc('set_team_member', { p_team: team.id, p_user: userId, p_is_lead: false }))
                  }}
                >
                  <option value="">Add to team…</option>
                  {team.candidates.map((c) => (
                    <option key={c.user_id} value={c.user_id}>
                      {c.full_name} ({c.role})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              className="org-small"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete ${team.name}? The people on it stay in the organization.`)) {
                  run(() => supabase.rpc('delete_team', { p_team: team.id }))
                }
              }}
            >
              Delete team
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}
