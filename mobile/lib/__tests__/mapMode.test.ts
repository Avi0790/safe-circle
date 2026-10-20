import { mapModeOptions, mapViewProps, modeHasLabelsSwitch, modeHasTrafficSwitch, parseMapMode } from '../mapMode';

describe('map modes', () => {
  it('offers 3D Flyover on iPhone and Terrain on Android', () => {
    expect(mapModeOptions('ios').map((o) => o.label)).toEqual(['Explore', 'Driving', 'Satellite', '3D Flyover']);
    expect(mapModeOptions('android')[3].label).toBe('Terrain');
  });

  it('maps each mode onto the map settings for each platform', () => {
    const p = (mode: 'explore' | 'driving' | 'satellite' | 'flyover', labels = true, traffic = false) => ({ mode, labels, traffic });
    expect(mapViewProps(p('explore'), 'ios')).toEqual({ mapType: 'standard', showsTraffic: false, showsPointsOfInterest: true, showsBuildings: true });
    expect(mapViewProps(p('driving'), 'ios').mapType).toBe('mutedStandard');
    expect(mapViewProps(p('driving'), 'android').mapType).toBe('standard'); // no muted style on Google Maps
    expect(mapViewProps(p('driving', true, false), 'ios').showsTraffic).toBe(true); // always, in Driving
    expect(mapViewProps(p('satellite', true), 'ios').mapType).toBe('hybrid');
    expect(mapViewProps(p('satellite', false), 'ios')).toMatchObject({ mapType: 'satellite', showsPointsOfInterest: false });
    expect(mapViewProps(p('flyover', true), 'ios').mapType).toBe('hybridFlyover');
    expect(mapViewProps(p('flyover', false), 'ios').mapType).toBe('satelliteFlyover');
    expect(mapViewProps(p('flyover'), 'android').mapType).toBe('terrain');
    expect(mapViewProps(p('explore', true, true), 'ios').showsTraffic).toBe(true);
  });

  it('shows the switches that apply', () => {
    expect([modeHasLabelsSwitch('explore'), modeHasLabelsSwitch('satellite'), modeHasLabelsSwitch('flyover')]).toEqual([false, true, true]);
    expect([modeHasTrafficSwitch('driving'), modeHasTrafficSwitch('satellite')]).toEqual([false, true]);
  });

  it('reads back only a valid saved choice', () => {
    expect(parseMapMode('{"mode":"flyover","labels":false,"traffic":true}')).toEqual({ mode: 'flyover', labels: false, traffic: true });
    expect(parseMapMode('{"mode":"transit"}')).toBeNull();
    expect(parseMapMode('junk')).toBeNull();
    expect(parseMapMode('{"mode":"satellite"}')).toEqual({ mode: 'satellite', labels: true, traffic: false });
  });
});
