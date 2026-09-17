export interface Circle {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
}

export interface LatestLocation {
  id: number
  user_id: string
  latitude: number
  longitude: number
  accuracy: number | null
  battery_level: number | null
  recorded_at: string
}

export interface MemberWithLocation extends Profile {
  location: LatestLocation | null
}

export interface Place {
  id: string
  circle_id: string
  name: string
  latitude: number
  longitude: number
  radius_meters: number
}

export interface GeofenceEvent {
  id: number
  event_type: 'arrived' | 'left'
  occurred_at: string
  places: { name: string } | null
  profiles: { full_name: string } | null
}

export interface Message {
  id: number
  circle_id: string
  user_id: string
  body: string
  created_at: string
  profiles: { full_name: string } | null
}

export interface SosEvent {
  id: number
  user_id: string
  latitude: number
  longitude: number
  message: string | null
  created_at: string
  profiles: { full_name: string } | null
}
