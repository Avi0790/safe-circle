export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  // Temporary-sharing window end (see lib/format.ts getShareStatus); null =
  // normal always-on sharing.
  share_until: string | null;
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
  speed: number | null;
  recorded_at: string;
}

export interface MemberWithLocation extends Profile {
  location: LatestLocation | null;
}

export interface Message {
  id: number;
  circle_id: string;
  user_id: string;
  body: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
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

export type WalkStatus = 'active' | 'arrived' | 'safe' | 'overdue';

export interface Walk {
  id: string;
  user_id: string;
  circle_id: string;
  place_id: string | null;
  place_name: string;
  expected_by: string;
  status: WalkStatus;
  created_at: string;
  profiles: { full_name: string } | null;
}

export interface RideRequest {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  status: 'open' | 'accepted' | 'cancelled';
  accepted_by: string | null;
  notified_count: number;
  created_at: string;
  requester: { full_name: string } | null;
  driver: { full_name: string } | null;
}
