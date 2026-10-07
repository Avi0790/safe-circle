import { crewSummary, hasPosition, splitCrew, workerFlags, type LiveWorker, type RosterMember } from '../crew'
import { overseerOrgs, type OrgMembership } from '../org'
import { allowedMemberActions, buildTeams } from '../teams'
import { csvCell, durationMinutes, shiftsToCsv } from '../csv'

const person = (id: string, role: RosterMember['role'], status: RosterMember['status'] = 'active'): RosterMember => ({
  user_id: id,
  full_name: id,
  role,
  status,
  consented_at: status === 'active' ? '2026-10-07T00:00:00Z' : null,
  on_shift: false,
})

const live = (id: string, overrides: Partial<LiveWorker> = {}): LiveWorker => ({
  user_id: id,
  full_name: id,
  latitude: 35.8,
  longitude: -90.7,
  speed: 0,
  battery_level: 0.8,
  recorded_at: new Date().toISOString(),
  clocked_in_at: '2026-10-07T08:00:00Z',
  team_names: null,
  ...overrides,
})

describe('splitCrew', () => {
  const roster = [person('boss', 'owner'), person('mgr', 'manager'), person('w1', 'worker'), person('w2', 'worker'), person('w3', 'worker', 'invited')]

  it('separates on shift, off shift and pending, and never lists non-workers', () => {
    const split = splitCrew(roster, [live('w1')])
    expect(split.onShift.map((w) => w.user_id)).toEqual(['w1'])
    expect(split.offShift.map((m) => m.user_id)).toEqual(['w2'])
    expect(split.pending.map((m) => m.user_id)).toEqual(['w3'])
  })

  it('summarises counts', () => {
    expect(crewSummary(splitCrew(roster, [live('w1')]))).toBe('1 on shift · 1 off · 1 waiting to accept')
    expect(crewSummary(splitCrew(roster.slice(0, 4), [live('w1')]))).toBe('1 on shift · 1 off')
  })
})

describe('workerFlags / hasPosition', () => {
  it('flags no position, quiet phones, low battery and driving', () => {
    expect(workerFlags(live('w', { latitude: null, longitude: null, recorded_at: null })).noFix).toBe(true)
    const old = new Date(Date.now() - 20 * 60_000).toISOString()
    expect(workerFlags(live('w', { recorded_at: old })).stale).toBe(true)
    expect(workerFlags(live('w')).stale).toBe(false)
    expect(workerFlags(live('w', { battery_level: 0.1 })).lowBattery).toBe(true)
    expect(workerFlags(live('w', { speed: 20 })).driving).toBe(true)
    expect(hasPosition(live('w'))).toBe(true)
    expect(hasPosition(live('w', { latitude: null }))).toBe(false)
  })
})

describe('overseerOrgs', () => {
  const org = (role: OrgMembership['role'], status: OrgMembership['status'] = 'active'): OrgMembership => ({
    org_id: role, name: role, type: 'field_crew', role, status, consented_at: null, on_shift: false, shift_started_at: null,
  })

  it('keeps active owners, admins and managers only', () => {
    expect(overseerOrgs([org('owner'), org('admin'), org('manager'), org('worker'), org('manager', 'invited')]).map((o) => o.role)).toEqual([
      'owner', 'admin', 'manager',
    ])
  })
})

describe('buildTeams / allowedMemberActions', () => {
  const roster = [person('mgr', 'manager'), person('anna', 'worker'), person('bob', 'worker'), person('cara', 'worker', 'invited')]

  it('lists leads first and only active workers and managers as candidates', () => {
    const [team] = buildTeams(
      [{ id: 't', name: 'A' }],
      [{ team_id: 't', user_id: 'anna', is_lead: false }, { team_id: 't', user_id: 'mgr', is_lead: true }],
      roster,
    )
    expect(team.members.map((m) => m.user_id)).toEqual(['mgr', 'anna'])
    expect(team.candidates.map((m) => m.user_id)).toEqual(['bob'])
  })

  it('mirrors the database permission rules', () => {
    const labels = (a: ReturnType<typeof allowedMemberActions>) => a.map((x) => x.label)
    expect(allowedMemberActions('owner', { role: 'owner', status: 'active' }, true)).toEqual([])
    expect(labels(allowedMemberActions('owner', { role: 'worker', status: 'active' }, false))).toEqual([
      'Make owner', 'Make admin', 'Make manager', 'Remove from organization',
    ])
    expect(labels(allowedMemberActions('admin', { role: 'worker', status: 'active' }, false))).toEqual([
      'Make manager', 'Remove from organization',
    ])
    expect(allowedMemberActions('admin', { role: 'admin', status: 'active' }, false)).toEqual([])
    expect(allowedMemberActions('manager', { role: 'worker', status: 'active' }, false)).toEqual([])
  })
})

describe('csv export', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('Smith, Jo')).toBe('"Smith, Jo"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('plain')).toBe('plain')
  })

  it('neutralises spreadsheet formulas in names', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"')
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('@sum')).toBe("'@sum")
  })

  it('writes a header and one row per shift, marking an open one', () => {
    const csv = shiftsToCsv([
      { shift_id: 1, user_id: 'a', full_name: 'Ann', clocked_in_at: '2026-10-07T08:00:00Z', ended_at: '2026-10-07T16:30:00Z', is_open: false },
      { shift_id: 2, user_id: 'b', full_name: '=Evil', clocked_in_at: '2026-10-07T09:00:00Z', ended_at: '2026-10-07T09:45:00Z', is_open: true },
    ])
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('Worker,Date,Clock in,Clock out,Minutes,Status')
    expect(lines[1]).toBe('Ann,2026-10-07,2026-10-07T08:00:00.000Z,2026-10-07T16:30:00.000Z,510,completed')
    expect(lines[2]).toBe("'=Evil,2026-10-07,2026-10-07T09:00:00.000Z,,45,on shift")
  })

  it('never reports a negative duration', () => {
    expect(durationMinutes('2026-10-07T10:00:00Z', '2026-10-07T09:00:00Z')).toBe(0)
  })
})
