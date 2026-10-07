import { ACCOUNT_TYPES, canEnterApp, DEFAULT_ACCOUNT_TYPE, parseAccountType } from '../accountType';
import { ORG_DISCLOSURE, activeOrgs, pendingInvite, type OrgMembership } from '../orgInfo';

describe('parseAccountType', () => {
  it('accepts the three real types', () => {
    expect(parseAccountType('individual')).toBe('individual');
    expect(parseAccountType('family')).toBe('family');
    expect(parseAccountType('industry')).toBe('industry');
  });

  it('falls back to family for anything else, like the database trigger does', () => {
    expect(parseAccountType(undefined)).toBe(DEFAULT_ACCOUNT_TYPE);
    expect(parseAccountType(null)).toBe('family');
    expect(parseAccountType('admin')).toBe('family');
  });
});

describe('canEnterApp', () => {
  const none = { hasCircle: false, hasActiveOrg: false };

  it('keeps family accounts out until they have a circle (unchanged behavior)', () => {
    expect(canEnterApp({ ...none, accountType: 'family' })).toBe(false);
    expect(canEnterApp({ ...none, hasCircle: true, accountType: 'family' })).toBe(true);
  });

  it('lets individuals straight in', () => {
    expect(canEnterApp({ ...none, accountType: 'individual' })).toBe(true);
  });

  it('keeps work-crew accounts out until they are an active member of an organization', () => {
    expect(canEnterApp({ ...none, accountType: 'industry' })).toBe(false);
    expect(canEnterApp({ ...none, hasActiveOrg: true, accountType: 'industry' })).toBe(true);
  });

  it('lets anyone in who belongs to a circle or an organization, whatever they chose', () => {
    expect(canEnterApp({ ...none, hasCircle: true, accountType: 'industry' })).toBe(true);
    expect(canEnterApp({ ...none, hasActiveOrg: true, accountType: 'family' })).toBe(true);
  });
});

describe('signup options', () => {
  it('offers each type exactly once with text to show', () => {
    expect(ACCOUNT_TYPES.map((o) => o.id).sort()).toEqual(['family', 'individual', 'industry']);
    for (const option of ACCOUNT_TYPES) {
      expect(option.title.trim()).not.toBe('');
      expect(option.description.trim()).not.toBe('');
    }
  });
});

describe('organization memberships', () => {
  const org = (status: OrgMembership['status'], id: string): OrgMembership => ({
    org_id: id,
    name: id,
    type: 'field_crew',
    role: 'worker',
    status,
    consented_at: status === 'active' ? '2026-10-06T00:00:00Z' : null,
    on_shift: false,
    shift_started_at: null,
  });

  it('separates active memberships from a pending invitation', () => {
    const orgs = [org('invited', 'a'), org('active', 'b')];
    expect(activeOrgs(orgs).map((o) => o.org_id)).toEqual(['b']);
    expect(pendingInvite(orgs)?.org_id).toBe('a');
    expect(pendingInvite([org('active', 'b')])).toBeNull();
  });

  it('an invited-only worker is not an active member, so they stay on the consent screen', () => {
    expect(activeOrgs([org('invited', 'a')])).toHaveLength(0);
  });

  it('the disclosure has text and states the shift-only promise', () => {
    expect(ORG_DISCLOSURE.length).toBeGreaterThan(3);
    expect(ORG_DISCLOSURE.join(' ')).toMatch(/only while you are clocked in/i);
    expect(ORG_DISCLOSURE.join(' ')).toMatch(/recorded/i);
  });
});
