export interface OrgMembership {
  org_id: string;
  name: string;
  type: string;
  role: 'owner' | 'admin' | 'manager' | 'worker';
  status: 'invited' | 'active';
  consented_at: string | null;
  on_shift: boolean;
  shift_started_at: string | null;
  // The disclosure changed since they accepted it; they must re-accept.
  needs_reconsent: boolean;
  checkin_minutes: number | null;
  next_checkin_due: string | null;
  // The organization's plan (migration ...000064, lib/orgPlan.ts). Everyone
  // gets the state; the dates and seats are null unless you're an owner or
  // admin.
  plan_state: 'trial' | 'active' | 'grace' | 'ended';
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  seat_limit: number | null;
  seats_used: number | null;
}

// What a worker is agreeing to before anyone can see them. Each line
// describes something the backend actually enforces (migrations ...000048,
// ...000051, ...000053, ...000056) — keep them in step. Changing what this promises
// means bumping org_disclosure_version() in the database (migration
// ...000052) so workers who accepted the old text are asked again.
export const ORG_DISCLOSURE: string[] = [
  'Your admins and managers can see your location only while you are clocked in.',
  'Only positions recorded during a shift are ever visible. Time before you clock in, and after you clock out, stays private.',
  'A shift ends automatically after 14 hours, so forgetting to clock out can’t mean being tracked all day.',
  'If you send an SOS while clocked in, your admins and the managers who oversee you are alerted with your location. An SOS sent off shift does not reach them.',
  'If you turn on check-in reminders when you clock in and miss one, your admins and the managers who oversee you are alerted with your last location.',
  'If your phone stops sending your location for about 20 minutes while you are clocked in, your admins and the managers who oversee you are notified, so they can check that you are OK.',
  'Other workers cannot see you.',
  'Every time a manager or admin looks at your location, it is recorded.',
  'You can leave the organization at any time.',
];

export function activeOrgs(orgs: OrgMembership[]): OrgMembership[] {
  return orgs.filter((o) => o.status === 'active');
}

export function pendingInvite(orgs: OrgMembership[]): OrgMembership | null {
  return orgs.find((o) => o.status === 'invited') ?? null;
}
