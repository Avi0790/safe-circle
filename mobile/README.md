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
  ("Thi's phone is at 12%"). Stateless dedupe: a trigger (with a `WHEN`
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
  windows elsewhere in the app). Entirely server-side after that — see
  `backend/README.md`'s known simplification about comparing against UTC
  clock time rather than a per-user timezone, which `profiles` has no
  column for.

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

- **Satellite map** (Map tab, top-right 🛰️/🗺️ button, `lib/mapTypePreference.ts`)
  — toggles react-native-maps' built-in `mapType` between standard and
  `hybrid` (satellite imagery with road/place labels kept on top). Apple
  Maps (iOS) and Google Maps (Android) both include this for free through
  react-native-maps — no separate API key or paid tier, unlike most
  "satellite view" integrations. Per-device preference (`AsyncStorage`),
  not persisted per circle. Only on the main Map tab for now — the
  member-history trail screens still use the standard map.

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

### Environment variables

Needs `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
`app.config.js` reads the **repo root** `.env` (shared with the web
dashboard) via `dotenv`, so there's one file to keep in sync — copy
[`../.env.example`](../.env.example) to `../.env` if you haven't already.
Restart `expo start` after changing it (env vars are read at config-eval
time, not hot-reloaded).

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
