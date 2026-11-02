const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock('expo-location', () => ({}));

import { tally, tallyLine, unansweredRollCalls, type RollCallSummary } from '../rollCall';

const base: RollCallSummary = {
  id: 'r', started_by_name: 'Grace', note: null, created_at: '2026-11-02T12:00:00Z', closed_at: null,
  asked: 5, safe: 3, help: 1, my_answer: null, asked_me: true, can_close: false,
};
const t = (s: string, v?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v?.[k]));

describe('roll call', () => {
  it('counts who has not answered yet', () => {
    expect(tally(base).waiting).toBe(1);
    expect(tally({ asked: 2, safe: 2, help: 1 }).waiting).toBe(0); // never negative
    expect(tallyLine(base, t)).toBe('3 of 5 safe · 1 need help · 1 no answer');
  });

  it('prompts only for open roll calls you were asked in and have not answered, newest first', async () => {
    mockRpc.mockImplementation(async (_fn: string, { p_org }: { p_org: string }) => ({
      data:
        p_org === 'o1'
          ? [
              { ...base, id: 'answered', my_answer: 'safe' },
              { ...base, id: 'closed', closed_at: '2026-11-02T12:30:00Z' },
              { ...base, id: 'not-me', asked_me: false },
              { ...base, id: 'older', created_at: '2026-11-02T11:00:00Z' },
            ]
          : [{ ...base, id: 'newest', created_at: '2026-11-02T13:00:00Z' }],
      error: null,
    }));
    const pending = await unansweredRollCalls(['o1', 'o2']);
    expect(pending.map((r) => [r.id, r.orgId])).toEqual([['newest', 'o2'], ['older', 'o1']]);
  });
});
