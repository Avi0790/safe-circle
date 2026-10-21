import React from 'react';
import { fake } from '../../test-support/fakeSupabase';
import { allText, pressables, press, render, unmountAll } from '../../test-support/render';

// The Timesheets screen with the real timesheet logic; the server, the route
// params and the share sheet are faked.
const mockShare = jest.fn(async (..._args: unknown[]) => ({ ok: true as const }));
jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ orgId: 'o1', orgName: 'Riverside' }),
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('@/lib/shareFile', () => ({ shareTextFile: (...a: unknown[]) => mockShare(...a) }));

import TimesheetsScreen from '../../app/(app)/timesheets';
import { weekStart } from '@/lib/timesheet';

const mon = weekStart(new Date());
const hoursAfter = (h: number) => new Date(mon.getTime() + h * 3600_000).toISOString();

beforeEach(() => {
  fake.reset();
  mockShare.mockClear();
  fake.rpcResults.org_shifts = {
    data: [
      { shift_id: 1, user_id: 'w1', full_name: 'Sam Field', clocked_in_at: hoursAfter(8), ended_at: hoursAfter(16), is_open: false },
      { shift_id: 2, user_id: 'w2', full_name: 'Ana Crew', clocked_in_at: hoursAfter(9), ended_at: hoursAfter(12.5), is_open: false },
    ],
  };
});
afterEach(unmountAll);

describe('Timesheets screen', () => {
  it("shows this week's hours per worker and in total", async () => {
    const r = await render(<TimesheetsScreen />);
    const t = allText(r);
    expect(t).toContain('This week');
    expect(t).toContain('11.50 h');
    expect(t).toContain('worked by 2 workers');
    expect(t).toContain('Sam Field8.00 h');
    expect(t).toContain('Ana Crew3.50 h');
    expect(t).toContain('never locations');
    expect(fake.rpcsOf('org_shifts')[0]).toMatchObject({ p_org: 'o1', p_limit: 500 });
  });

  it('downloads the week as a CSV file', async () => {
    const r = await render(<TimesheetsScreen />);
    await press(r, 'Download timesheet (CSV)');
    const [filename, csv, mime] = mockShare.mock.calls[0] as [string, string, string];
    expect(filename).toMatch(/^timesheet-riverside-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(mime).toBe('text/csv');
    expect(csv).toContain('Sam Field,Total,,,8.00');
    expect(csv).toContain('All workers,Total,,,11.50');
  });

  it('steps back a week, and not into the future', async () => {
    const r = await render(<TimesheetsScreen />);
    expect(pressables(r, 'Later ›')).toHaveLength(0); // disabled on this week
    fake.rpcResults.org_shifts = { data: [] };
    await press(r, '‹ Earlier');
    expect(allText(r)).toContain('Last week');
    expect(allText(r)).toContain('No shifts this week.');
    expect(pressables(r, 'Download timesheet (CSV)')).toHaveLength(0);
    expect(fake.rpcsOf('org_shifts')).toHaveLength(2);
  });

  it('shows why the server refused', async () => {
    fake.rpcResults.org_shifts = { error: { message: 'Not signed in' } };
    const r = await render(<TimesheetsScreen />);
    expect(allText(r)).toContain('Not signed in');
  });
});
