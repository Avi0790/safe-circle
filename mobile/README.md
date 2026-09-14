# Safe Circle — Mobile App

React Native + Expo (TypeScript) app for the Safe Circle capstone project.
This is **Avi's layer** per the proposal (page 6): auth screens, onboarding,
circle create/join flows, member list, settings, and the design system —
talking to the Supabase backend in [`../backend`](../backend).

## Scope: what's here vs. not here

This package deliberately does **not** include background location
tracking. Per the proposal, that's a separate, higher-risk layer owned by
AJ ("Location engine: permissions flow, background tracking service,
throttling, offline queue"). What's here instead:

- Full auth flow: sign up, sign in, sign out (Supabase Auth).
- Circle onboarding: create a circle (shows the invite code once) or join
  one with a code.
- Live map + member list, sourced from the same `latest_locations` view
  and realtime subscription the web dashboard uses.
- Settings: switch circles, generate/regenerate an invite code, sign out.
- A **manual** "Share my location" button on the map screen — a single
  foreground `expo-location` fetch, not a background service. It exists so
  the map/circle flow is demoable end to end before AJ's real tracking
  service lands; replace it once that's ready (`app/(app)/(tabs)/index.tsx`).

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
against the real hosted backend. The map tab itself (`react-native-maps`)
can only be verified on an actual iOS/Android target — do that once you're
on a machine with Xcode or Android Studio installed.

## Design system

Shared tokens live in `lib/theme.ts` (colors, spacing, radius, type scale)
and two primitives in `components/` (`Button`, `TextField`) — extend these
rather than hardcoding styles per-screen, and keep the palette in sync
with the web dashboard's (`web/src/index.css`) so the two clients feel
related.
