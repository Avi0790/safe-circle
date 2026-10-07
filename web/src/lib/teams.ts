import type { RosterMember } from './crew'
import type { OrgRole } from './org'

export interface TeamRow {
  id: string
  name: string
}

export interface TeamMemberRow {
  team_id: string
  user_id: string
  is_lead: boolean
}

export interface TeamViewMember {
  user_id: string
  full_name: string
  role: OrgRole
  is_lead: boolean
}

export interface TeamView {
  id: string
  name: string
  members: TeamViewMember[]
  // Active workers and managers not yet on this team.
  candidates: RosterMember[]
}

// Only active workers and managers can be on a team (set_team_member
// enforces this); owners and admins already see everyone.
const isTeamEligible = (m: RosterMember) =>
  m.status === 'active' && (m.role === 'worker' || m.role === 'manager')

export function buildTeams(
  teams: TeamRow[],
  teamMembers: TeamMemberRow[],
  roster: RosterMember[],
): TeamView[] {
  const byId = new Map(roster.map((m) => [m.user_id, m]))
  return teams
    .map((team) => {
      const rows = teamMembers.filter((tm) => tm.team_id === team.id)
      const members = rows
        .map((tm) => {
          const person = byId.get(tm.user_id)
          return person
            ? { user_id: tm.user_id, full_name: person.full_name, role: person.role, is_lead: tm.is_lead }
            : null
        })
        .filter((m): m is TeamViewMember => m !== null)
        .sort((a, b) => Number(b.is_lead) - Number(a.is_lead) || a.full_name.localeCompare(b.full_name))
      const inTeam = new Set(rows.map((tm) => tm.user_id))
      const candidates = roster
        .filter((m) => isTeamEligible(m) && !inTeam.has(m.user_id))
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
      return { id: team.id, name: team.name, members, candidates }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type MemberAction =
  | { kind: 'role'; role: OrgRole; label: string }
  | { kind: 'remove'; label: string }

const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Make owner',
  admin: 'Make admin',
  manager: 'Make manager',
  worker: 'Make worker',
}

// What the caller may do to another person. Mirrors the database rules in
// set_org_member_role / remove_org_member (migration ...000048), which are
// what actually enforce them — this only avoids offering buttons that would
// be refused: owners can change anyone's role and remove anyone; admins
// manage the field staff only (worker <-> manager) and can remove only
// workers and managers; nobody acts on themselves here.
export function allowedMemberActions(
  caller: OrgRole,
  target: { role: OrgRole; status: 'invited' | 'active' },
  isSelf: boolean,
): MemberAction[] {
  if (isSelf) return []
  const actions: MemberAction[] = []

  if (target.status === 'active') {
    if (caller === 'owner') {
      for (const role of ['owner', 'admin', 'manager', 'worker'] as OrgRole[]) {
        if (role !== target.role) actions.push({ kind: 'role', role, label: ROLE_LABEL[role] })
      }
    } else if (caller === 'admin' && (target.role === 'worker' || target.role === 'manager')) {
      const role: OrgRole = target.role === 'worker' ? 'manager' : 'worker'
      actions.push({ kind: 'role', role, label: ROLE_LABEL[role] })
    }
  }

  const canRemove =
    caller === 'owner' || (caller === 'admin' && (target.role === 'worker' || target.role === 'manager'))
  if (canRemove) actions.push({ kind: 'remove', label: 'Remove from organization' })

  return actions
}
