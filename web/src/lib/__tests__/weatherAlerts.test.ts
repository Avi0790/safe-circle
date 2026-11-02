import { weatherAlertLine, type WeatherAlert } from '../weatherAlerts'

const t = (s: string, v?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v?.[k]))
const a = (over: Partial<WeatherAlert>): WeatherAlert => ({
  id: 1, user_id: 'w', worker_name: 'Maya', kind: 'heat', level: 'caution', feels_like_f: 95, gust_mph: 10, created_at: '2026-11-02T18:00:00Z', ...over,
})

describe('weather warning lines', () => {
  it('names the worker and the risk', () => {
    expect(weatherAlertLine(a({ level: 'danger', feels_like_f: 106 }), t)).toBe('🥵 Maya: dangerous heat, feels like 106°F')
    expect(weatherAlertLine(a({ kind: 'cold', feels_like_f: -4 }), t)).toBe('❄️ Maya: cold, feels like -4°F')
    expect(weatherAlertLine(a({ kind: 'storm', level: 'danger' }), t)).toBe('⛈️ Maya: thunderstorm')
    expect(weatherAlertLine(a({ kind: 'wind', gust_mph: 48, worker_name: null }), t)).toBe('💨 Worker: gusts of 48 mph')
  })
})
