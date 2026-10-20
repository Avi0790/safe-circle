import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_VEHICLE, getVehicle, nextHeading, parseVehicle, setVehicle } from '../vehiclePreference';
import { maneuverGlyph } from '../navigation';

describe('vehicle choice', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('defaults to the blue arrow, remembers a choice, and ignores junk', async () => {
    expect(await getVehicle()).toEqual(DEFAULT_VEHICLE);
    await setVehicle({ style: 'pickup', color: 'silver' });
    expect(await getVehicle()).toEqual({ style: 'pickup', color: 'silver' });
    expect(parseVehicle('{"style":"tank","color":"red"}')).toEqual({ style: 'arrow', color: 'red' });
    expect(parseVehicle('not json')).toEqual(DEFAULT_VEHICLE);
  });
});

describe('nextHeading', () => {
  const at = (latitude: number, longitude: number) => ({ latitude, longitude });

  it("uses the GPS heading while moving", () => {
    expect(nextHeading(0, { heading: 123, speed: 10, ...at(35, -90) }, null)).toBe(123);
  });

  it('works it out from the last two positions when the GPS gives none', () => {
    expect(nextHeading(0, { heading: -1, speed: 10, ...at(35.001, -90) }, at(35, -90))).toBeCloseTo(0, 0); // north
    expect(nextHeading(0, { heading: null, speed: 10, ...at(35, -89.999) }, at(35, -90))).toBeCloseTo(90, 0); // east
    expect(nextHeading(0, { heading: null, speed: 10, ...at(34.999, -90) }, at(35, -90))).toBeCloseTo(180, 0); // south
  });

  it('keeps the last heading when stopped, instead of snapping north', () => {
    expect(nextHeading(250, { heading: 0, speed: 0, ...at(35, -90) }, at(35, -90))).toBe(250);
  });
});

describe('maneuverGlyph', () => {
  it('draws the turn', () => {
    expect(maneuverGlyph({ type: 'turn', modifier: 'right' })).toBe('↱');
    expect(maneuverGlyph({ type: 'turn', modifier: 'left' })).toBe('↰');
    expect(maneuverGlyph({ type: 'fork', modifier: 'slight right' })).toBe('↗');
    expect(maneuverGlyph({ type: 'turn', modifier: 'sharp left' })).toBe('↙');
    expect(maneuverGlyph({ type: 'turn', modifier: 'uturn' })).toBe('↶');
    expect(maneuverGlyph({ type: 'roundabout', modifier: 'right' })).toBe('↻');
    expect(maneuverGlyph({ type: 'depart' })).toBe('↑');
    expect(maneuverGlyph({ type: 'new name', modifier: 'straight' })).toBe('↑');
    expect(maneuverGlyph({ type: 'waypoint' })).toBe('📍');
    expect(maneuverGlyph({ type: 'arrive' })).toBe('🏁');
  });
});
