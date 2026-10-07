export type OrgRole = 'owner' | 'admin' | 'manager' | 'worker'

// A row from my_orgs() (migration ...000048): one per organization the
// signed-in person belongs to, including a pending invitation.
export interface OrgMembership {
  org_id: string
  name: string
  type: string
  role: OrgRole
  status: 'invited' | 'active'
  consented_at: string | null
  on_shift: boolean
  shift_started_at: string | null
}

// The web dashboard is for the people who oversee a crew. Workers clock in
// on their phones (the web never tracks anyone), so a worker-only account
// just keeps the ordinary circle dashboard.
export function overseerOrgs(orgs: OrgMembership[]): OrgMembership[] {
  return orgs.filter((o) => o.status === 'active' && o.role !== 'worker')
}

export function isAdminRole(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin'
}
