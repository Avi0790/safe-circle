// Fall and crash detection ("man-down"), as pure logic: feed it accelerometer
// magnitude samples (in g, ~1 at rest), it calls back once when the pattern
// of a fall is seen. Kept free of expo-sensors, like lib/shakeDetector.ts, so
// the part worth getting right is tested with recorded patterns
// (lib/__tests__/fallDetector.test.ts); hooks/useFallDetection.ts wires it up.
//
// A fall is: a hard impact, then stillness. Specifically
//   1. an impact of at least `impactG`, or at least `impactAfterFreeFallG`
//      if the phone was in free fall (near 0 g) just before it;
//   2. a settling time (`settleMs`) for bouncing and tumbling, during which
//      another impact starts the settling again (a fall down stairs);
//   3. `stillMs` of the phone lying still (every sample within `stillBandG`
//      of 1 g). Movement in that window means the person is moving: no fall.
// Running, a bumpy ride, sitting down hard or a dropped phone that's picked
// up again all fail step 3 or step 1. A dropped phone left on the floor
// passes, which is why the app asks "Are you OK?" for 30 seconds, with
// vibration, before anything is sent (components/FallCheck.tsx).

export interface FallDetectorOptions {
  impactG?: number;
  impactAfterFreeFallG?: number;
  freeFallG?: number;
  freeFallWindowMs?: number;
  settleMs?: number;
  stillMs?: number;
  stillBandG?: number;
  cooldownMs?: number;
}

const DEFAULTS: Required<FallDetectorOptions> = {
  impactG: 4,
  impactAfterFreeFallG: 2.8,
  freeFallG: 0.5,
  freeFallWindowMs: 1000,
  settleMs: 1500,
  stillMs: 4000,
  stillBandG: 0.3,
  cooldownMs: 60_000,
};

type State = { kind: 'idle' } | { kind: 'settling'; since: number } | { kind: 'still'; since: number };

export class FallDetector {
  private readonly options: Required<FallDetectorOptions>;
  private state: State = { kind: 'idle' };
  private lastFreeFallAt = -Infinity;
  private lastFiredAt = -Infinity;

  constructor(
    private readonly onFall: () => void,
    options: FallDetectorOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  private isImpact(magnitude: number, at: number): boolean {
    const o = this.options;
    if (magnitude >= o.impactG) return true;
    return magnitude >= o.impactAfterFreeFallG && at - this.lastFreeFallAt <= o.freeFallWindowMs;
  }

  // magnitude: sqrt(x² + y² + z²) in g. at: milliseconds, Date.now()-style.
  feed(magnitude: number, at: number): void {
    const o = this.options;
    if (at - this.lastFiredAt < o.cooldownMs) return;
    if (magnitude <= o.freeFallG) this.lastFreeFallAt = at;

    switch (this.state.kind) {
      case 'idle':
        if (this.isImpact(magnitude, at)) this.state = { kind: 'settling', since: at };
        return;
      case 'settling':
        if (this.isImpact(magnitude, at)) {
          this.state = { kind: 'settling', since: at }; // still tumbling
        } else if (at - this.state.since >= o.settleMs) {
          this.state = Math.abs(magnitude - 1) <= o.stillBandG ? { kind: 'still', since: at } : { kind: 'idle' };
        }
        return;
      case 'still':
        if (Math.abs(magnitude - 1) > o.stillBandG) {
          this.state = { kind: 'idle' }; // they're moving: not a fall
        } else if (at - this.state.since >= o.stillMs) {
          this.state = { kind: 'idle' };
          this.lastFiredAt = at;
          this.onFall();
        }
        return;
    }
  }

  reset(): void {
    this.state = { kind: 'idle' };
    this.lastFreeFallAt = -Infinity;
  }
}

// What the SOS says when no one answers "Are you OK?" (stored in English;
// shown in each reader's language, lib/sosMessages.ts).
export const FALL_SOS_MESSAGE =
  "Automatic alert: a possible fall was detected and they didn't respond for 30 seconds. This is their location.";

export const FALL_COUNTDOWN_SECONDS = 30;
