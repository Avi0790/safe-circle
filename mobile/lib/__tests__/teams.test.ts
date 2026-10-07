import type { RosterMember } from '../crew';
import { allowedMemberActions, buildTeams } from '../teams';

const person = (
  id: string,
  role: RosterMember['role'],
  status: RosterMember['status'] = 'active',
): RosterMember => ({
  user_id: id,
  full_name: id,
  role,
  status,
  consented_at: status === 'active' ? '2026-10-06T00:00:00Z' : null,
  on_shift: false,
});

describe('buildTeams', () => {
  const roster = [
    person('boss', 'owner'),
    person('mgr', 'manager'),
    person('anna', 'worker'),
    person('bob', 'worker'),
    person('cara', 'worker', 'invited'),
  ];

  it('lists members with leads first, and only eligible people as candidates', () => {
    const [team] = buildTeams(
      [{ id: 't1', name: 'Crew A' }],
      [
        { team_id: 't1', user_id: 'anna', is_lead: false },
        { team_id: 't1', user_id: 'mgr', is_lead: true },
      ],
      roster,
    );
    expect(team.members.map((m) => m.user_id)).toEqual(['mgr', 'anna']);
    // bob is eligible; boss (owner) and cara (hasn't accepted) are not.
    expect(team.candidates.map((m) => m.user_id)).toEqual(['bob']);
  });

  it('sorts teams by name and shows an empty team with everyone eligible as a candidate', () => {
    const teams = buildTeams(
      [
        { id: 't2', name: 'Zeta' },
        { id: 't1', name: 'Alpha' },
      ],
      [],
      roster,
    );
    expect(teams.map((t) => t.name)).toEqual(['Alpha', 'Zeta']);
    expect(teams[0].candidates.map((m) => m.user_id)).toEqual(['anna', 'bob', 'mgr']);
  });

  it('skips team rows for people no longer in the roster', () => {
    const [team] = buildTeams(
      [{ id: 't1', name: 'Crew A' }],
      [{ team_id: 't1', user_id: 'ghost', is_lead: false }],
      roster,
    );
    expect(team.members).toEqual([]);
  });
});

describe('allowedMemberActions', () => {
  const labels = (a: ReturnType<typeof allowedMemberActions>) => a.map((x) => x.label);

  it('offers nothing on yourself', () => {
    expect(allowedMemberActions('owner', { role: 'owner', status: 'active' }, true)).toEqual([]);
  });

  it('lets an owner change anyone to any other role, and remove them', () => {
    expect(labels(allowedMemberActions('owner', { role: 'worker', status: 'active' }, false))).toEqual([
      'Make owner',
      'Make admin',
      'Make manager',
      'Remove from organization',
    ]);
  });

  it('lets an admin move workers and managers between those two roles only', () => {
    expect(labels(allowedMemberActions('admin', { role: 'worker', status: 'active' }, false))).toEqual([
      'Make manager',
      'Remove from organization',
    ]);
    expect(labels(allowedMemberActions('admin', { role: 'manager', status: 'active' }, false))).toEqual([
      'Make worker',
      'Remove from organization',
    ]);
  });

  it('gives an admin no actions on an owner or another admin', () => {
    expect(allowedMemberActions('admin', { role: 'owner', status: 'active' }, false)).toEqual([]);
    expect(allowedMemberActions('admin', { role: 'admin', status: 'active' }, false)).toEqual([]);
  });

  it('lets an admin remove a pending worker but not change their role', () => {
    expect(labels(allowedMemberActions('admin', { role: 'worker', status: 'invited' }, false))).toEqual([
      'Remove from organization',
    ]);
  });

  it('gives managers and workers no actions at all', () => {
    expect(allowedMemberActions('manager', { role: 'worker', status: 'active' }, false)).toEqual([]);
    expect(allowedMemberActions('worker', { role: 'worker', status: 'active' }, false)).toEqual([]);
  });
});
