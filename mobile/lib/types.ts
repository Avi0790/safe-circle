export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  // Temporary-sharing window end (see lib/format.ts getShareStatus); null =
  // normal always-on sharing.
  share_until: string | null;
  status_emoji: string | null;
  status_text: string | null;
  status_expires_at: string | null;
  // Only ever used for the "Text for help" SMS fallback — never shown
  // anywhere else in either app.
  phone_number: string | null;
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
  // direction of travel, degrees from north; null when still or unknown
  // (and on rows sent before migration ...000079)
  heading?: number | null;
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
  sos_acknowledgements: { user_id: string; created_at: string; profiles: { full_name: string } | null }[];
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

export interface LocationView {
  id: number;
  viewer_id: string;
  viewed_id: string;
  created_at: string;
  profiles: { full_name: string } | null;
}

export interface SosAcknowledgement {
  sos_event_id: number;
  user_id: string;
  created_at: string;
  profiles: { full_name: string } | null;
}

export interface HiddenFrom {
  owner_id: string;
  hidden_from_id: string;
  created_at: string;
  profiles: { full_name: string } | null;
}

export interface MapPin {
  id: string;
  circle_id: string;
  created_by: string;
  emoji: string;
  label: string;
  latitude: number;
  longitude: number;
  expires_at: string;
  created_at: string;
  profiles: { full_name: string } | null;
}

export interface Curfew {
  user_id: string;
  place_id: string;
  curfew_time: string;
  last_alerted_date: string | null;
}

export interface BackupContact {
  id: string;
  user_id: string;
  name: string;
  phone_number: string;
  created_at: string;
}

export type SafetyTimerStatus = 'active' | 'safe' | 'overdue';

export interface SafetyTimer {
  id: string;
  user_id: string;
  circle_id: string;
  label: string | null;
  expected_by: string;
  status: SafetyTimerStatus;
  created_at: string;
  profiles: { full_name: string } | null;
}

export interface MedicalCard {
  user_id: string;
  blood_type: string | null;
  allergies: string | null;
  conditions: string | null;
  medications: string | null;
  notes: string | null;
}

export interface ShareLink {
  id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  view_count: number;
  last_viewed_at: string | null;
}
