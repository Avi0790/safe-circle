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
  `send-geofence-push` has somewhere to deliver alerts. Requires the
  project to be registered with EAS (`eas init`, tied to a real Expo
  account) — Expo push tokens are scoped to an EAS project id, so this
  fails gracefully with a specific "not set up yet" message rather than
  crashing until that one-time step is done. Also guarded to no-op on web
  (`expo-notifications` doesn't support that platform).
- **Location history** (`app/(app)/member/[userId].tsx`, tap a member on
  the Members tab) — the other stretch goal from the proposal's page 3.
  Shows a member's last 100 pings as a map trail (`Polyline` + oldest/most
  -recent markers) plus a scrollable list with timestamps, coordinates,
  and battery. `locations` was already append-only, so this needed zero
  backend changes — purely a new read. Same web-unsupported-map pattern
  as the Map tab: `[userId].web.tsx` is a list-only fallback.

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

**Two things specifically could not be verified this way and still need a
real device or simulator:**

- The map tab itself — `react-native-maps` has no web renderer.
- The actual background location engine. The web target's `Platform.OS`
  guard proves the code doesn't crash and fails gracefully there ("Background
  location is not available on web" — confirmed in-browser), but real GPS
  fixes, OS-level background scheduling, and permission dialogs are native
  behavior that fundamentally cannot be exercised outside a native runtime.
  Before trusting the 50m/60s throttling or the offline queue, test on an
  actual iOS/Android device or simulator: toggle sharing on in Settings,
  background the app, walk around, then check the `locations` table (or
  the web dashboard) for new rows: `select * from locations order by
  recorded_at desc limit 5;`. To test the offline queue specifically,
  enable airplane mode for a few location updates, confirm nothing new
  appears in `locations`, then disable it and confirm the queued pings
  land in a batch.

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

## Design system

Shared tokens live in `lib/theme.ts` (colors, spacing, radius, type scale)
and two primitives in `components/` (`Button`, `TextField`) — extend these
rather than hardcoding styles per-screen, and keep the palette in sync
with the web dashboard's (`web/src/index.css`) so the two clients feel
related.
