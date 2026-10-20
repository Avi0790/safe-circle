import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_VEHICLE, getVehicle, nextHeading, parseVehicle, setVehicle, shade, vehicleColorName, vehicleStyleName } from '../vehiclePreference';
import { maneuverGlyph } from '../navigation';

describe('vehicle choice', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('defaults to the blue arrow, remembers a choice, and ignores junk', async () => {
    expect(await getVehicle()).toEqual(DEFAULT_VEHICLE);
    await setVehicle({ style: 'race', color: 'silver' });
    expect(await getVehicle()).toEqual({ style: 'race', color: 'silver' });
    expect(parseVehicle('{"style":"tank","color":"red"}')).toEqual({ style: 'arrow', color: 'red' });
    expect(parseVehicle('not json')).toEqual(DEFAULT_VEHICLE);
  });

  it('carries a choice from the earlier set over to its nearest new avatar', () => {
    expect(parseVehicle('{"style":"suv","color":"black"}')).toEqual({ style: 'offroad', color: 'black' });
    expect(parseVehicle('{"style":"pickup","color":"white"}').style).toBe('offroad');
    expect(parseVehicle('{"style":"neon","color":"purple"}').style).toBe('sports');
    expect(parseVehicle('{"style":"moto","color":"green"}').style).toBe('compact');
  });

  it('names avatars and colours the way the picker shows them', () => {
    expect(vehicleColorName('black')).toBe('Night black');
    expect(vehicleColorName('green')).toBe('Deep teal');
    expect(vehicleStyleName('race')).toBe('Race car');
    expect(vehicleStyleName('offroad')).toBe('Off-road');
  });

  it('shades colours lighter and darker for the drawings', () => {
    expect(shade('#808080', 0)).toBe('#808080');
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#ff0000', -0.5)).toBe('#800000');
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
