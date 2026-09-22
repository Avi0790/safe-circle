import { ShakeDetector } from '../shakeDetector';

describe('ShakeDetector', () => {
  it('fires after enough peaks land inside the window', () => {
    const onShake = jest.fn();
    const detector = new ShakeDetector(onShake, { thresholdG: 2.5, minPeaks: 3, windowMs: 1500 });

    detector.feed(3.0, 0);
    detector.feed(3.0, 300);
    expect(onShake).not.toHaveBeenCalled();
    detector.feed(3.0, 600);
    expect(onShake).toHaveBeenCalledTimes(1);
  });

  it('ignores samples below the threshold', () => {
    const onShake = jest.fn();
    const detector = new ShakeDetector(onShake, { thresholdG: 2.5, minPeaks: 3, windowMs: 1500 });

    detector.feed(1.0, 0);
    detector.feed(1.2, 100);
    detector.feed(0.9, 200);
    expect(onShake).not.toHaveBeenCalled();
  });

  it('drops peaks that fall outside the window before counting', () => {
    const onShake = jest.fn();
    const detector = new ShakeDetector(onShake, { thresholdG: 2.5, minPeaks: 3, windowMs: 1500 });

    detector.feed(3.0, 0);
    detector.feed(3.0, 1000);
    // Outside the 1500ms window relative to this sample — the first two
    // peaks should have aged out, so this alone isn't enough to fire.
    detector.feed(3.0, 3000);
    expect(onShake).not.toHaveBeenCalled();
  });

  it('does not fire again during the cooldown, but does after it', () => {
    const onShake = jest.fn();
    const detector = new ShakeDetector(onShake, {
      thresholdG: 2.5,
      minPeaks: 3,
      windowMs: 1500,
      cooldownMs: 3000,
    });

    detector.feed(3.0, 0);
    detector.feed(3.0, 100);
    detector.feed(3.0, 200);
    expect(onShake).toHaveBeenCalledTimes(1);

    // Still inside the cooldown — must not fire again.
    detector.feed(3.0, 500);
    detector.feed(3.0, 600);
    detector.feed(3.0, 700);
    expect(onShake).toHaveBeenCalledTimes(1);

    // Past the cooldown — a fresh set of peaks can fire again.
    detector.feed(3.0, 4000);
    detector.feed(3.0, 4100);
    detector.feed(3.0, 4200);
    expect(onShake).toHaveBeenCalledTimes(2);
  });

  it('reset() clears accumulated peaks without affecting the cooldown', () => {
    const onShake = jest.fn();
    const detector = new ShakeDetector(onShake, { thresholdG: 2.5, minPeaks: 3, windowMs: 1500 });

    detector.feed(3.0, 0);
    detector.feed(3.0, 100);
    detector.reset();
    detector.feed(3.0, 200);
    expect(onShake).not.toHaveBeenCalled();
  });
});
