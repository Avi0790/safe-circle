// Current weather at a circle member's last known position — something no
// Life360-style app shows, and it's a genuinely useful signal for a family
// app: it explains a delay ("it's pouring where they are"), or why a kid
// stayed inside. Uses Open-Meteo (open-meteo.com) — free, keyless, no
// account or backend secret needed, which is why this lives entirely on
// the client rather than going through an Edge Function like the push
// features.
export interface Weather {
  tempF: number;
  emoji: string;
  description: string;
}

// WMO weather codes (https://open-meteo.com/en/docs — "WMO Weather
// interpretation codes"), collapsed to one emoji + short label each. Pure
// and exported separately from the network call so it's unit-testable
// without mocking fetch.
export function describeWeatherCode(code: number): { emoji: string; description: string } {
  if (code === 0) return { emoji: '☀️', description: 'Clear' };
  if (code === 1 || code === 2) return { emoji: '🌤️', description: 'Partly cloudy' };
  if (code === 3) return { emoji: '☁️', description: 'Cloudy' };
  if (code === 45 || code === 48) return { emoji: '🌫️', description: 'Foggy' };
  if (code >= 51 && code <= 57) return { emoji: '🌦️', description: 'Drizzle' };
  if (code >= 61 && code <= 67) return { emoji: '🌧️', description: 'Rain' };
  if (code >= 71 && code <= 77) return { emoji: '🌨️', description: 'Snow' };
  if (code >= 80 && code <= 82) return { emoji: '🌦️', description: 'Rain showers' };
  if (code >= 85 && code <= 86) return { emoji: '🌨️', description: 'Snow showers' };
  if (code >= 95) return { emoji: '⛈️', description: 'Thunderstorm' };
  return { emoji: '🌡️', description: 'Weather' };
}

export async function fetchWeather(latitude: number, longitude: number): Promise<Weather | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timeformat=unixtime`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    if (json.current?.temperature_2m == null || json.current?.weather_code == null) return null;
    const { emoji, description } = describeWeatherCode(json.current.weather_code);
    return { tempF: Math.round(json.current.temperature_2m), emoji, description };
  } catch {
    // No network, API hiccup, etc. — weather is a nice-to-have, never worth
    // surfacing as an error on a screen that's mainly about location history.
    return null;
  }
}
