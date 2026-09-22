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
  // Temporary-sharing window end; null = normal always-on sharing.
  share_until: string | null
  status_emoji: string | null
  status_text: string | null
  status_expires_at: string | null
}

export interface LatestLocation {
  id: number
  user_id: string
  latitude: number
  longitude: number
  accuracy: number | null
  battery_level: number | null
  speed: number | null
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
  latitude: number | null
  longitude: number | null
  created_at: string
  profiles: { full_name: string; avatar_url: string | null } | null
}

export interface SosEvent {
  id: number
  user_id: string
  latitude: number
  longitude: number
  message: string | null
  created_at: string
  profiles: { full_name: string } | null
  sos_acknowledgements: { user_id: string; profiles: { full_name: string } | null }[]
}

export interface Walk {
  id: string
  user_id: string
  circle_id: string
  place_name: string
  expected_by: string
  status: 'active' | 'arrived' | 'safe' | 'overdue'
  profiles: { full_name: string } | null
}

export interface RideRequest {
  id: string
  user_id: string
  status: 'open' | 'accepted' | 'cancelled'
  created_at: string
  requester: { full_name: string } | null
  driver: { full_name: string } | null
}

export interface MapPin {
  id: string
  circle_id: string
  created_by: string
  emoji: string
  label: string
  latitude: number
  longitude: number
  expires_at: string
  created_at: string
  profiles: { full_name: string } | null
}
