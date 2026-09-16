import { isStale, STALE_AFTER_MS, timeAgo } from '../format';

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe('timeAgo', () => {
  it('reports timestamps under a minute old as "just now"', () => {
    expect(timeAgo(isoAgo(0))).toBe('just now');
    expect(timeAgo(isoAgo(45_000))).toBe('just now');
  });

  it('reports minutes for timestamps under an hour old', () => {
    expect(timeAgo(isoAgo(60_000))).toBe('1m ago');
    expect(timeAgo(isoAgo(30 * 60_000))).toBe('30m ago');
  });

  it('reports hours for timestamps under a day old', () => {
    expect(timeAgo(isoAgo(60 * 60_000))).toBe('1h ago');
    expect(timeAgo(isoAgo(5 * 60 * 60_000))).toBe('5h ago');
  });

  it('reports days for anything a day or older', () => {
    expect(timeAgo(isoAgo(24 * 60 * 60_000))).toBe('1d ago');
    expect(timeAgo(isoAgo(3 * 24 * 60 * 60_000))).toBe('3d ago');
  });
});

describe('isStale', () => {
  it('is false for a recent ping', () => {
    expect(isStale(isoAgo(0))).toBe(false);
    expect(isStale(isoAgo(STALE_AFTER_MS - 1000))).toBe(false);
  });

  it('is true once a ping is older than the threshold', () => {
    expect(isStale(isoAgo(STALE_AFTER_MS + 1000))).toBe(true);
    expect(isStale(isoAgo(24 * 60 * 60_000))).toBe(true);
  });
});
