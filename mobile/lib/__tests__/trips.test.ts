jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { formatTripDate, formatTripDuration } from '../trips';

describe('formatTripDuration', () => {
  it('rounds under a minute up to "1 min"', () => {
    expect(formatTripDuration(20)).toBe('1 min');
  });

  it('formats minutes under an hour', () => {
    expect(formatTripDuration(42 * 60)).toBe('42 min');
  });

  it('formats whole hours with no minutes remainder', () => {
    expect(formatTripDuration(2 * 3600)).toBe('2 h');
  });

  it('formats hours and minutes', () => {
    expect(formatTripDuration(3600 + 5 * 60)).toBe('1 h 5 min');
  });
});

describe('formatTripDate', () => {
  it('labels a trip from today as "Today, <time>"', () => {
    const now = new Date();
    expect(formatTripDate(now.toISOString())).toMatch(/^Today, /);
  });

  it('labels a trip from yesterday as "Yesterday, <time>"', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatTripDate(yesterday.toISOString())).toMatch(/^Yesterday, /);
  });

  it('labels an older trip with a month/day date', () => {
    const older = new Date();
    older.setDate(older.getDate() - 10);
    const result = formatTripDate(older.toISOString());
    expect(result).not.toMatch(/^Today|^Yesterday/);
  });
});
