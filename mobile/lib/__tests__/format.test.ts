import {
  DRIVING_SPEED_THRESHOLD_MPH,
  isDriving,
  isLowBattery,
  isStale,
  LOW_BATTERY_THRESHOLD,
  speedToMph,
  STALE_AFTER_MS,
  timeAgo,
} from '../format';

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

describe('isLowBattery', () => {
  it('is false for null (unknown battery level)', () => {
    expect(isLowBattery(null)).toBe(false);
  });

  it('is false above the threshold', () => {
    expect(isLowBattery(1)).toBe(false);
    expect(isLowBattery(LOW_BATTERY_THRESHOLD + 0.01)).toBe(false);
  });

  it('is true at or below the threshold', () => {
    expect(isLowBattery(LOW_BATTERY_THRESHOLD)).toBe(true);
    expect(isLowBattery(0.05)).toBe(true);
    expect(isLowBattery(0)).toBe(true);
  });
});

describe('speedToMph', () => {
  it('converts meters/second to mph', () => {
    expect(speedToMph(10)).toBeCloseTo(22.3694, 3);
  });

  it('returns null for null or a negative sentinel', () => {
    expect(speedToMph(null)).toBeNull();
    expect(speedToMph(-1)).toBeNull();
  });

  it('treats 0 as a real (stationary) speed, not unknown', () => {
    expect(speedToMph(0)).toBe(0);
  });
});

describe('isDriving', () => {
  it('is false when stationary or unknown', () => {
    expect(isDriving(0)).toBe(false);
    expect(isDriving(null)).toBe(false);
  });

  it('is false below the driving threshold (e.g. jogging/cycling pace)', () => {
    const belowThresholdMps = (DRIVING_SPEED_THRESHOLD_MPH - 2) / 2.23694;
    expect(isDriving(belowThresholdMps)).toBe(false);
  });

  it('is true at or above the driving threshold', () => {
    const atThresholdMps = DRIVING_SPEED_THRESHOLD_MPH / 2.23694;
    expect(isDriving(atThresholdMps)).toBe(true);
  });
});
