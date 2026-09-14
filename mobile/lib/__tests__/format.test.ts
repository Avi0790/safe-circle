import { timeAgo } from '../format';

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
