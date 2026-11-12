import { buildTimeline, milesText, spanText, type Ping } from '../timeline';

// a day: home 8 hours, a 12-minute drive, then at campus until now
const day = Date.parse('2026-11-12T06:00:00Z');
const at = (min: number) => new Date(day + min * 60_000).toISOString();
const home = { latitude: 35.84, longitude: -90.7 };
const campus = { latitude: 35.8423, longitude: -90.6743 };

function pingsFor(): Ping[] {
  const out: Ping[] = [];
  for (let m = 0; m <= 480; m += 20) out.push({ ...home, latitude: home.latitude + (m % 40 ? 0.0002 : 0), speed: 0, recorded_at: at(m) });
  // driving: 6 points across town
  for (let k = 1; k <= 6; k++) {
    out.push({
      latitude: home.latitude + ((campus.latitude - home.latitude) * k) / 7,
      longitude: home.longitude + ((campus.longitude - home.longitude) * k) / 7,
      speed: 15,
      recorded_at: at(480 + k * 2),
    });
  }
  for (let m = 495; m <= 600; m += 15) out.push({ ...campus, speed: 0, recorded_at: at(m) });
  return out;
}

describe('a day timeline', () => {
  it('turns positions into a stay, a drive and the stay going on now', () => {
    const tl = buildTimeline(pingsFor(), day + 605 * 60_000);
    expect(tl.map((e) => e.kind)).toEqual(['stay', 'move', 'stay']);
    const [h, drive, c] = tl;
    expect(h.kind === 'stay' && spanText(h.start, h.end)).toBe('8 h');
    expect(drive.kind === 'move' && drive.drove).toBe(true);
    expect(drive.kind === 'move' && drive.topMph).toBe(34);
    expect(c.kind === 'stay' && c.ongoing).toBe(true);
    expect(c.kind === 'stay' && c.latitude).toBeCloseTo(campus.latitude, 4);
  });

  it('a short stop is part of the move, not a stay', () => {
    const pts: Ping[] = [
      { ...home, speed: 0, recorded_at: at(0) },
      { ...home, speed: 0, recorded_at: at(30) },
      { latitude: 35.85, longitude: -90.7, speed: 2, recorded_at: at(35) },
      { latitude: 35.85, longitude: -90.7, speed: 0, recorded_at: at(38) }, // 3 min: not a stay
      { latitude: 35.86, longitude: -90.7, speed: 2, recorded_at: at(45) },
      { latitude: 35.87, longitude: -90.7, speed: 0, recorded_at: at(50) },
      { latitude: 35.87, longitude: -90.7, speed: 0, recorded_at: at(80) },
    ];
    const tl = buildTimeline(pts, day + 80 * 60_000);
    expect(tl.map((e) => e.kind)).toEqual(['stay', 'move', 'stay']);
    expect(tl[1].kind === 'move' && tl[1].drove).toBe(false);
  });

  it('nothing in, nothing out', () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it('formats spans and distances', () => {
    expect(spanText(at(0), at(490))).toBe('8 h 10 min');
    expect(spanText(at(0), at(12))).toBe('12 min');
    expect(milesText(6600)).toBe('4.1 mi');
  });
});
