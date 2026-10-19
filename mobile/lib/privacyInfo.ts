export interface PrivacyAction {
  label: string;
  route: string;
}

export interface PrivacySection {
  id: string;
  emoji: string;
  title: string;
  body: string;
  action?: PrivacyAction;
}

// Every claim here maps to something enforced in the backend or the app —
// keep it that way. If a feature changes (e.g. join approval becomes the
// default), update this text in the same change.
export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: 'circle-only',
    emoji: '👪',
    title: 'Only people in your circle can see you',
    body:
      "Your location is visible only to people who share a circle with you. Joining takes an invite code that expires after 48 hours. This is enforced by the database itself (row-level security), not just hidden in the app — another account can't read your location by asking the server directly.",
  },
  {
    id: 'join-approval',
    emoji: '✅',
    title: 'Approve who joins',
    body:
      "If you created a circle, you can require your OK before anyone new joins, so a leaked invite code only creates a request you can deny. This is off by default — turn it on for circles you want locked down.",
    action: { label: 'Manage join approvals', route: '/join-requests' },
  },
  {
    id: 'ghost-mode',
    emoji: '👻',
    title: 'Hide from specific people',
    body:
      "Ghost mode hides you from chosen circle-mates while everyone else still sees you. Someone you've hidden from can't see your map pin, location history or drive reports, and gets no \"nearby\" alerts about you.",
    action: { label: 'Open Ghost mode', route: '/ghost-mode' },
  },
  {
    id: 'time-window',
    emoji: '⏱️',
    title: 'Share for a limited time',
    body:
      "In Settings → Share my location you can share for a set window instead of always. When it ends your circle can no longer see you — your own history stays yours.",
  },
  {
    id: 'who-checked',
    emoji: '👀',
    title: "See who's checked on you",
    body:
      "Safe Circle keeps a log of who looked at your location history, so checking on someone is never invisible.",
    action: { label: "Who's checked on me", route: '/location-views' },
  },
  {
    id: 'retention',
    emoji: '🗑️',
    title: 'Choose how long history is kept',
    body:
      "Pick 1, 7 or 30 days and a daily server job deletes older location points for you. Until you choose, history is kept.",
    action: { label: 'Location history settings', route: '/history-retention' },
  },
  {
    id: 'guest-links',
    emoji: '🔗',
    title: 'Guest links are narrow and expire',
    body:
      "A guest link lasts 15 minutes to 24 hours and you can revoke it any time. Whoever holds it sees only your latest location and first name — no history, no circle. Links are stored only as a hash, and you can see how many times each was opened.",
    action: { label: 'Guest tracking link', route: '/share-link' },
  },
  {
    id: 'work-shifts',
    emoji: '🦺',
    title: 'At work, only while you’re clocked in',
    body:
      "If you belong to a work organization, its admins and managers can see you only while you're clocked in, and only the positions recorded during that shift — never before you clock in or after you clock out. If you send an SOS while clocked in, your admins and the managers who oversee you are alerted too (never when you're off shift). If you choose check-in reminders and miss one, they're alerted with your last location. If your phone stops sending your location for about 20 minutes while you're clocked in, they're notified so they can check on you. If this ever changes, you're asked to accept the new version before anyone can see you again. A shift also ends by itself after 14 hours, other workers can't see you, and your Work tab lists every look at your location.",
  },
  {
    id: 'shared-trips',
    emoji: '🚗',
    title: 'Share a trip only when you choose',
    body:
      "When you use Directions, driving or walking, or tell your circle you're on a bus, train or flight, you can choose, trip by trip, to let one circle see where you're headed, whether you're driving or walking, and when you expect to arrive, and to be told when you get there. It shares the destination's name and your ETA, not your route or the destination's coordinates. It's off every time unless you switch it on, it follows Ghost mode and sharing windows, it disappears when you arrive or your phone goes quiet, and finished trips are deleted after 2 days. The notification text includes the destination name.",
  },
  {
    id: 'medical-card',
    emoji: '🩺',
    title: 'Medical card stays private until SOS',
    body:
      "Your medical card can be read by your circle only during an active SOS.",
    action: { label: 'Medical card', route: '/medical-card' },
  },
  {
    id: 'app-lock',
    emoji: '🔒',
    title: 'Lock the app',
    body:
      "In Settings → Lock the app you can require Face ID, fingerprint or passcode to open Safe Circle, so a borrowed phone can't be used to look at your family's locations.",
  },
  {
    id: 'your-data',
    emoji: '📦',
    title: 'Your data is yours',
    body:
      "Settings → Your data → Download my data gives you everything Safe Circle holds about you as a file. You can also delete your account, which removes your data.",
    action: { label: 'Delete my account', route: '/delete-account' },
  },
];

// Said plainly on purpose — a privacy screen that only lists strengths
// isn't one people can trust.
export const PRIVACY_LIMITS: string[] = [
  "Everyone in your circle can see your live location while you're sharing. That's the point of the app — use Ghost mode or a time window when you want a break.",
  'Drive reports and speed are visible to the same people who can see your location.',
  "At work, your managers and admins can see your location while you're clocked in — that's what clocking in means. Clock out and it stops.",
  "If an invite code leaks and join approval is off, whoever has it can join. Turn approval on for circles that matter.",
  "Map tiles (OpenStreetMap) and weather (Open-Meteo) come from free public services, which see the map area or coordinates requested — not your name or account.",
  "Directions: when you search for a place or plan a route, your current location and what you type go from your phone to free public OpenStreetMap-based services (Photon for search, OSRM for driving routes, and the FOSSGIS routing server for walking routes), not through Safe Circle's servers. They see the request, not your name or account.",
  "Places you save for Directions (Home, Work…) are stored only on your phone, under your account. They are never uploaded or shown to your circle, and they are deleted if you delete your account.",
];

export const PRIVACY_NOT_DONE = 'Safe Circle has no ads and no analytics or tracking SDKs.';
