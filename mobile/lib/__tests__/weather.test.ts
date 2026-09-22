import { describeWeatherCode } from '../weather';

describe('describeWeatherCode', () => {
  it('maps clear sky', () => {
    expect(describeWeatherCode(0)).toEqual({ emoji: '☀️', description: 'Clear' });
  });

  it('maps partly cloudy codes', () => {
    expect(describeWeatherCode(1)).toEqual({ emoji: '🌤️', description: 'Partly cloudy' });
    expect(describeWeatherCode(2)).toEqual({ emoji: '🌤️', description: 'Partly cloudy' });
  });

  it('maps rain and snow ranges', () => {
    expect(describeWeatherCode(63)).toEqual({ emoji: '🌧️', description: 'Rain' });
    expect(describeWeatherCode(73)).toEqual({ emoji: '🌨️', description: 'Snow' });
  });

  it('maps thunderstorms', () => {
    expect(describeWeatherCode(95)).toEqual({ emoji: '⛈️', description: 'Thunderstorm' });
    expect(describeWeatherCode(99)).toEqual({ emoji: '⛈️', description: 'Thunderstorm' });
  });

  it('falls back for an unrecognized code', () => {
    expect(describeWeatherCode(68)).toEqual({ emoji: '🌡️', description: 'Weather' });
  });

  it('does not fall through to "partly cloudy" for a negative code', () => {
    expect(describeWeatherCode(-1)).toEqual({ emoji: '🌡️', description: 'Weather' });
  });
});
