// Weather warnings on shift (migration ...000076).

export interface WeatherAlert {
  id: number
  user_id: string
  worker_name: string | null
  kind: 'heat' | 'cold' | 'storm' | 'wind'
  level: 'caution' | 'danger'
  feels_like_f: number | null
  gust_mph: number | null
  created_at: string
}

type T = (s: string, v?: Record<string, string | number>) => string

// "🥵 Maya Patel: dangerous heat, feels like 106°F"
export function weatherAlertLine(a: WeatherAlert, t: T): string {
  const name = a.worker_name ?? t('Worker')
  switch (a.kind) {
    case 'heat':
      return a.level === 'danger'
        ? t('🥵 {name}: dangerous heat, feels like {f}°F', { name, f: a.feels_like_f ?? '?' })
        : t('🌡️ {name}: heat, feels like {f}°F', { name, f: a.feels_like_f ?? '?' })
    case 'cold':
      return a.level === 'danger'
        ? t('🥶 {name}: dangerous cold, feels like {f}°F', { name, f: a.feels_like_f ?? '?' })
        : t('❄️ {name}: cold, feels like {f}°F', { name, f: a.feels_like_f ?? '?' })
    case 'storm':
      return t('⛈️ {name}: thunderstorm', { name })
    default:
      return t('💨 {name}: gusts of {g} mph', { name, g: a.gust_mph ?? '?' })
  }
}
