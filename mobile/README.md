# Safe Circle — Mobile App

*Part of [Safe Circle](../README.md) — created and developed by **Surendra B K** ([@surendr7a](https://github.com/surendr7a)).*

React Native + Expo (TypeScript) app for the Safe Circle capstone project,
designed and built by Surendra B K. Covers everything the proposal (page 6)
split into two layers — auth screens, onboarding, circle create/join flows,
member list, settings, design system, and the background location engine
(permissions flow, tracking service, throttling, offline queue) — talking to
the Supabase backend in [`../backend`](../backend).

## What's here

- Full auth flow: sign up, sign in, sign out, **forgot password**
  (Supabase Auth). The reset link deep-links back into the app via
  `safecircle://reset-password` (`app/reset-password.tsx`, registered
  unguarded in the root layout so it works whether or not you're
  currently signed in) — `lib/passwordReset.ts` pulls the recovery
  tokens out of the URL fragment by hand, since the mobile Supabase
  client has `detectSessionInUrl: false` (that only auto-parses on web).
  **Needs a one-time manual step, not in git:** add
  `safecircle://reset-password` to this Supabase project's
  **Auth → URL Configuration → Redirect URLs** in the dashboard, or the
  reset email's link gets rejected. Verified the request path works
  end-to-end (see web's README for the confirmed run); the actual deep
  -link-back-into-the-app half needs a real device + a real inbox to
  fully verify, which wasn't available this session.
- Circle onboarding: create a circle (shows the invite code once) or join
  one with a code. **Belonging to more than one circle already worked
  end to end** — `CircleContext` always held a list plus a selection, and
  nothing on the backend assumes a single circle (SOS/ride requests scope
  by "shares *any* circle with you," not one active circle) — but the
  create-or-join screen (`circle-setup.tsx`) was only ever reachable while
  you had zero circles, so there was no way to add a *second* one. That
  screen's flow is now `components/CircleOnboarding.tsx`, shared with the
  new Settings → **Add another circle** (`app/(app)/add-circle.tsx`),
  reachable any time.
- Live map + member list, sourced from the same `latest_locations` view
  and realtime subscription the web dashboard uses (roster changes —
  someone joining, leaving, or being removed — are live too, via a
  `circle_members` subscription). Circle creators see a **Remove** action
  on other members in the Members tab, backed by the
  `circle_members_delete_by_creator` RLS policy.
- Settings: a **Share my location** toggle that starts/stops real
  background tracking, an editable display name, per-circle **Rename**/
  **Delete** (creator) or **Leave** (everyone else), generate/regenerate an
  invite code, sign out.
- **Background location engine** (`lib/locationTracking.ts`,
  `lib/locationQueue.ts`) — the proposal's highest-risk piece:
  - Foreground *and* background permission requests
    (`requestForegroundPermissionsAsync` → `requestBackgroundPermissionsAsync`,
    in order — background is requested only if foreground is granted).
  - Throttled to 50m / 60s via `expo-location`'s `startLocationUpdatesAsync`
    + `expo-task-manager`, matching the proposal's spec (page 4).
  - Reports real battery level (`expo-battery`) alongside each ping.
  - Offline queue: failed inserts (no network) are persisted to
    `AsyncStorage` and retried as a batch — both opportunistically (every
    new location fix) and immediately when `@react-native-community/netinfo`
    reports connectivity restored.
  - The task is registered unconditionally at module scope
    (`TaskManager.defineTask`) and imported once from `app/_layout.tsx`,
    per Expo's requirement — this is what lets it keep running, and be
    relaunched by the OS, even after the app is fully closed.
  - Guarded to no-op safely on web (`Platform.OS !== 'web'`) — background
    location doesn't apply there and this app doesn't target web anyway.
  - **Foreground fallback**: alongside the real background task, a plain
    `watchPositionAsync` loop runs whenever the app is in the foreground
    (paused/resumed via `AppState`). This is what actually delivers
    updates in Expo Go, where the background task silently never fires —
    confirmed by testing on a real device. It needs its own persisted
    "sharing enabled" flag (`AsyncStorage`, separate from the OS-managed
    background task state) so it resumes correctly after an app restart;
    `resumeForegroundWatchIfActive()`, called once from `app/_layout.tsx`,
    handles that. In a real development/production build this runs
    alongside the true background task and hands off cleanly, since it
    pauses the instant the app backgrounds. Settings shows which mode is
    actually active ("Runs in the background..." vs "Sharing while the
    app is open...").
- **Places** (`app/(app)/places.tsx`, reachable from Settings) — the
  geofencing stretch goal (proposal page 3). The backend side
  (`places`/`geofence_events` tables, the `evaluate_geofences` trigger, the
  `send-geofence-push` Edge Function) existed already; this is the UI that
  makes it usable: add, rename, resize, or remove a place (creator-only for
  the last three), and a live "who arrived/left where" activity feed. Each
  place also shows **"Here now"** — who's actually inside it at this
  moment, not just the history feed — sourced from
  `place_membership_state`, a table the trigger already kept accurate but
  that no client had ever read; also added to the realtime publication
  (`...000015_place_membership_realtime.sql`) so it updates live. Same
  feature on the web dashboard's place popups. Each place also gets a
  Life360-style icon (`lib/places.ts`'s `placeIcon`) inferred from its
  name (🏠 Home, 🏫 School, 💼 Work, else 📍) — no category column or
  extra input step needed, since the name's already typed.
- **Push notifications** (`lib/pushNotifications.ts`) — a real on/off
  Switch in Settings, not enable-only: it checks `push_tokens` on load to
  reflect whether this account already has one registered, and off calls
  `deregisterPushNotifications()` (the same cleanup sign-out uses).
  Registering gets an Expo push token and upserts it into `push_tokens`, so
  `send-geofence-push`/`send-sos-push` have somewhere to deliver alerts.
  Expo push tokens are scoped to an EAS project id, so this needed the
  project registered with EAS (`eas init`) first — **done**:
  `@suren.7a/safecircle` (`app.config.js`'s `extra.eas.projectId` /
  `owner`). It still fails gracefully with a specific message rather than
  crashing if that's ever missing (e.g. a fork under a different EAS
  account). Also guarded to no-op on web (`expo-notifications` doesn't
  support that platform). Getting a *real* token still needs a physical
  device or simulator — `Notifications.getExpoPushTokenAsync()` is native
  -only regardless of EAS being configured, so this is in the same "needs
  a device to fully verify" bucket as the map and background GPS (see
  Verification notes).
- **Location history** (`app/(app)/member/[userId].tsx`, tap a member on
  the Members tab) — the other stretch goal from the proposal's page 3.
  Shows a member's last 100 pings as a map trail (`Polyline` + oldest/most
  -recent markers) plus a scrollable list with timestamps, coordinates,
  and battery. `locations` was already append-only, so this needed zero
  backend changes — purely a new read. Also shows a "🚗 Max speed" stat
  (beyond the proposal) now that `locations.speed` is captured, plus
  per-ping speed on any point where it clears the driving threshold.
  Same web-unsupported-map pattern
  as the Map tab: `[userId].web.tsx` is a list-only fallback.
- **Drive reports** (🚗 Recent drives, on the same location-history screen)
  — actual trips, not just a live "driving" status: start time, duration,
  distance, and top speed, going beyond Life360's paywalled Driver
  Reports for free. `lib/trips.ts`'s `fetchTrips()` calls the backend's
  `get_trips()` RPC (`backend/supabase/migrations/...000047_drive_reports.sql`),
  which groups a user's `locations` pings into sessions via a classic SQL
  "gaps and islands" query — a >15 min gap between pings starts a new
  session — keeps only sessions containing at least one driving-speed
  ping, and aggregates each into a trip (distance summed via the same
  `haversine_meters()` the backend already uses for nearby-alerts).
  Being a `security definer` function that reads `locations` directly, it
  re-implements the table's own RLS visibility check by hand (self, or a
  circle-mate who's still sharing and hasn't hidden you — see
  `locations_select_self_or_circlemate`) so it can't leak a Ghost-Mode
  -hidden or stopped-sharing person's trip history through a side door;
  verified in a rolled-back transaction (two-trip + one-stationary-session
  fixture; self, circle-mate, outsider, hidden, and share-ended access all
  checked). Like the live driving status, this is a rough vehicle signal
  from GPS speed, not real trip/crash detection — slowing down in traffic
  doesn't split a trip, only an actual gap in pings does.
- **SOS button** (`components/SosButton.tsx` + `SosBanner.tsx`, on the Map
  tab) — the proposal's last stretch goal. One tap (after a confirm
  dialog, to avoid accidental fires) shares your current location as an
  `sos_events` row, which alerts everyone across every circle you're in
  via the same pg_net-triggered push pattern as geofencing
  (`send-sos-push` Edge Function). A red banner shows any active SOS —
  yours or a circle-mate's — with a resolve button, live via realtime.
  `hooks/useActiveSosEvents.ts` reads it. The confirm dialog also offers
  **"Call 911"** alongside Cancel/Send SOS — beyond the proposal, and
  deliberately placed on the same dialog the one-tap design already
  required rather than a separate button, so it adds zero extra taps to
  the existing flow. (Deliberately *not* added: a message field on SOS —
  `sos_events.message` exists but nothing sets it, and adding a text
  -entry step before an emergency alert would work against the "one-tap,
  confirms first" design this button's own comment documents as
  intentional.)

That's the full proposal — MVP and all three stretch goals (geofencing,
location history, SOS) — built end to end.

- **Chat** (`app/(app)/(tabs)/chat.tsx`, `hooks/useCircleMessages.ts`) —
  beyond the proposal: a Life360-style in-circle group chat, since sharing
  location and alerts but having no way to actually talk was a real gap.
  Deliberately simple and append-only, same philosophy as
  `locations`/`sos_events` (see `backend/supabase/migrations/
  ...000016_messages.sql`): no edit, no delete, no read receipts. Live via
  realtime; relies entirely on the realtime INSERT event to append a sent
  message (including your own), rather than also appending it locally, so
  a message can never show up twice. Also pushes to the rest of the
  circle when sent (`...000017_message_push.sql`, `send-message-push`
  Edge Function) — same pattern as geofence/SOS, so a message sent while
  you're not looking at the Chat tab isn't silent like it would've been
  otherwise. An unread-count badge on the tab (`contexts/ChatReadContext.tsx`)
  tracks a per-circle "last read" watermark in `AsyncStorage`
  (`lib/chatReadState.ts`, device-local, not synced) — lives in a context
  wrapping the tab navigator, not a plain hook, specifically so the Chat
  screen's `markRead()` (called on focus and on every new message while
  focused — tabs stay mounted in the background, so this screen keeps
  receiving messages via realtime even when another tab is in front)
  clears the same count the tab bar itself reads, instead of two
  independent hook instances drifting out of sync. Read-only on the web
  dashboard (`ChatFeed.tsx`) — sending
  stays mobile-only, matching that dashboard's view-only design.
- **Avatars** (`lib/avatar.ts`, `components/Avatar.tsx`) — also beyond the
  proposal: everywhere a member shows up, including as custom map markers
  replacing the default pin — the Life360 "who's who at a glance" look.
  Shows the member's **profile photo** when they've set one, otherwise
  colored initials (deterministic per-person color hashed from user id).
- **Profile photos** (`lib/avatarUpload.ts`, Settings → Profile photo) —
  pick from your library, square-crop, and it's shrunk to 512px JPEG
  (`expo-image-manipulator`, ~30-80 KB) before upload to the public
  `avatars` storage bucket under your own `<user id>/` folder (RLS in
  migration `...000023_avatar_photos.sql`; a fresh path per upload so
  image caches never serve the old photo, and the replaced photo is
  deleted). `profiles.avatar_url` points at it, and a `profiles` realtime
  subscription in `useCircleMembers` makes a new photo appear for the rest
  of the circle live. Map markers keep tracking view changes until the
  photo has drawn (`MemberMarker` in the Map tab) — a marker's bitmap is
  otherwise frozen before an async image arrives. `expo-image-picker` and
  `expo-image-manipulator` are both in Expo Go, so no dev build needed.
- **Driving status and distance** (`lib/format.ts`'s `isDriving`/
  `speedToMph`, `lib/geo.ts`'s `haversineMeters`) — also beyond the
  proposal. expo-location's `LocationObject.coords.speed` (ground speed,
  m/s) was already available on every fix but never captured; now stored
  (`locations.speed`, `...000018_location_speed.sql`) and shown as
  "🚗 Driving NN mph" in place of the usual "Updated Xm ago" once it
  clears a 15mph threshold — a rough "probably in a vehicle" signal from
  a single GPS fix, not real trip/crash detection, so it's deliberately
  conservative to avoid mislabeling a jog or bike ride. The Members tab
  also shows "N.N mi away" for each other member, measured from your own
  latest location — a client-side mirror of the backend's own
  `haversine_meters()` formula.

- **Nearby alerts** (Settings switch, `profiles.nearby_alerts`, opt-in) —
  beyond the proposal: a push when a circle-mate comes within ~500 m, so
  you don't have to look at the map while driving. Decided server-side by
  a trigger on every location insert (`...000019_nearby_alerts.sql`,
  `evaluate_nearby()`), which tracks each pair in `nearby_pairs` and fires
  the `send-nearby-push` Edge Function only on a far -> near transition.
  Speed-aware (`...000020_nearby_speed_aware.sql`): the trigger radius is
  ~45 s of the two people's combined travel, clamped to 500-3000 m — 500 m
  on foot, ~1.1 km if one of you is at ~56 mph, ~2.2 km for two cars —
  since fixes arrive up to a minute apart and a fixed 500 m would land
  after you'd already passed. It re-arms at 1.6x that radius (min 800 m,
  hysteresis) so GPS jitter at the edge can't alert every minute; the other
  person's speed only counts if their fix is under 2 minutes old, and only
  fixes under 10 minutes old are compared at all. It reveals nothing circle-mates can't already see on the
  map. Verified by running the trigger in a rolled-back transaction on the
  hosted DB (100 m -> near, 7 km -> far, no data left behind); the actual
  push delivery needs two real devices with push enabled.

- **Low-battery push** (no UI — server-side, `...000021_low_battery_push.sql`,
  `send-battery-push`) — beyond the proposal: the apps already flag a low
  battery (<= 20%) but only if you're looking; a dead phone is the main
  reason someone silently drops off the map, so the circle gets a push
  ("Ana's phone is at 12%"). Stateless dedupe: a trigger (with a `WHEN`
  clause so it's off the hot path) only fires if that person has had no
  other low-battery ping in the last 2 hours, so it alerts on entering
  "low" rather than every ping, and not again if the level flaps around
  20%. Verified on the hosted DB in a rolled-back transaction (healthy
  ping -> nothing, first low -> exactly one push, second low -> none).
- **Temporary sharing** (Settings → Share my location: Until I stop / 1 h /
  2 h / 8 h; `lib/sharingWindow.ts`) — beyond the proposal, and the opposite
  of Life360's always-on model. The window is set on the server and enforced
  there (see `backend/README.md`); the phone mirrors the end time in
  AsyncStorage so it also stops tracking on its own, including from the
  background task. If the server refuses a ping (RLS `42501`, only possible
  once the window closed) the queue is dropped instead of retried forever.
  Members and the map show "sharing until 4:15 PM" / "Stopped sharing".
- **Walk me home** (Map tab → 🚶 Walk me home, `app/(app)/walk.tsx`) —
  pick a saved place and 10–60 min; it turns on location sharing for the
  walk if needed. The circle sees a banner, is pushed on arrival, and if the
  timer runs out an SOS goes out automatically (server-side, see
  `backend/README.md`). "I'm safe" and "+10 min" on the walk screen and
  banner; a local notification (`lib/walkReminder.ts`) warns 2 min before
  the deadline, even offline.
- **Need a ride** (Map tab → 🚗 Need a ride, `lib/rides.ts`,
  `RideBanner`) — alerts only circle-mates who are driving nearby; if
  nobody is, offers to ask the whole circle. Anyone can tap "I'll go"
  (first wins) and gets a Directions link; the requester sees who's coming.
- **Check in** (the 📍 button beside the chat composer) — beyond the
  proposal, Life360-style: a chat message that also carries where you are
  (`messages.latitude/longitude`, `...000022_message_location.sql`), shown
  with a "View on map" link (Google Maps universal URL, works on iOS and
  Android) on both the app and the web dashboard's read-only feed. It's an
  ordinary message, so it reuses the message push and unread badge, and
  exposes nothing circle-mates couldn't already see.
- **Who's checked on me** (Settings → Privacy → Who's checked on me,
  `app/(app)/location-views.tsx`) — a log of when a circle-mate opened your
  location history (`app/(app)/member/[userId].tsx` calls
  `record_location_view` on mount, deduped server-side to once per 15 min).
  Not every glance at the live map, which is everyone, all the time, and
  would just be noise — this is specifically someone pulling up your
  history.
- **Auto-delete history** (Settings → Privacy → Location history,
  `app/(app)/history-retention.tsx`) — pick 1, 7 or 30 days, or forever.
  A daily server job actually deletes the old rows (see
  `backend/README.md`); your current pin is never affected by this, however
  old it gets.
- **SOS acknowledge + escalation** (`SosBanner.tsx`'s "I'm on my way"
  button) — a circle-mate acknowledging tells the sender who's responding
  (shown as "👀 Bob is on it" on the sender's own banner); if nobody does
  within 3 minutes, the whole circle is pushed again automatically
  (server-side `pg_cron`, see `backend/README.md`) instead of a first push
  nobody saw just sitting there unanswered.
- **Quick status** (Settings → Quick status; Members list, map marker;
  `lib/status.ts`) — a chip like "🚗 On my way" or "📚 Studying" next to
  your name, from a fixed picklist so there's no free-text moderation
  problem. Expires after 4 hours on its own (checked client-side via
  `isStatusActive`), or tap the same chip again to clear it early.

**Not yet verified on real phones:** the four features above were built
and their backend logic tested on the hosted DB (see `backend/README.md`),
but the screens themselves need a device. Who's-checked-on-me and quick
status are the easiest to try solo; SOS acknowledge and escalation need a
second account to acknowledge from.

- **Auto status from places** — arriving at a saved place sets your quick
  status on its own ("🏠 Home", "📚 In class") and clears it when you leave;
  entirely server-side (see `backend/README.md`'s `apply_auto_status()`), so
  there's no mobile code for this beyond the existing status-chip display.
  Never overrides a status you set yourself in Settings.
- **Shake for SOS** (Settings → Shake for SOS; `lib/shakeDetector.ts`,
  `hooks/useShakeToSos.ts`) — shake the phone hard a few times to bring up
  the same SOS confirm dialog as the button, for when the phone's in a
  pocket or bag and finding the button isn't realistic. Off by default
  (opt-in switch) — always-on shake detection would risk firing from an
  ordinary bump (running, a car door), which is the wrong failure mode for
  something that pages the whole circle. `ShakeDetector` (the gesture
  logic: N hard jolts within a window, then a cooldown) is a plain class
  with no dependency on the accelerometer, so it's unit-tested directly
  (`lib/__tests__/shakeDetector.test.ts`) rather than needing a device or a
  sensor mock; `useShakeToSos` is the thin `expo-sensors` wiring on top.
  Reads via `expo-sensors` (`NSMotionUsageDescription` in `app.config.js`);
  works in Expo Go, no dev build needed.
- **Weather where they are** (member detail screen, both native and web
  variants; `lib/weather.ts`) — the temperature and conditions at a
  member's most recent location, e.g. "🌧️ 58°F, Rain" — something no
  Life360-style app shows, and genuinely useful ("why did they stay in").
  Uses Open-Meteo (open-meteo.com), free and keyless, so it's a plain
  client-side fetch with no backend involvement; fails silently (just
  doesn't show) rather than surfacing an error on a screen that's mainly
  about location history. The web dashboard shows the same thing for the
  currently-expanded member.
- **Ghost mode** (Settings → Privacy → Ghost mode, `app/(app)/ghost-mode.tsx`)
  — a per-person switch to hide your location from one specific circle-mate
  while everyone else still sees you normally. No Life360 equivalent
  (circle-wide sharing is all-or-nothing there). The hidden person's map
  just shows your dot missing — indistinguishable from an ordinary sharing
  gap — and only you can see your own hide-list (see `backend/README.md`).
- **Meetup pins** (Map tab → 📍 Drop a pin, `app/(app)/drop-pin.tsx`,
  `hooks/useMapPins.ts`) — drop a temporary "meet here" marker at your
  current location for a festival, a trailhead, a campus meetup — anything
  not worth saving as a permanent place. Pushes to the rest of the circle,
  expires on its own (1–24h, chosen when dropping it), and only the person
  who dropped it can remove it early (tap the marker). Shown on both the
  mobile map and the web dashboard's.
- **Curfew** (Settings → Curfew → Set curfew, `app/(app)/curfew.tsx`) —
  "alert my circle if I'm not home by 10pm," set once and then automatic.
  Picks a saved place and a time from chips (no native time-picker
  dependency, matching the chip pattern used for walk durations and sharing
  windows elsewhere in the app). Entirely server-side after that, checked
  in the phone's own time zone, which the app sends when saving (migration
  `...000070`; it used to be compared with UTC).

**Not yet verified on real phones:** ghost mode, meetup pins, and curfew
were built and their backend logic tested on the hosted DB, but the screens
themselves need a device. Ghost mode and curfew are easy to try solo (with
a second test account to confirm the hiding/alerting actually happens);
meetup pins are easiest with two phones so a push can be seen arriving.

- **Text for help** (Map tab → ⋯ Quick actions → 📲 Text for help,
  `lib/textForHelp.ts`) — a fallback that works when push can't: every
  other alert here depends on this phone and Supabase both having
  internet at once, and SMS can get through in places data can't. Picks
  from circle-mates who've added a phone number (Settings → Phone number)
  and/or personal backup contacts (Settings → Backup contacts →
  `app/(app)/backup-contacts.tsx`), then opens the native SMS composer
  (`expo-sms`) with a message and a Google Maps link to your current
  location — same as "Call 911" already does for phone calls, it composes
  but never silently sends; you still tap send.
- **Check on me** (⋯ Quick actions → ⏱️ Check on me,
  `app/(app)/safety-timer.tsx`) — Walk me home's sibling for when there's
  no destination: studying alone, a first date, a solo hike. Set a timer
  and an optional note; if you don't tap "I'm safe" in time, an SOS goes
  out automatically at your last known location, the same protection Walk
  me home gives for when you can't act.

With five actions beyond the map now (walk, check-on-me, ride, drop-pin,
text-for-help), `QuickActions.tsx` changed from three stacked pills to a
single "⋯ Quick actions" toggle that opens a small menu — stacking five
separate pills would have covered too much of the map.

**Not yet verified on real phones:** text for help and check-on-me were
built and (for check-on-me) tested end-to-end on the hosted DB with real
location inserts, but the SMS composer itself and the check-on-me screens
need a device — `SMS.isAvailableAsync()` always returns `false` on the iOS
simulator, so text-for-help specifically needs physical hardware to try at
all.

- **Join approvals** (Settings → Join approvals, `app/(app)/join-requests.tsx`;
  join flow in `circle-setup.tsx`) — creators can require their OK before a new
  member joins, so a leaked invite code can't add a stranger. Joiners see a
  "Request sent" screen and a push when decided.
- **Medical card** (Settings → Medical card, `app/(app)/medical-card.tsx`) —
  circle-mates see it only during your active SOS, via a "🩺 Medical" button on
  the SOS banner (enforced by RLS, see `backend/README.md`).
- **Guest tracking link** (Settings → Guest tracking link,
  `app/(app)/share-link.tsx`) — create a 1/4/24 h link and hand it to the share
  sheet; see who's opened it and revoke it. Needs the web dashboard deployed for
  links to work off your network (`EXPO_PUBLIC_WEB_URL`).

**Not yet verified on real phones:** these three screens. The backend rules
are tested, and the guest page they link to was checked in a browser.

**Performance note:** the Map, Members and Chat tabs are all mounted at once
(React Navigation keeps them alive), and each used to run its own copy of the
members hook — three sets of queries and twelve realtime channels, refetched
three times over on every profile or membership change (including the automatic
status updates when someone arrives somewhere). `contexts/CircleMembersContext.tsx`
now owns one shared copy with a single realtime channel and debounces bursts of
events into one refetch; `hooks/useCircleMembers.ts` just reads it. Expo Go in
development mode is also inherently slower than a real build, and running over
`--tunnel` adds latency of its own.

- **Your data** (Settings → Your data): **Download my data**
  (`lib/dataExport.ts`) writes `export_my_data`'s result to a real
  `safecircle-data-<date>.json` file (`expo-file-system`) and hands it to
  the native share sheet (`expo-sharing`) — not React Native's plain
  `Share.share({ message })`, which only ever offers to *send* the text
  somewhere (Mail, Messages, copy). iOS only offers "Save to Files" for an
  actual document, so the first version of this (plain-text share) could
  never actually be saved to reopen later; this can. **Delete my account**
  (`app/(app)/delete-account.tsx`, type DELETE to confirm) removes the account,
  stopping location sharing and removing the profile photo first. Creators of
  shared circles hand them over automatically (see `backend/README.md`).
- **Account type at signup** (`components/AccountTypePicker.tsx`,
  `lib/accountType.ts`, `contexts/AccountContext.tsx`) — a three-way choice:
  *Just me*, *Family & friends* or *Work crew*, stored as
  `profiles.account_type` (set from the signup metadata by the profile
  trigger; anything missing or unrecognised becomes `family`, so existing
  accounts behave exactly as before). It decides first-run routing:
  family → create/join a circle (unchanged); work crew → create an
  organization or join with a code and accept the disclosure
  (`components/OrgOnboarding.tsx`, backed by the organizations migration);
  individual → straight into the app with no circle. The app's entry rule
  moved from "has a circle" to `canEnterApp()` (circle, active organization
  membership, or an individual account). It is a routing preference, not a
  security boundary — what anyone can see is still decided only by the
  circle and organization rules. Settings now handles having no circle. See the
  Work tab entry below for the clock-in side.
- **Work tab and clock-in** (`app/(app)/(tabs)/work.tsx`, `lib/clockIn.ts`,
  `lib/shift.ts`) — shown only to people who belong to an organization
  (work-crew accounts open on it). A worker sees a clear On shift / Off
  shift status, a big Clock in / Clock out button (clocking in confirms
  first: "your admins and managers can see your location until you clock
  out"), the time the shift auto-ends (14 h), and **who's looked at you**
  (admin/manager name, role, what they did, when — from `org_my_views`).
  Clocking in starts location sharing and clocking out stops it, *but only
  if clocking in is what started it*, so a worker's own always-on sharing
  isn't switched off at the end of a shift; sharing is stopped on the phone
  before the clock-out is recorded, so it ends even with no signal. In Expo
  Go sharing is foreground-only, and the screen says so ("keep Safe Circle
  open during your shift"). Workers who changed what they've agreed to see an
  **updated-disclosure card** (review and accept; until then they can't clock
  in and nobody can see them). **Check-in reminders** (`lib/clockIn.ts`,
  `lib/checkinReminder.ts`): choose No check-ins / every 30 min / hour / 2 hours
  before clocking in; the tab then shows when the next one is due and an
  **I'm OK** button, an on-device notification fires 5 minutes before it's due
  (so it works with no signal), and a missed one alerts the people who oversee
  you with your last location. Separately, everyone clocked in is covered by the
  quiet-phone alert: if the phone stops sending for about 20 minutes, the
  people who oversee you are notified. "Download my data" now includes your work
  history. Workers get the SOS button on this tab, and
  everyone who oversees a worker sees their active SOS banner here and on the
  Crew screen (with the same "on my way" and resolve actions); it reaches
  managers only if the worker was clocked in when they sent it. Owners and
  admins can also get a new crew invite code here.
- **Crew view for owners, admins and managers** (`app/(app)/crew.tsx`,
  `crew-worker.tsx`, `components/CrewMap.tsx`, `lib/crew.ts`) — opened from
  the Work tab. A live map and list of who's clocked in, refreshed every 30 s
  while the screen is open: last heard from, a "may be offline" warning when
  a clocked-in phone has gone quiet for 15 min, low battery, and driving
  speed. Off-shift workers are listed by name only (no location exists to
  show) and workers who haven't accepted the disclosure appear as "waiting to
  accept". Tapping a worker shows their last 24 hours of **on-shift** path and
  their recent shifts. Admins see everyone; a manager sees only workers on
  teams they lead (enforced in the database, not the screen). Every read goes
  through `org_roster` / `org_live_roster` / `org_worker_track` /
  `org_shifts`, so each look is logged for the worker to read, and the screen
  tells the manager so. The map mounts only once there's something to frame
  (same race fix as the Map tab); web gets the list without a map, since
  `react-native-maps` has no web renderer. **Manage people & teams**
  (`app/(app)/crew-manage.tsx`, `lib/teams.ts`, owners and admins, from the
  Work tab): everyone in the organization with their role (tap to change it
  or remove them), plus creating teams, adding people, making a manager a
  team's lead, taking people off, and deleting teams. The buttons mirror the
  database's rules (owners can change anyone's role and remove anyone; admins
  move workers and managers between those two roles and remove only those),
  and the database is what actually refuses anything else. A manager only sees
  workers on a team they lead, so the setup is: make someone a manager, add
  them to a team as lead, add their workers. Verified against the live
  database in a rolled-back transaction using the exact calls the screen
  makes: an admin reads teams and members, a lead manager sees the team's
  members and the clocked-in workers on it (not clocked-in workers on no
  team), a worker sees only their own team row, an outsider sees nothing,
  and taking someone off a team immediately hides them from that manager.
  Not yet built: SOS to managers and the web dashboard version.
- **How your privacy works** (Settings → Privacy, `app/(app)/privacy.tsx`,
  content in `lib/privacyInfo.ts`) — a plain-language tour of what protects
  you (circle-only visibility enforced by row-level security, Ghost mode,
  time windows, join approval, who-checked log, auto-delete, guest-link
  limits, medical card only during SOS, app lock, data export/deletion),
  each with a button to the screen that controls it, plus an "honest
  limits" list (circle-mates see you while sharing; join approval is off by
  default; map/weather come from public services). Every claim was checked
  against the migrations when written, and a test asserts every button's
  route exists and is registered so the screen can't point at nothing. The
  in-app Help also answers "how is my privacy protected?".
- **Directions** (⋯ Quick actions → 🧭 Directions, `app/(app)/drive.tsx`,
  `lib/navigation.ts`, `lib/routing.ts`, `lib/geocode.ts`, `components/DriveHud.tsx`)
  — a Google/Apple-Maps-style drive: it starts from your current location, you
  search for a place (or pick one of your circle's saved places), see the route
  with its distance, time and arrival, then **Start** for turn-by-turn text and
  voice, a live **speedometer** (mph, from the phone's GPS at full rate while
  navigating), distance and time remaining, automatic **rerouting** if you leave
  the route, and arrival. The screen stays awake while navigating, and *Open in
  Maps app instead* hands the destination to Apple/Google Maps if our routing
  can't be reached. **Free and keyless:** routes from OSRM, place search from
  Photon (both OpenStreetMap data), voice from the phone's own text-to-speech
  (`expo-speech`). **Safety:** you can't type a destination while the vehicle is
  moving (about 5 mph); the screen says to ask a passenger or pull over, and the
  driving view has only mute and end. **Honest limits:** the public OSRM and
  Photon servers are shared community services (demo-grade; set
  `EXPO_PUBLIC_OSRM_URL` / `EXPO_PUBLIC_GEOCODER_URL` to your own before real
  use); there are no live traffic or speed-limit signs (neither is available free
  and keyless); it works while the screen is open, not as a background navigator;
  and the request, including your location and search text, goes from the phone
  to those services, which the Privacy screen says. The maths (position along
  the route, next turn, off-route, voice prompts) is plain functions with tests,
  and one test drives a real captured 8.3 km route through the actual screen
  with simulated GPS, checking the speed readout, spoken turns, arrival and
  rerouting. **Share my ETA:** on the route preview, if you're in a
  circle, a switch (off every time) shares the trip with it: the people in that
  circle see "Sam is heading to Walmart, arriving in about 12 min" on their Map
  tab (`components/TripBanner.tsx`, `hooks/useActiveTrips.ts`), get a push when
  you start and when you arrive, and see the ETA stay current while you drive
  (`lib/sharedTrips.ts`; an update goes up when the ETA moves a minute or on a
  heartbeat, never more than once a minute). Only the destination's name and the
  ETA are shared, not the route or its coordinates; Ghost mode and sharing
  windows apply; stopping navigation, leaving the screen or losing signal ends
  it. If sharing can't start, directions carry on and say so. The Privacy screen
  covers it. The web dashboard shows these trips too (read-only).
  **Walk mode** (🚗 Drive / 🚶 Walk toggle on "Where to?", remembered per
  device in `lib/travelMode.ts`): the same screen for when you can't drive.
  Routes come from the free FOSSGIS foot-profile OSRM server
  (`routing.openstreetmap.de/routed-foot`, override with
  `EXPO_PUBLIC_OSRM_FOOT_URL`) because the public demo server only knows cars
  and answers a walking request with a car route. Prompts are walking-sized (a
  turn is announced at about 400 ft, saying the real distance, then at about
  100 ft instead of "a quarter mile"), the speedometer becomes a pace with one
  decimal, the camera looks straight down, and the typing lock for a moving
  vehicle doesn't apply. "Open in Maps app" asks for walking directions. A
  shared trip records whether it is a drive or a walk (backend migration
  `...000059`), so circles see "🚶 Sam is walking to the library". Tested
  against a real captured walking route (`walkSimulation.test.ts`).
  **Transit** (third option on the toggle): there's no free, keyless transit
  routing, so tapping a place opens the phone's Maps app with transit
  directions (Apple Maps `dirflg=r`; on Android a Google Maps universal link,
  since `google.navigation:` has no transit option). The typing lock for a
  moving vehicle doesn't apply, since you're a passenger.
- **Navigation view** (`components/DriveHud.tsx`), laid out like Google
  Maps: the next turn in a green card with its arrow
  (`navigation.maneuverGlyph`: ↱ ↰ ↗ ↖ ↻ 🏁 …) and a "Then" tab for the turn
  after; status pills under it (incident ahead, sharing, live link, via a
  stop); round buttons down the right (compass: heading up / north up;
  🔍 add a stop; sound: quick mute; route overview, which shows the rest of
  the route and stops following until Re-center) and a Report pill; a speed
  bubble bottom-left; and a dark sheet with the time left in green, distance
  and arrival, and a red Exit. While navigating you're a **vehicle** instead
  of the blue dot (`components/VehicleIcon.tsx`, `VehicleMarker.tsx`):
  the avatar you pick (below), **tilting and turning with the map**
  (`lib/avatarPose.ts`, `TiltedAvatar.tsx`, `VehicleMarker.tsx`). On Android
  (Google Maps) the marker lies flat on the map natively. On iPhone (Apple
  Maps) a marker can't: react-native-maps' `flat` and `rotation` are
  Google-only there, so the drawing itself is turned by your heading
  relative to the map's heading and laid back in perspective by the map's
  tilt. To show the car's **sides at low angles** it is built by "sprite
  stacking" (`CarSlices.tsx`): about a dozen horizontal slices (shadow and
  beams on the road, wheels, body sides darkening towards the road, the car's
  top at waist height, a graded band of windows, the roof; the race car has
  tall wheels, a raised helmet and a high wing), each lifted up the screen by
  its height × sin(tilt) (`avatarPose.sliceLift`). Straight down they line up
  into the top-down drawing; tilted, the side profile, windows and wheels
  appear from whichever way the car faces. The arrow stays flat.
  The screen knows the camera it asked for, and re-reads the real camera
  after any map movement (including your own pinch/rotate). The heading
  comes from the GPS, or from your last two positions when it gives none,
  and is kept when you stop (`lib/vehiclePreference.ts`).
  Walking shows a green walker arrow.
- **Smooth movement**: between GPS fixes (about one a second) the avatar
  glides to each new position over the time since the previous fix, on
  react-native-maps' `AnimatedRegion` + `MarkerAnimated`, so the stacked
  drawing isn't re-rendered every frame; the camera uses the same duration so
  the car stays centred. Turns are eased the short way round (an `Animated`
  value on the native driver, `lib/glide.ts`). Jumps over 250 m (GPS glitch,
  tunnel) snap, and with Reduce Motion on everything snaps. (Android's native
  marker rotation isn't eased.)
- **Map Modes** (`lib/mapMode.ts`, `components/MapModesSheet.tsx`), like Apple
  Maps': Explore, Driving (muted map, live traffic, fewer pins), Satellite
  (Labels on/off) and 3D Flyover (Apple's photo-realistic 3D where Apple has
  it; Terrain on Android), with a Traffic switch. From the Map tab's map
  button and from navigation's options card; one saved choice for both. The
  old satellite toggle carries over. Apple's Transit mode isn't available
  through react-native-maps, so it isn't offered.
- **Choose driving avatar** (`components/AvatarPicker.tsx`), like Google
  Maps': opened from Options → Driving avatar or by tapping your car on the
  map. Swipe through seven avatars (navigation arrow, sports car, compact,
  classic, race car, sedan, off-road); the middle one stands on a glowing
  platform. Eight named colours (Polar white, Night black, Slate grey, Coral
  red, Ocean blue, Sunshine yellow, Deep teal, Orchid); Done saves, ✕ keeps
  what you had, Reset goes back to the blue arrow. The avatars are drawn with
  `react-native-svg` (in Expo Go; a dev build needs one rebuild), not 3D
  models: a shaded three-quarter view in the picker (`AvatarArt.tsx`) and a
  top-down view on the map (`VehicleIcon.tsx`) with curved-body shading,
  tinted glass, fading headlight beams and taillights, so any colour works
  and no art is downloaded. Choices from the earlier set carry over (SUV and
  pickup become off-road, and so on).
- **Lane guidance**: OSRM sends turn lanes for junctions mapped with
  OpenStreetMap `turn:lanes` (the manoeuvre's first intersection). Within
  half a mile of such a turn the green card shows one arrow per lane with the
  ones to use lit, and the voice adds "Use the left 2 lanes."
  (`navigation.laneArrows`, `laneHint`). Coverage follows the map: around
  Jonesboro only a few junctions have lanes mapped.
- **Speed limit** (`lib/speedLimit.ts`): the posted limit of the road you're
  on, from OpenStreetMap's `maxspeed` via a Nominatim reverse lookup, at most
  every 30 s or when the route moves to a new road, one request at a time.
  Shown as a US-style sign above your speed, which turns red more than 2 mph
  over. **Only real, mapped limits are shown**: no guessing from road type.
  OSRM's public server doesn't provide limits, and around Jonesboro almost no
  roads have `maxspeed` in OpenStreetMap yet, so the sign will often be
  absent there; adding limits to OpenStreetMap makes them appear.
- **Options while navigating** (tap the bottom sheet;
  `components/DrivePanel.tsx`), modelled on Apple Maps:
  - **Audio** (`lib/voicePreference.ts`): All voice / Alerts only / No voice,
    remembered per device. Alerts only keeps just an incident ahead and
    arriving; the speaker button is a quick mute that goes back to the level
    you had.
  - **Share ETA** mid-drive, or stop sharing (no arrival push when stopped).
  - **Share ETA with anyone** (`lib/tripLink.ts`, backend `...000062`), for
    people without the app, through the phone's share sheet: either just the
    ETA as a message ("I'm on my way to Walmart, arriving around 3:41 PM."),
    or a live link (a guest link that also carries the trip). The page shows
    "🚗 Alex is heading to Walmart · arriving in about 12 min" and the live
    position; the phone keeps the ETA current (same throttling as circle
    trips). On arrival it shows "✅ Alex arrived" for 15 minutes **without**
    a location; ending navigation (or leaving the screen) ends it at once;
    otherwise it expires 30 minutes after the ETA. Sharing is switched on for
    the trip if it was off, since the page shows your latest location. Links
    count toward the 5-active-links limit.
  - **Report an incident** (`lib/roadReports.ts`, backend `...000061`): crash,
    hazard, speed check, road closed, one tap, at your current position.
    Visible to whoever can see your location (Ghost mode and sharing windows
    apply) for 1 hour (3 for a closed road), deleted a day later; a double tap
    refreshes instead of stacking; 5 per 10 minutes. Circle-mates see reports
    as map markers on their route, a banner "💥 Crash reported 0.3 mi ahead",
    and hear "Crash reported ahead." once when it's within 800 m on their
    route (never about their own reports). They also appear on the **Map
    tab** (`components/RoadReportMarker.tsx`): reports from the selected
    circle's members and your own, until they expire; tapping one says who
    reported it, when, and how long it has left, and your own can be taken
    back from there.
  - **Add a stop** (`lib/stops.ts`): ⛽ Gas, ☕ Coffee, 🍔 Food, 🅿️ Parking,
    💊 Pharmacy along the next 15 km of road (within 1.5 km of it), least
    detour first, never one you've passed, via Nominatim (OpenStreetMap's
    geocoder; free, about one request a second at most; override with
    `EXPO_PUBLIC_NOMINATIM_URL`). Photon was tried first and matches names
    ("Gas" anywhere), and the public Overpass server was too slow to rely on.
    The route goes via the stop (OSRM waypoint, announced as "Your stop is
    just ahead" and "You've reached Harps"); reroutes keep it until you get
    there; Remove stop replans straight to the destination.
- **Share a bus, train or flight** (⋯ Quick actions, or the link on
  "Where to?"; `app/(app)/share-trip.tsx`): a manual shared trip. Pick the
  kind, type the destination, set the arrival time with presets or a stepper
  (5-minute steps, 15 for flights; up to 24 hours, 48 for a flight), and the
  circle sees "✈️ Sam is flying to Denver, landing in about 2 h" in the same
  trip banner and push as drives and walks. Nothing reports in while you
  travel (a phone on a plane can't), so these trips expire by their ETA plus a
  grace period (30 min bus, 45 min train, 2 h flight; backend migration
  `...000060`) instead of after 10 quiet minutes. While one is up the screen
  shows it with **I've arrived** (tells the circle), **Running late (+15 min)**
  and **Stop sharing**. If your temporary sharing window has ended, it warns
  that the circle can't see trips; it never turns on location tracking itself.
  **Share ETA with anyone** works here too (a message, or a live link). The
  link is tied to the trip on the server (backend `...000063`, a trigger on
  `shared_trips`): Running late updates it, I've arrived switches it to
  "arrived" without a location, and stopping, starting another trip or the
  trip expiring ends it, all without the app being open. It lasts the trip's
  grace period past the ETA (2 h for a flight), and a flight can be up to 48 h
  ahead. Coming back to the screen shows whether a link is out, with Stop the
  live link.
  **Saved destinations** (`lib/savedDestinations.ts`): on the route preview,
  save the place as Home, Work, or under its own name (up to 20). They are
  stored only on the phone, per account, so a home address is never uploaded or
  shown to a circle, and one person's places aren't visible to another who
  signs in on the same phone. They appear first on "Where to?" under My places
  (Home and Work on top) with a Remove button; saving Home again moves it, and
  saving the same spot twice renames instead of duplicating. Deleting your
  account clears them. Circle places still appear below. Not built yet: web
  navigation.
- **QR invite codes** (`components/InviteQr.tsx`, `QrScannerModal.tsx`,
  `lib/joinCode.ts`, `lib/qr.ts`): creating a circle now shows a QR code next to
  the invite code, and Settings → Invite shows one for any code you generate.
  On the Join screen, **Scan QR code** opens the camera, reads the code and
  joins straight away (join approval still applies). The QR carries the same
  code as the text (so it has the same 48-hour expiry and the same attempt
  limit), not a link: a `safecircle://` link would make a phone's own camera try
  to open the app, which doesn't work from Expo Go and lands on a route that
  doesn't exist in a real build, so the code is scanned inside the app. Anything
  that isn't a valid invite code (another site's QR, a Wi-Fi code) is rejected
  rather than guessed at. Encoding is pure JavaScript (`qrcode-generator`, no
  native module, drawn as plain black-on-white views for scanner contrast); the
  scanner uses `expo-camera`, which Expo Go includes. Generated codes were
  decoded back with an independent decoder (jsQR) to confirm they scan. Camera
  is hidden on web. The same pieces can be reused for organization codes.
- **Share location & driving report** (location-history screen,
  `lib/locationReport.ts`) — the raw JSON export is complete but not
  something anyone wants to actually read on a phone. This builds a
  self-contained `.html` file instead: an actual Leaflet + OpenStreetMap
  trail of recent pings (same free/keyless tiles used everywhere else in
  the app) plus a drive-report table, from data the screen already has in
  memory — no extra backend call. Shared through the same real-file +
  native-share-sheet path as data export (factored out into
  `lib/shareFile.ts`, now shared by both), so it can be saved via Files/
  AirDrop and reopened later — double-tapping it in Files opens it right
  in Safari with a real rendered map, not a data dump. Mobile only:
  `expo-sharing` has no real share sheet on web, so this isn't on the web
  fallback screen.
- **Transfer ownership** (Members tab → Make owner, creators only) — so a
  creator can finally leave their own circle.
- **Lock the app** (Settings → Lock the app, `contexts/AppLockContext.tsx`,
  `expo-local-authentication`) — asks for Face ID / fingerprint / passcode on
  launch and after 30 s in the background, and covers the screen whenever the
  app isn't active so the map doesn't appear in the app-switcher preview. It
  proves the check works before turning on, so a broken setup can't lock you
  out. The app keeps running underneath (sharing and alerts continue). In Expo
  Go, iOS may fall back to the passcode instead of Face ID — Face ID needs a
  development build.
- **SOS fallback** — if an SOS can't be sent (typically no internet), the
  error now offers **Text for help** instead of just failing (button and
  shake-to-SOS both).

- **Satellite map**: now part of **Map Modes** (Map tab, top-right map
  button; see Map Modes above): Satellite with or without labels, and 3D
  Flyover on iPhone. All through react-native-maps' built-in map types, so
  no API key or paid tier. The earlier satellite toggle's saved choice
  (`safecircle.mapType.v1`) carries over.
- **Opens on your own location** — the Map tab used to open on a hardcoded
  San Francisco region and only recenter once the circle's locations had
  loaded from the server, which could be slow or (if you'd never shared)
  never happen at all. The first fix used an imperative `mapRef.current
  .animateToRegion()` call right after mount, which turned out to be its
  own bug: react-native-maps has a well-known issue where that call
  silently does nothing if it fires before the native map view has
  finished initializing (especially on iOS/`PROVIDER_DEFAULT`), so it
  could still open on San Francisco depending on timing. The `MapView`
  itself now isn't rendered at all until a starting region is known —
  either the phone's own GPS fix, or a hardcoded fallback after an 8s
  timeout — and that's handed to `initialRegion` at first mount instead,
  which has no such race to lose. Also shows the native "my location"
  blue dot and (Android) a recenter button. If location access was denied
  — including previously, since iOS/Android don't re-show the system
  permission prompt once you've said no — a banner explains why, with a
  tap-through to Settings, instead of the screen just silently staying put.
- **In-app help** (⋯ Quick actions → ❓ Help, `app/(app)/ai-help.tsx`,
  `lib/helpFaq.ts`) — answers "how do I..." questions about the app itself
  ("what does Ghost Mode do?"), not for emergencies; the intro text points
  anywhere else to the SOS button instead. **Free and fully offline**: a
  ~25-entry keyword matcher (`findFaqAnswer()`) with no backend call, no
  API key, no per-question cost, works with no signal — every other
  "smart" feature here already runs on a free service (OpenStreetMap, Esri,
  Open-Meteo), and a real LLM API's per-question cost isn't worth it for a
  capstone demo someone could forget to keep funded. An earlier version
  called Anthropic's API from an Edge Function instead
  (`backend/supabase/functions/send-ai-help`); that function and its client
  side (`lib/aiHelp.ts`, still passing its own tests) are kept as a ready
  optional upgrade rather than deleted — see `backend/README.md` for how to
  switch to it. `lib/__tests__/helpFaq.test.ts` checks every entry's own
  canonical question actually routes back to itself, which caught six real
  gaps where a keyword list didn't cover its own question's natural
  phrasing (e.g. "How do I lock the app?" not matching the `app-lock`
  entry) before this shipped. `lib/__tests__/aiHelp.test.ts` separately
  caught a real bug in the now-unused network path: `supabase-js` puts a
  generic message on a failed function call's `error.message` and the
  actual response body on `error.context` (the raw `Response`) — reading
  `error.message` directly would have shown "Edge Function returned a
  non-2xx status code" instead of "Too many questions this hour."

## Running locally

```bash
npm install
npx expo start
```

Press `i` for iOS Simulator or `a` for Android emulator, or scan the QR
code with Expo Go on a physical device. `npm run web` also works for
quick UI iteration, except the map tab — `react-native-maps` has no web
renderer, so `index.web.tsx` shows a placeholder there by design (this app
targets iOS/Android; the web dashboard is the separate `web/` package).

### Android

The app also builds for Android. Android Studio's own Java (25) breaks the
native build step, so point Gradle at Java 17:

```bash
export ANDROID_HOME=~/Library/Android/sdk
export JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone &   # or plug in a phone with USB debugging on
CI=1 npx expo run:android --variant release --no-bundler
```

The first build takes about 10 minutes (it compiles the native code for
four processor types); the installable file is
`android/app/build/outputs/apk/release/app-release.apk` (~120 MB). Not yet
working on Android: the map needs a Google Maps API key
(`android.config.googleMaps.apiKey` in `app.config.js`), push needs a
Firebase project (`google-services.json`), and CarPlay is iPhone-only.

### Tap-through tests (Maestro)

`.maestro/` holds flows that drive the real app the way a person would, on
the iOS simulator or an Android emulator. Install once with
`brew install mobile-dev-inc/tap/maestro`; it needs Java 17
(`JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home`).
Add `MAESTRO_CLI_NO_ANALYTICS=1` to turn off its usage statistics.

```bash
scripts/e2e.sh               # asks for the test account's email and password
scripts/e2e.sh signed-out    # only the flows that need no account
```

or by hand: `maestro test --device <id> -e EMAIL=... -e PASSWORD=... .maestro/signed-in`.

- `signed-out/01_sign_in_screens`: sign-in, the three account types on
  sign-up, forgot password, and back. Touches nothing on the server.
- `signed-in/02_tabs`: every tab opens. `03_check_in`: sends a check-in from
  Chat. `04_spanish`: Settings → Language → Español redraws the app in
  Spanish, then back (iPhone only). `05_clock_in_out`: a very short real
  shift (the account must be a worker in an organization).

The signed-in flows act for real (a check-in message, a shift), so run them
with a test account, not one with your family on it. Each starts with
`clearState`, which signs the app out first. With both the simulator and an
emulator open, pass `--device` (`xcrun simctl list devices booted`, or
`adb devices`) so Maestro doesn't pick one for you. Tabs are matched by their
accessible names ("Settings, tab, 5 of 5"), so `"Settings, tab.*"`.

### Environment variables

Needs `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
`app.config.js` reads the **repo root** `.env` (shared with the web
dashboard) via `dotenv`, so there's one file to keep in sync — copy
[`../.env.example`](../.env.example) to `../.env` if you haven't already.
Restart `expo start` after changing it (env vars are read at config-eval
time, not hot-reloaded).

### Tests

```bash
npx tsc --noEmit && npx jest
```

Besides unit tests, every tab has a screen test (`lib/__tests__/mapTab`,
`membersTab`, `chatTab`, `settingsTab`, `workTab`, plus `driveScreen` and
`shareTripScreen`). Each renders the real screen with its real hooks and
logic; only the edges are faked: the server (`test-support/fakeSupabase.ts`,
which records every query and rpc and can deliver realtime events), the
signed-in user and circle, and phone features such as GPS, background
tracking, notifications and the photo picker. `test-support/render.tsx` has
the helpers for reading the screen and pressing things by what they say.

## Verification notes

This machine has Xcode Command Line Tools but not full Xcode, so there's
no iOS Simulator available here — everything above was verified instead
by running `expo start --web` and driving the app through a browser: the
full auth → circle-setup → tabs flow, circle creation, invite code
generation/regeneration, member list, and sign-out all confirmed working
against the real hosted backend.

**Update — since verified on a real device.** Ran the app on a physical
iPhone via Expo Go (`npx expo start`, scan the QR code): sign-up,
circle-setup, tab navigation, and the map tab (Apple Maps tiles, the SOS
button) all render and work correctly on real hardware.

**True background location does not work in Expo Go — confirmed, not
just untested.** Enabling "Share my location" in Settings on the real
device produced zero new rows in `locations`, even after waiting. This
isn't a bug: `Location.startLocationUpdatesAsync` requires a custom
development build on both iOS and Android per Expo's own docs — "You
must use a development build to use background location since it is not
supported in the Expo Go app." This is the concrete version of the risk
the proposal named on page 9. Getting a development build onto a
physical iPhone via EAS additionally requires enrolling in the **paid**
Apple Developer Program ($99/yr) — a free Apple ID fails registering the
device with `error: "iTunes service key is empty"` (Apple's Developer
Portal API, which EAS/fastlane use for ad-hoc provisioning, rejects
non-Program accounts entirely). `mobile/eas.json` has a `development`
build profile ready to go (`eas device:create` then
`eas build --profile development --platform ios`) whenever that's set up
— nothing else to configure.

**Fixed with a foreground fallback** — see "Foreground fallback" above.
**Confirmed working on the real iPhone**: toggling sharing on delivered a
steady stream of location rows to the backend while the app was open
(multiple rows a few seconds apart, coordinates matching the device's
real location), and the marker appeared correctly on the Map tab. Only
works while the app is open, not backgrounded/closed, as expected.

Along the way, real-device testing also caught a second bug:
`Location.requestBackgroundPermissionsAsync()` itself throws
`ERR_LOCATION_INFO_PLIST` in Expo Go (no `NSLocationAlwaysAndWhenInUse
UsageDescription` in its compiled binary for arbitrary apps) — that call
wasn't wrapped in try/catch, so it crashed the whole toggle with an
uncaught promise rejection and left it stuck spinning. Fixed by wrapping
it the same way as the already-guarded `startLocationUpdatesAsync` call,
plus a `try/finally` around the whole toggle handler in `settings.tsx` so
no future native throw can do the same. Also confirmed fixed on-device —
the toggle no longer crashes.

Once a development build (iOS with a paid account, or **Android**, which
has no such account requirement or 7-day expiry — matches the proposal's
own "build Android-first" call) is running: toggle sharing on in
Settings, background the app, walk around, then check `locations` for
new rows (`select * from locations order by recorded_at desc limit 5;`
in the SQL editor, or the web dashboard). To test the offline queue
specifically: enable airplane mode for a few location updates, confirm
nothing new appears, then disable it and confirm the queued pings land
in a batch.

Everything else new — Places (add a place, list, activity feed), location
history, and the push-token upsert's happy path once EAS is configured —
was verified end-to-end through the same `expo start --web` + real hosted
backend approach: created a place via the REST API, triggered an
arrive/leave via two location pings, and confirmed both the places list
and the joined "who arrived where" activity feed rendered correctly.
Same for history: inserted an 8-point walking trail via the REST API,
tapped into a member's history screen, and confirmed all 8 pings render
in the correct order with the right coordinates/timestamps/battery. The
in-app "Add place here" flow, and the history screen's actual map trail
(`[userId].tsx`, as opposed to its list-only web fallback), need a
device — both `react-native-maps` and real device geolocation are
native-only (confirmed the geolocation failure path degrades gracefully —
"Location permission denied." — rather than crashing, when the browser
sandbox has no location access).

SOS was verified the same way, end-to-end on the hosted project: a real
two-person circle, one triggers SOS via the REST API, confirmed the
other's `SosBanner` rendered the correct name/message/time, clicked
"Mark resolved," and confirmed via a direct query that `resolved_at`/
`resolved_by` were actually set — the banner disappearing alone wouldn't
have proven the write succeeded, so this checked the database, not just
the UI. Also caught a real bug this way: the initial `profiles(full_name)`
embed 400'd (`PGRST201`) because `sos_events` has two FKs to `profiles`
(`user_id` and `resolved_by`); fixed with an explicit
`profiles!sos_events_user_id_fkey(...)` hint.

**Not yet verified on real phones:** temporary sharing, Walk me home and
Need a ride were built and their backend logic tested on the hosted DB, but
the screens and the push delivery need real devices. (A walk can be tried
with one phone plus a second account watching; a ride request only reaches
someone whose phone is actually moving at driving speed, so that needs a
second phone in a car.)

**Re-verified on the real iPhone after a large batch of additions**
(avatars, chat, "Here now," the RLS-gap fixes): the colored-initial map
marker rendered correctly in place of the default pin — confirmed the
avatar feature actually works on-device, not just in the web fallback.
That same session also caught a real crash: tapping the Members or Chat
tab threw `cannot add 'postgres_changes' callbacks... after
subscribe()`. Root cause — `useCircleMembers` is now called by three
simultaneously-mounted tabs (Map, Members, Chat) for the same circle, and
`supabase.channel(topic)` returns the *same* channel object for a
repeated topic string rather than a fresh one, so the second and third
callers' `.on()` calls landed on a channel the first had already
`.subscribe()`'d. Fixed with a random per-instance suffix on both of that
hook's channel names; confirmed fixed on the same device.

## Design system

Shared tokens live in `lib/theme.ts` (colors, spacing, radius, type scale)
and two primitives in `components/` (`Button`, `TextField`) — extend these
rather than hardcoding styles per-screen, and keep the palette in sync
with the web dashboard's (`web/src/index.css`) so the two clients feel
related.

## Incident reports

Work tab → "Report a hazard or incident" (workers), or the Incidents and
Report tiles (owners, admins, managers). A report is a kind (hazard, near
miss, injury, other), a note, an optional photo from the camera or the
library, and the position only while clocked in there. The database tells
the people who oversee the reporter at once and decides who can read it
(migration `...000072`); `app/(app)/incidents.tsx` lists them with photos
and a "Mark resolved" button. Photos go to a private bucket, resized to
1280 px, under `<org>/<you>/`.

## Lock screen (Live Activities)

Walk me home, Check on me and your shift appear on the lock screen and in the
Dynamic Island as a countdown that runs with the app closed
(`lib/liveActivity.ts`, `components/LockScreenSync.tsx`, the
`expo-live-activity` package). It needs a widget extension, which is left
out of normal builds so a working phone build stays as it is. To include it:

```bash
SAFECIRCLE_LIVE_ACTIVITY=1 npx expo prebuild --platform ios --clean
SAFECIRCLE_LIVE_ACTIVITY=1 npx expo run:ios --device <udid> --configuration Release
```

`plugins/withLiveActivity.js` gives the extension the app's signing team, so
a free Personal Team can sign it. In a build without it, nothing happens.

## Fall detection ("man-down")

Settings → Fall detection (off by default, per phone). For someone working
alone or out on their own: if the phone feels a hard fall or crash and then
lies still, a full-screen, vibrating "Are you OK?" counts down 30 seconds.
"I'm OK" stops it and nothing is sent; no answer (or "Send SOS now") sends an
SOS with the location and a message saying it was a possible fall, through
the same path as the SOS button: the circle, and on shift the managers who
oversee you. The message is shown, and pushed, in each reader's language.

- `lib/fallDetector.ts` is the pattern, as pure logic: an impact of 4 g, or
  2.8 g right after free fall; 1.5 s to settle (another impact restarts it, a
  fall down stairs); then 4 s of lying still. Running, a bumpy ride, sitting
  down hard, a dropped phone that's picked up, or getting up again don't
  pass. `lib/__tests__/fallDetector.test.ts` plays recorded-style patterns
  through it; `components/__tests__/FallCheck.test.tsx` covers the countdown.
- A dropped phone left on the floor does pass, which is what the countdown
  and vibration are for.
- **Honest limit:** phones give apps motion data while they're open, so it
  works while Safe Circle is open (on screen, driving, during a shift with
  the app up). Watching from the background would need native code; Apple's
  own fall detection is an Apple Watch feature. The motion readings never
  leave the phone; only an SOS does.

## Español (Spanish)

The app follows the phone's language, English or Spanish, and Settings →
Language can pick one; switching redraws every screen at once (like
Appearance). Written for the many Spanish-speaking field workers and
families the app is for.

- Text is written in English and wrapped in `t()` (`lib/i18n.ts`):
  `t('Sign in')`, `t('Clocked in to {org}', { org: name })`. Spanish is
  looked up in `lib/translations/es.ts` by the English; anything not
  translated yet shows in English, never as a key.
- Every screen is translated (601 phrases): signing in, the tabs, SOS,
  Directions and the drive screen, walks, check-ins, trips and links,
  curfew, the Work tab and crew screens, timesheets, privacy screens and
  **the work disclosure a worker agrees to**. A few sentences built from
  live values in code (some counts and times) are still English.
- Quick statuses are stored in English and shown in each reader's language,
  so a Spanish speaker and an English speaker in one circle both read their
  own. Notifications arrive in each recipient's language too: the app saves
  it to `profiles.language`, and the push Edge Functions translate each alert
  (see backend/README.md).
- `lib/__tests__/i18n.test.ts` fails if any `t('...')` has no Spanish, or a
  translation's `{placeholders}` don't match the English.
- The Spanish is informal ("tú"), Latin American. Have a native speaker
  review it before relying on it, the work disclosure above all: it's what
  a worker consents to.

## Accessibility

A safety app has to work for someone who can't see the screen well, so the
app is built for VoiceOver (and TalkBack) and for iOS's larger text sizes:

- **Every tappable thing is a named control.** Each `Pressable` has a role
  (button, tab, radio, link), and buttons whose text is vague on its own say
  what they act on: "Remove Mom", "Rename Family", "Edit your phone number".
  Switches and text boxes are named by the words beside them (`TextField`
  passes its label to the field, so it isn't read twice). `Button` reports
  when it's busy or unavailable.
- **Nothing hides inside something else.** VoiceOver reads a tappable area as
  one item, so a button inside it can't be reached. The walk and
  check-on-me banners keep their text and their "I'm safe" button as
  separate items, and the crew card's actions sit beside the name.
- **Things that happen are said out loud** (`lib/announce.ts`): SOS sent,
  check-in sent, clocked in or out, marked safe. Every error under a form is
  an `ErrorText`, which is read out as it appears, so nobody is left
  wondering why a tap did nothing.
- **Headings** (`accessibilityRole="header"`) on screen titles and section
  labels, so the VoiceOver rotor can jump between sections of a long screen
  like Settings.
- **Text grows with the phone's setting**, up to the largest accessibility
  sizes, and long text wraps rather than being cut off. As in Apple's own
  apps, a few things are held back: emoji icons in fixed circles (tab bar,
  SOS, map buttons) stay their size, and big screen titles, hero numbers and
  stat tiles grow at most 1.3–1.5×, so a word like "Settings" isn't split
  across two lines. The vehicle marker's turning animation stops when Reduce
  Motion is on.

`lib/__tests__/accessibility.test.ts` reads the source and fails if a new
`Pressable` has no role, a switch or text box has no name, a control is
nested inside a `Pressable`, or an error is shown without being read out.
To try it yourself: Settings → Accessibility → VoiceOver, or the
Accessibility Inspector in Xcode (Open Developer Tool) on the simulator.
