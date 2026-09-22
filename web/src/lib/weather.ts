// Current weather at a circle member's last known position — mirrors
// mobile/lib/weather.ts. Uses Open-Meteo (open-meteo.com), free and
// keyless, so this stays a plain client-side fetch with no backend change.
export interface Weather {
  tempF: number
  emoji: string
  description: string
}

export function describeWeatherCode(code: number): { emoji: string; description: string } {
  if (code === 0) return { emoji: '☀️', description: 'Clear' }
  if (code === 1 || code === 2) return { emoji: '🌤️', description: 'Partly cloudy' }
  if (code === 3) return { emoji: '☁️', description: 'Cloudy' }
  if (code === 45 || code === 48) return { emoji: '🌫️', description: 'Foggy' }
  if (code >= 51 && code <= 57) return { emoji: '🌦️', description: 'Drizzle' }
  if (code >= 61 && code <= 67) return { emoji: '🌧️', description: 'Rain' }
  if (code >= 71 && code <= 77) return { emoji: '🌨️', description: 'Snow' }
  if (code >= 80 && code <= 82) return { emoji: '🌦️', description: 'Rain showers' }
  if (code >= 85 && code <= 86) return { emoji: '🌨️', description: 'Snow showers' }
  if (code >= 95) return { emoji: '⛈️', description: 'Thunderstorm' }
  return { emoji: '🌡️', description: 'Weather' }
}

export async function fetchWeather(latitude: number, longitude: number): Promise<Weather | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timeformat=unixtime`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number }
    }
    if (json.current?.temperature_2m == null || json.current?.weather_code == null) return null
    const { emoji, description } = describeWeatherCode(json.current.weather_code)
    return { tempF: Math.round(json.current.temperature_2m), emoji, description }
  } catch {
    return null
  }
}
