import { GLIDE_MAX_MS, GLIDE_MIN_MS, glideDuration, unwrapTowards } from '../glide';

describe('glide', () => {
  it('glides over about the time between fixes, within limits', () => {
    expect(glideDuration(null, 5000)).toBe(0); // first fix: just appear
    expect(glideDuration(4000, 5000)).toBe(1000);
    expect(glideDuration(4950, 5000)).toBe(GLIDE_MIN_MS);
    expect(glideDuration(0, 9000)).toBe(GLIDE_MAX_MS); // after a long gap, don't crawl
  });

  it('turns the short way round', () => {
    expect(unwrapTowards(350, 10)).toBe(370);
    expect(unwrapTowards(10, 350)).toBe(-10);
    expect(unwrapTowards(720, 90)).toBe(810);
    expect(unwrapTowards(-170, 170)).toBe(-190);
  });
});
