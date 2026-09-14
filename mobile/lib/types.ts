export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

export interface Circle {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

export interface LatestLocation {
  id: number;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  battery_level: number | null;
  recorded_at: string;
}

export interface MemberWithLocation extends Profile {
  location: LatestLocation | null;
}

export interface SosEvent {
  id: number;
  user_id: string;
  latitude: number;
  longitude: number;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  profiles: { full_name: string } | null;
}
