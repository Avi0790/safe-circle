import { FallDetector } from '@/lib/fallDetector';

// Recorded-style accelerometer patterns at 20 samples a second (50 ms), the
// rate hooks/useFallDetection.ts uses. Magnitudes in g; ~1 g is at rest.
const STEP = 50;

type Segment = [g: number | ((i: number) => number), ms: number];

function play(segments: Segment[]): number[] {
  const fired: number[] = [];
  const detector = new FallDetector(() => fired.push(t));
  let t = 0;
  for (const [g, ms] of segments) {
    for (let i = 0; i < ms / STEP; i++) {
      detector.feed(typeof g === 'function' ? g(i) : g, t);
      t += STEP;
    }
  }
  return fired;
}

// walking: a gentle ~1.3 g bounce every half second
const walking = (i: number) => (i % 10 === 0 ? 1.3 : i % 10 === 5 ? 0.8 : 1);
// running: hard 3–3.5 g strikes several times a second
const running = (i: number) => (i % 6 === 0 ? 3.4 : i % 6 === 3 ? 0.4 : 1.1);
// lying still with tiny sensor noise
const still = (i: number) => 1 + (i % 2 === 0 ? 0.04 : -0.04);

describe('fall detection', () => {
  it('a fall: free fall, a hard landing, then lying still', () => {
    const fired = play([
      [walking, 3000],
      [0.2, 300], // falling
      [3.6, 100], // landing
      [1.6, 200], // a bounce
      [still, 7000],
    ]);
    expect(fired).toHaveLength(1);
  });

  it('a crash: one very hard impact with no free fall, then stillness', () => {
    expect(play([[1, 2000], [6.5, 150], [2.2, 300], [still, 7000]])).toHaveLength(1);
  });

  it('tumbling down stairs: several impacts, then stillness, alerts once', () => {
    expect(play([[0.3, 200], [3.2, 50], [2, 400], [4.5, 50], [1.8, 400], [4.2, 50], [still, 8000]])).toHaveLength(1);
  });

  it('running never fires: the strikes are hard, but it never goes still', () => {
    expect(play([[running, 60_000]])).toHaveLength(0);
  });

  it('a dropped phone picked straight back up does not fire', () => {
    expect(play([[0.2, 250], [3.5, 50], [1.2, 1500], [still, 1500], [walking, 5000]])).toHaveLength(0);
  });

  it('sitting down hard (no free fall, under 4 g) then staying still does not fire', () => {
    expect(play([[walking, 2000], [3.1, 100], [still, 10_000]])).toHaveLength(0);
  });

  it('getting up after a few seconds does not fire', () => {
    expect(play([[0.2, 300], [4, 100], [still, 3500], [walking, 5000]])).toHaveLength(0);
  });

  it('a fall needs the full stillness window', () => {
    expect(play([[0.2, 300], [4, 100], [still, 1500 + 3500]])).toHaveLength(0);
    expect(play([[0.2, 300], [4, 100], [still, 1500 + 4500]])).toHaveLength(1);
  });

  it('after one alert it waits a minute before another', () => {
    const fall: Segment[] = [[0.2, 300], [4.2, 100], [still, 6500]];
    expect(play([...fall, ...fall])).toHaveLength(1);
    expect(play([...fall, [walking, 60_000], ...fall])).toHaveLength(2);
  });
});
