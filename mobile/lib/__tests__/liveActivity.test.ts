import { lockScreenItems, syncLockScreen } from '@/lib/liveActivity';
import type { OrgMembership } from '@/lib/orgInfo';
import type { SafetyTimer, Walk } from '@/lib/types';

const ME = 'me';
const NOW = Date.parse('2026-10-30T20:00:00Z');
const inMin = (m: number) => new Date(NOW + m * 60000).toISOString();

const walk = (over: Partial<Walk> = {}) =>
  ({ id: 'w1', user_id: ME, place_name: 'Home', expected_by: inMin(20), status: 'active', ...over }) as Walk;
const timer = (over: Partial<SafetyTimer> = {}) =>
  ({ id: 't1', user_id: ME, label: 'First date', expected_by: inMin(90), status: 'active', ...over }) as SafetyTimer;
const org = (over: Partial<OrgMembership> = {}) =>
  ({ org_id: 'o1', name: 'Riverside', on_shift: true, shift_started_at: inMin(-60), ...over }) as OrgMembership;

describe('what goes on the lock screen', () => {
  it('your walk, your timer and your shift, each counting down to its deadline', () => {
    const items = lockScreenItems([walk()], [timer()], [org()], ME, NOW);
    expect(items.map((i) => i.key)).toEqual(['walk:w1', 'timer:t1', `shift:o1:${inMin(-60)}`]);
    expect(items[0]).toMatchObject({ title: '🚶 Walking to Home', endsAt: inMin(20), deepLink: '/walk' });
    expect(items[1].title).toBe('⏱️ First date');
    expect(items[2]).toMatchObject({ title: '🟢 On shift at Riverside', endsAt: inMin(-60 + 14 * 60) });
  });

  it('never someone else\'s, never an overdue one, never off shift', () => {
    expect(lockScreenItems([walk({ user_id: 'them' })], [], [], ME, NOW)).toEqual([]);
    expect(lockScreenItems([walk({ status: 'overdue' as Walk['status'] })], [timer({ expected_by: inMin(-1) })], [], ME, NOW)).toEqual([]);
    expect(lockScreenItems([], [], [org({ on_shift: false })], ME, NOW)).toEqual([]);
    expect(lockScreenItems([walk()], [], [], undefined, NOW)).toEqual([]);
  });
});

describe('keeping the lock screen in step', () => {
  function fakeModule() {
    let n = 0;
    return {
      started: [] as string[],
      stopped: [] as string[],
      startActivity(state: { title: string }) {
        this.started.push(state.title);
        n += 1;
        return `a${n}`;
      },
      stopActivity(id: string) {
        this.stopped.push(id);
      },
    };
  }

  it('starts what is new, stops what has ended, leaves the rest alone', () => {
    const m = fakeModule();
    const first = lockScreenItems([walk()], [timer()], [], ME, NOW);
    let running = syncLockScreen(first, new Map(), m as never);
    expect(m.started).toEqual(['🚶 Walking to Home', '⏱️ First date']);
    // the walk ends; the timer carries on
    running = syncLockScreen(lockScreenItems([], [timer()], [], ME, NOW), running, m as never);
    expect(m.stopped).toEqual(['a1']);
    expect([...running.keys()]).toEqual(['timer:t1']);
    expect(m.started).toHaveLength(2);
  });

  it('a build without the extension changes nothing', () => {
    const running = new Map([['walk:w1', 'a1']]);
    expect(syncLockScreen(lockScreenItems([walk()], [], [], ME, NOW), running, null)).toBe(running);
  });

  it('a refused start just means nothing shows', () => {
    const m = { startActivity: () => { throw new Error('unsupported'); }, stopActivity: () => {} };
    expect(syncLockScreen(lockScreenItems([walk()], [], [], ME, NOW), new Map(), m as never).size).toBe(0);
  });
});
