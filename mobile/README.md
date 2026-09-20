# Safe Circle — Mobile App

React Native + Expo (TypeScript) app for the Safe Circle capstone project.
Covers both **Avi's layer** (page 6: auth screens, onboarding, circle
create/join flows, member list, settings, design system) and **AJ's
layer** (background location: permissions flow, tracking service,
throttling, offline queue) — talking to the Supabase backend in
[`../backend`](../backend).

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
  one with a code.
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
  proposal: colored initials (deterministic per-person color hashed from
  user id) everywhere a member shows up, including as custom map markers
  replacing the default pin — the Life360 "who's who at a glance" look,
  without needing photo upload (`avatar_url` exists on `profiles` but
  nothing sets it — no upload UI, and no device this session to test an
  image-picker flow against).
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
- **Check in** (the 📍 button beside the chat composer) — beyond the
  proposal, Life360-style: a chat message that also carries where you are
  (`messages.latitude/longitude`, `...000022_message_location.sql`), shown
  with a "View on map" link (Google Maps universal URL, works on iOS and
  Android) on both the app and the web dashboard's read-only feed. It's an
  ordinary message, so it reuses the message push and unread badge, and
  exposes nothing circle-mates couldn't already see.

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
