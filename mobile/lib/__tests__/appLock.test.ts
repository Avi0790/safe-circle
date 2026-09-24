import { APP_LOCK_GRACE_MS, shouldRelock } from '../appLock';

describe('shouldRelock', () => {
  const now = 1_000_000;

  it('never locks when the setting is off', () => {
    expect(shouldRelock(false, null, now)).toBe(false);
    expect(shouldRelock(false, now - APP_LOCK_GRACE_MS * 10, now)).toBe(false);
  });

  it('always locks on a cold start (never backgrounded)', () => {
    expect(shouldRelock(true, null, now)).toBe(true);
  });

  it('does not re-lock for a quick trip to another app', () => {
    expect(shouldRelock(true, now - (APP_LOCK_GRACE_MS - 1), now)).toBe(false);
  });

  it('re-locks once the grace period has passed', () => {
    expect(shouldRelock(true, now - APP_LOCK_GRACE_MS, now)).toBe(true);
    expect(shouldRelock(true, now - APP_LOCK_GRACE_MS * 5, now)).toBe(true);
  });
});
