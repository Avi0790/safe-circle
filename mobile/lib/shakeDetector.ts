// Pure shake-gesture detection — feed it accelerometer magnitude samples,
// it calls back once a "shake" (several hard jolts in quick succession) is
// recognized. Kept free of expo-sensors so the actual gesture logic (the
// part worth getting right and testing) doesn't need a device or a mock
// native module — see hooks/useShakeToSos.ts for the thin wiring.
export interface ShakeDetectorOptions {
  // Peak acceleration magnitude, in g, that counts as one jolt. Resting
  // magnitude is ~1g (gravity); a firm shake comfortably clears 2.5g.
  thresholdG?: number;
  // How many jolts must land inside the window to count as a shake — one
  // jolt alone is easily just bumping the phone down on a table.
  minPeaks?: number;
  // Jolts must all land within this many ms of the first one.
  windowMs?: number;
  // Once a shake fires, ignore everything for this long — stops a single
  // continuous shaking motion from firing repeatedly.
  cooldownMs?: number;
}

const DEFAULTS: Required<ShakeDetectorOptions> = {
  thresholdG: 2.5,
  minPeaks: 3,
  windowMs: 1500,
  cooldownMs: 3000,
};

export class ShakeDetector {
  private readonly options: Required<ShakeDetectorOptions>;
  private peakTimestamps: number[] = [];
  private lastFiredAt = -Infinity;

  constructor(
    private readonly onShake: () => void,
    options: ShakeDetectorOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  // magnitude: sqrt(x^2 + y^2 + z^2) in g. timestampMs: Date.now()-style.
  feed(magnitude: number, timestampMs: number): void {
    if (timestampMs - this.lastFiredAt < this.options.cooldownMs) return;
    if (magnitude < this.options.thresholdG) return;

    this.peakTimestamps.push(timestampMs);
    this.peakTimestamps = this.peakTimestamps.filter(
      (t) => timestampMs - t <= this.options.windowMs,
    );

    if (this.peakTimestamps.length >= this.options.minPeaks) {
      this.peakTimestamps = [];
      this.lastFiredAt = timestampMs;
      this.onShake();
    }
  }

  reset(): void {
    this.peakTimestamps = [];
  }
}
