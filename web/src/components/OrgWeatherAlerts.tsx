import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatClockTime } from '../lib/format'
import { t } from '../lib/i18n'
import { weatherAlertLine, type WeatherAlert } from '../lib/weatherAlerts'

// Heat, cold, storm and wind warnings from workers' phones on shift today
// (migration ...000076), for the workers this person oversees.
export function OrgWeatherAlerts({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<WeatherAlert[]>([])

  useEffect(() => {
    let alive = true
    const load = async () => {
      const { data } = await supabase.rpc('org_weather_alerts', { p_org: orgId, p_hours: 12 })
      if (alive) setRows((data as WeatherAlert[] | null) ?? [])
    }
    load()
    const id = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [orgId])

  if (rows.length === 0) return null
  return (
    <div className="weather-alerts" role="status">
      <strong>{t('Weather warnings today')}</strong>
      <ul>
        {rows.slice(0, 6).map((r) => (
          <li key={r.id} className={r.level === 'danger' ? 'weather-danger' : undefined}>
            {weatherAlertLine(r, t)} · {formatClockTime(r.created_at)}
          </li>
        ))}
      </ul>
    </div>
  )
}
