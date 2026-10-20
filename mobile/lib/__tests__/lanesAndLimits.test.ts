import lanesFixture from './fixtures/osrm-lanes-jonesboro.json';
import { laneArrows, laneHint, nextAnnouncement, type Lane } from '../navigation';
import { parseOsrmRoute } from '../routing';
import { isOverLimit, LIMIT_LOOKUP_EVERY_MS, lookUpSpeedLimit, parseMaxspeed, shouldLookUpLimit } from '../speedLimit';

const L = (indications: string[], valid: boolean): Lane => ({ indications, valid });

describe('lanes from a real route', () => {
  const route = parseOsrmRoute(lanesFixture);
  const race = route.steps.find((s) => s.name === 'Race Street')!;

  it('reads the turn lanes at the junction where the map has them', () => {
    expect(race.lanes).toEqual([L(['left'], true), L(['left'], true), L(['straight'], false), L(['straight'], false), L(['right'], false)]);
    expect(route.steps.filter((s) => s.lanes).length).toBe(1); // only junctions mapped with lanes get them
  });

  it('draws them, lighting the lanes to use', () => {
    expect(laneArrows(race.lanes!, race.modifier)).toEqual([
      { glyph: '↰', valid: true },
      { glyph: '↰', valid: true },
      { glyph: '↑', valid: false },
      { glyph: '↑', valid: false },
      { glyph: '↱', valid: false },
    ]);
  });

  it('says which lanes to use with the warnings, when driving only', () => {
    const i = route.steps.indexOf(race);
    expect(nextAnnouncement(i, 400, route.steps, new Set())!.text).toBe('In a quarter mile, turn left onto Race Street. Use the left 2 lanes.');
    expect(nextAnnouncement(i, 80, route.steps, new Set())!.text).toBe('Turn left onto Race Street. Use the left 2 lanes.');
    expect(nextAnnouncement(i, 25, route.steps, new Set(), 'walk')!.text).toBe('Turn left onto Race Street.');
  });
});

describe('laneArrows and laneHint', () => {
  it('shows the arrow for this turn on a lane that allows several', () => {
    expect(laneArrows([L(['straight', 'right'], true), L(['straight'], false)], 'right')).toEqual([
      { glyph: '↱', valid: true },
      { glyph: '↑', valid: false },
    ]);
  });

  it('describes the lanes to be in', () => {
    expect(laneHint([L(['straight'], false), L(['right'], true)])).toBe('Use the right lane.');
    expect(laneHint([L(['left'], false), L(['straight'], true), L(['straight'], true), L(['right'], false)])).toBe('Use the middle 2 lanes.');
    expect(laneHint([L(['left'], true), L(['straight'], false)])).toBe('Use the left lane.');
  });

  it('says nothing when any lane will do, none is marked, or the lanes to use are split up', () => {
    expect(laneHint([L(['straight'], true), L(['straight'], true)])).toBeNull();
    expect(laneHint([L(['straight'], false), L(['straight'], false)])).toBeNull();
    expect(laneHint([L(['left'], true), L(['straight'], false), L(['right'], true)])).toBeNull();
    expect(laneHint(undefined)).toBeNull();
  });
});

describe('speed limits', () => {
  it('reads the ways OpenStreetMap writes limits, in mph', () => {
    expect(parseMaxspeed('35 mph')).toBe(35);
    expect(parseMaxspeed('50')).toBe(30); // km/h by default -> 31 mph -> nearest 5
    expect(parseMaxspeed('100 km/h')).toBe(60);
    expect(parseMaxspeed('45 mph;35 mph')).toBe(45);
    expect(parseMaxspeed('none')).toBeNull();
    expect(parseMaxspeed('signals')).toBeNull();
    expect(parseMaxspeed('US:urban')).toBeNull();
    expect(parseMaxspeed(undefined)).toBeNull();
  });

  it('looks up again only on a new road or after a while, one at a time', () => {
    expect(shouldLookUpLimit(null, null, 1, 0, false)).toBe(true);
    expect(shouldLookUpLimit(0, 1, 1, 5_000, false)).toBe(false);
    expect(shouldLookUpLimit(0, 1, 2, 5_000, false)).toBe(true); // a new step
    expect(shouldLookUpLimit(0, 1, 1, LIMIT_LOOKUP_EVERY_MS, false)).toBe(true);
    expect(shouldLookUpLimit(0, 1, 2, 5_000, true)).toBe(false); // still waiting on one
  });

  it('counts as over only past a little slack', () => {
    expect(isOverLimit(37, 35)).toBe(false);
    expect(isOverLimit(38, 35)).toBe(true);
    expect(isOverLimit(50, null)).toBe(false);
  });

  describe('lookUpSpeedLimit', () => {
    afterEach(() => {
      delete (global as any).fetch;
    });

    it('asks Nominatim about the road at your position', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        json: async () => ({ category: 'highway', osm_type: 'way', osm_id: 42, extratags: { maxspeed: '35 mph' } }),
      }));
      (global as any).fetch = fetchMock;
      expect(await lookUpSpeedLimit({ latitude: 35.84, longitude: -90.7 })).toEqual({ roadId: 'way42', mph: 35 });
      const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
      expect(url.pathname).toBe('/reverse');
      expect(url.searchParams.get('extratags')).toBe('1');
      expect(url.searchParams.get('zoom')).toBe('17');
    });

    it('has no limit for an unmapped road, something that is not a road, or a failed request', async () => {
      (global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ category: 'highway', osm_id: 1, extratags: {} }) }));
      expect((await lookUpSpeedLimit({ latitude: 0, longitude: 0 })).mph).toBeNull();
      (global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ category: 'amenity', extratags: { maxspeed: '30' } }) }));
      expect((await lookUpSpeedLimit({ latitude: 0, longitude: 0 })).mph).toBeNull();
      (global as any).fetch = jest.fn(async () => {
        throw new Error('offline');
      });
      expect(await lookUpSpeedLimit({ latitude: 0, longitude: 0 })).toEqual({ roadId: null, mph: null });
    });
  });
});
