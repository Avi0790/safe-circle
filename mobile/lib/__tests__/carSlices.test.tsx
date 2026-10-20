import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { carSlices } from '../../components/CarSlices';
import { TiltedAvatar } from '../../components/TiltedAvatar';
import { VEHICLE_STYLES } from '../vehiclePreference';

describe('carSlices', () => {
  it('stacks every car from the road up: ground, wheels, sides, top, windows, roof', () => {
    for (const { style } of VEHICLE_STYLES.filter((v) => v.style !== 'arrow' && v.style !== 'race')) {
      const parts = carSlices(style).map((s) => s.part);
      expect(parts[0]).toBe('ground');
      expect(parts).toContain('tyres');
      expect(parts).toContain('body');
      expect(parts).toContain('cabin');
      expect(parts[parts.length - 1]).toBe('roof');
      expect(parts.indexOf('deck')).toBeGreaterThan(parts.lastIndexOf('body'));
      expect(parts.indexOf('cabin')).toBeGreaterThan(parts.indexOf('deck'));
      const z = carSlices(style).map((s) => s.z);
      expect([...z].sort((a, b) => a - b)).toEqual(z); // bottom to top
    }
  });

  it('makes the off-road tall and the sports car low', () => {
    const roof = (style: 'offroad' | 'sports') => carSlices(style).find((s) => s.part === 'roof')!.z;
    expect(roof('offroad')).toBeGreaterThan(roof('sports') + 5);
  });

  it('gives the race car tall wheels, a raised helmet and a high wing, and the arrow no slices', () => {
    const parts = carSlices('race').map((s) => s.part);
    expect(parts).toEqual(expect.arrayContaining(['ground', 'tyres', 'body', 'deck', 'helmet', 'wing']));
    expect(carSlices('arrow')).toEqual([]);
  });

  it('darkens the body sides towards the road', () => {
    const tones = carSlices('sedan').filter((s) => s.part === 'body').map((s) => s.tone!);
    expect(tones[0]).toBeLessThan(tones[tones.length - 1]);
  });
});

describe('TiltedAvatar', () => {
  async function mount(tilt: number, style: 'sedan' | 'arrow' = 'sedan') {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<TiltedAvatar style={style} color="red" walking={false} rotate={30} tilt={tilt} />);
    });
    return r;
  }
  const lifts = (r: ReactTestRenderer) =>
    r.root
      .findAll(
        (n) =>
          (n.props.testID === 'avatar-slice' || n.props.testID === 'avatar-top') &&
          typeof n.type !== 'string' &&
          // an animated view and the view inside it both carry the testID: count the inner one
          n.findAll((x) => x !== n && x.props.testID === n.props.testID && typeof x.type !== 'string').length === 0,
      )
      .map((n) => {
        const style = Array.isArray(n.props.style) ? n.props.style[n.props.style.length - 1] : n.props.style;
        return -(style.transform.find((t: Record<string, number>) => 'translateY' in t).translateY as number);
      });

  it('looking straight down is just the top-down drawing', async () => {
    expect(lifts(await mount(0))).toEqual([0]);
  });

  it('tilted, the slices rise with their height, so the sides show', async () => {
    const l = lifts(await mount(45));
    expect(l.length).toBeGreaterThan(8);
    expect(l[0]).toBe(0); // the road layer stays on the road
    expect([...l].sort((a, b) => a - b)).toEqual(l);
    expect(l[l.length - 1]).toBeCloseTo(15 * Math.sin(Math.PI / 4), 1); // the roof
  });

  it('the arrow stays flat on the map', async () => {
    expect(lifts(await mount(45, 'arrow'))).toEqual([0]);
  });
});
