import { crewSummary, hasPosition, splitCrew, workerFlags, type LiveWorker, type RosterMember } from '../crew';

const member = (id: string, role: RosterMember['role'], status: RosterMember['status'] = 'active'): RosterMember => ({
  user_id: id,
  full_name: id,
  role,
  status,
  consented_at: status === 'active' ? '2026-10-06T00:00:00Z' : null,
  on_shift: false,
});

const live = (id: string, overrides: Partial<LiveWorker> = {}): LiveWorker => ({
  user_id: id,
  full_name: id,
  latitude: 35.8,
  longitude: -90.7,
  speed: 0,
  battery_level: 0.8,
  recorded_at: new Date().toISOString(),
  clocked_in_at: '2026-10-06T08:00:00Z',
  team_names: null,
  ...overrides,
});

describe('splitCrew', () => {
  const roster = [
    member('boss', 'owner'),
    member('mgr', 'manager'),
    member('w1', 'worker'),
    member('w2', 'worker'),
    member('w3', 'worker', 'invited'),
  ];

  it('puts clocked-in workers on shift, other active workers off shift, invited workers pending', () => {
    const split = splitCrew(roster, [live('w1')]);
    expect(split.onShift.map((w) => w.user_id)).toEqual(['w1']);
    expect(split.offShift.map((m) => m.user_id)).toEqual(['w2']);
    expect(split.pending.map((m) => m.user_id)).toEqual(['w3']);
  });

  it('never lists owners, admins or managers as crew', () => {
    const split = splitCrew(roster, []);
    const ids = [...split.offShift, ...split.pending].map((m) => m.user_id);
    expect(ids).not.toContain('boss');
    expect(ids).not.toContain('mgr');
  });

  it('summarises counts, mentioning pending only when there are some', () => {
    expect(crewSummary(splitCrew(roster, [live('w1')]))).toBe('1 on shift · 1 off · 1 waiting to accept');
    expect(crewSummary(splitCrew(roster.slice(0, 4), [live('w1')]))).toBe('1 on shift · 1 off');
  });
});

describe('workerFlags', () => {
  it('flags a worker with no position yet', () => {
    const flags = workerFlags(live('w', { latitude: null, longitude: null, recorded_at: null }));
    expect(flags.noFix).toBe(true);
    expect(flags.stale).toBe(false);
  });

  it('flags a clocked-in worker who has gone quiet for over 15 minutes', () => {
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    expect(workerFlags(live('w', { recorded_at: old })).stale).toBe(true);
    expect(workerFlags(live('w')).stale).toBe(false);
  });

  it('flags low battery and driving speed', () => {
    expect(workerFlags(live('w', { battery_level: 0.1 })).lowBattery).toBe(true);
    const fast = workerFlags(live('w', { speed: 20 }));
    expect(fast.driving).toBe(true);
    expect(Math.round(fast.mph!)).toBe(45);
    expect(workerFlags(live('w', { speed: 1 })).driving).toBe(false);
  });
});

describe('hasPosition', () => {
  it('is true only when both coordinates exist', () => {
    expect(hasPosition(live('w'))).toBe(true);
    expect(hasPosition(live('w', { latitude: null }))).toBe(false);
  });
});
