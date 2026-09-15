# Safe Circle — Mobile App

React Native + Expo (TypeScript) app for the Safe Circle capstone project.
Covers both **Avi's layer** (page 6: auth screens, onboarding, circle
create/join flows, member list, settings, design system) and **AJ's
layer** (background location: permissions flow, tracking service,
throttling, offline queue) — talking to the Supabase backend in
[`../backend`](../backend).

## What's here

- Full auth flow: sign up, sign in, sign out (Supabase Auth).
- Circle onboarding: create a circle (shows the invite code once) or join
  one with a code.
- Live map + member list, sourced from the same `latest_locations` view
  and realtime subscription the web dashboard uses.
- Settings: a **Share my location** toggle that starts/stops real
  background tracking, switch circles, generate/regenerate an invite code,
  sign out.
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
- **Places** (`app/(app)/places.tsx`, reachable from Settings) — the
  geofencing stretch goal (proposal page 3). The backend side
  (`places`/`geofence_events` tables, the `evaluate_geofences` trigger, the
  `send-geofence-push` Edge Function) existed already; this is the UI that
  makes it usable: add a place at your current location, see the circle's
  places, and a live "who arrived/left where" activity feed.
- **Push notification registration** (`lib/pushNotifications.ts`) — gets an
  Expo push token and upserts it into `push_tokens`, so
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
  backend changes — purely a new read. Same web-unsupported-map pattern
  as the Map tab: `[userId].web.tsx` is a list-only fallback.
- **SOS button** (`components/SosButton.tsx` + `SosBanner.tsx`, on the Map
  tab) — the proposal's last stretch goal. One tap (after a confirm
  dialog, to avoid accidental fires) shares your current location as an
  `sos_events` row, which alerts everyone across every circle you're in
  via the same pg_net-triggered push pattern as geofencing
  (`send-sos-push` Edge Function). A red banner shows any active SOS —
  yours or a circle-mate's — with a resolve button, live via realtime.
  `hooks/useActiveSosEvents.ts` reads it.

That's the full proposal — MVP and all three stretch goals (geofencing,
location history, SOS) — built end to end.

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

**Background location does not work in Expo Go — confirmed, not just
untested.** Enabling "Share my location" in Settings on the real device
produced zero new rows in `locations` even after waiting. This isn't a
bug: `Location.startLocationUpdatesAsync` requires a custom development
build on both iOS and Android per Expo's own docs — "You must use a
development build to use background location since it is not supported
in the Expo Go app." This is the concrete version of the risk the
proposal named on page 9. Getting a development build onto a physical
iPhone via EAS additionally requires enrolling in the **paid** Apple
Developer Program ($99/yr) — a free Apple ID fails registering the
device with `error: "iTunes service key is empty"` (Apple's Developer
Portal API, which EAS/fastlane use for ad-hoc provisioning, rejects
non-Program accounts entirely). `mobile/eas.json` has a `development`
build profile ready to go (`eas device:create` then
`eas build --profile development --platform ios`) whenever that's set up
— nothing else to configure.

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

## Design system

Shared tokens live in `lib/theme.ts` (colors, spacing, radius, type scale)
and two primitives in `components/` (`Button`, `TextField`) — extend these
rather than hardcoding styles per-screen, and keep the palette in sync
with the web dashboard's (`web/src/index.css`) so the two clients feel
related.
