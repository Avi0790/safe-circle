# Safe Circle

Family location sharing that respects your battery and your privacy.

**Created, designed and developed by [Surendra B K](https://github.com/surendr7a)** —
the whole stack: the Supabase backend (schema, row-level security, Edge
Functions, scheduled jobs), the iOS/Android app, the web dashboard, the
test suites and the CI pipeline, plus every feature beyond the original
proposal.

CS capstone project, Fall 2026 (Team Beacon). Proposal team: Avi (mobile &
UI), AJ (location engine), Surendra (backend & data), Thi (web client & QA).

## What it does

Create a private circle with a 6-character invite code, and everyone in it
sees everyone else on a shared live map — no manual check-ins. Sharing is
always visible and can be paused at any time; if you're not in someone's
circle, you cannot see them. See [`backend/README.md`](backend/README.md)
for the full pitch and how access control is enforced.

## Structure

| Package | Built by | What it is |
|---|---|---|
| [`backend/`](backend/README.md) | Surendra B K | Supabase: schema, row-level security, invite-code RPCs, geofencing + push notifications |
| [`web/`](web/README.md) | Surendra B K | Read-only React + Leaflet live-map dashboard |
| [`mobile/`](mobile/README.md) | Surendra B K | Expo/React Native app — auth, circles, live map, and the background location engine |

Each package has its own README with setup and verification details.

**Status: the full proposal is built** — MVP (accounts/circles, live map,
background location) and all three stretch goals (geofenced places with
push alerts, location history, an SOS button), backend through UI,
verified end-to-end against the real hosted project. Two security review
passes caught and fixed three real issues (an unauthenticated webhook, no
rate limiting on invite-code guesses, no rate limiting on SOS alerts) —
see `backend/README.md`. Push notifications are registered with EAS
(`@suren.7a/safecircle`).

Beyond the proposal: a full audit of the backend's own RLS policies found
several the UI never wired up (rename/delete a circle, rename/delete a
place, edit your name, remove a member) — all closed. Also added
forgot-password on both clients, a live "who's actually here right now"
indicator per place, and several Life360-style additions: in-circle chat
with push notifications and an unread badge (mobile sends, web reads),
avatars everywhere including as map markers (a profile photo you choose
from your library, or colored initials until you do), and a
"driving" status + distance-to-member readout from GPS speed data that
was already being collected but never captured. Also a "Call 911"
option on the SOS confirm dialog, and Life360-style place icons
(🏠/🏫/💼) inferred from each place's name.

Three features that deliberately *aren't* Life360 — the theme is
consent-based, time-limited safety rather than always-on tracking:
**temporary sharing** (share for 1/2/8 hours, enforced in the database so
it holds even if the app is force-quit), **Walk me home** (pick a place and
a timer; your circle sees you're on your way, hears when you arrive, and an
SOS fires *automatically* if you don't — protection for when you can't press
the button), and **Need a ride** (one tap alerts only circle-mates who are
driving near you right now). A second batch pushes further on the same
theme, this time aimed at Life360's biggest privacy criticism — that it
watches constantly with no accountability: **who's checked on me** (a log
of when a circle-mate opened your location history), **auto-delete
history** (pick 1/7/30 days or forever; enforced by a daily job, not just
hidden in the UI), **SOS acknowledge + escalation** (circle-mates can tap
"I'm on my way" so the sender knows they've been seen; an unacknowledged
SOS re-pushes the whole circle automatically), and **quick status** chips
("On my way", "Studying", "Don't disturb") that say more than a dot on a
map and expire on their own. A third batch adds a few things that are
just genuinely cool and unique rather than pure safety workflow:
**auto status from places** (arriving at "Home" sets "🏠 Home" on its own,
ties quick status and geofencing together for free), **shake for SOS**
(a few hard shakes brings up the same SOS confirm dialog, for when the
phone's buried in a pocket), and **weather where they are** (temperature
and conditions at a member's location — no Life360-style app shows this).
A fourth batch rounds out the privacy and "meet up" story: **ghost mode**
(hide your location from one specific person, invisibly, while everyone
else still sees you), **meetup pins** (drop a temporary "meet here" marker
for a festival or trailhead, pushed to the circle, gone on its own), and
**curfew** (set a place and a time once; your circle is alerted
automatically if you're not there by then — no button to press). A fifth
batch closes a real gap: every alert so far needs both this phone *and*
Supabase to have internet — **text for help** composes an SMS with your
location to circle-mates or personal backup contacts, a fallback that can
get through when push can't, and **check on me** is Walk me home's sibling
for when there's no destination (studying alone, a first date, a solo
hike) — set a timer, and an SOS fires automatically if you don't check in.
A sixth batch is about who gets in and who can see what: **join approval**
(a leaked invite code only creates a request the creator can deny), a
**medical card** that circle-mates can read only during your active SOS
(enforced by row-level security), and **guest tracking links** — a
time-limited link that shows your live location in any browser to someone who
doesn't have the app, which Life360 can't do. A seventh batch covers what a real app owes its users: **download my data**,
**delete my account** (safely — circles you created are handed to another
member instead of vanishing for everyone), **transfer circle ownership**, an
optional **Face ID lock**, and an **SOS fallback** that offers a text message
when there's no internet. Details in `backend/README.md` and `mobile/README.md`.

Tested on a real iPhone via Expo Go: auth, circles, the map, SOS, and
live location sharing all confirmed working on real hardware — including
two real bugs caught only by that testing (a crash in the background
permission request, and background location doing nothing at all in
Expo Go) and fixed on the spot; see `mobile/README.md`'s Verification
notes for both. The remaining gap: **true background tracking** (app
closed or screen off) still needs a custom development build — a
foreground fallback now covers sharing while the app is open, but not
backgrounded/closed. Getting a development build onto a physical iPhone
needs the paid Apple Developer Program ($99/yr), which this project
hasn't enrolled in; an Android development build has no such requirement
and would need testing whenever an Android device is available.

What's left isn't ordinary code: teammates joining, and (optionally) that
Apple Developer enrollment or an Android device to verify true background
tracking on real hardware.

## Getting started

1. **Backend first** — it's the foundation everything else talks to.
   Follow [`backend/README.md`](backend/README.md) to get a local Supabase
   stack running (`supabase start`) or link to the hosted project.
2. **Shared client env** — copy [`.env.example`](.env.example) to `.env`
   at this repo root and fill in the project's URL + anon key (Project
   Settings → API on the Supabase dashboard). Both `web/` and `mobile/`
   read from this one file — see each package's README for exactly how.
3. **Web or mobile** — `npm install && npm run dev` in `web/`, or
   `npm install && npx expo start` in `mobile/`.

## Tooling

- Git + GitHub, pull-request reviews.
- GitHub Actions CI (`.github/workflows/ci.yml`) — runs on every push/PR:
  applies all backend migrations against a real Postgres instance
  (`supabase db reset`, catching schema/RLS bugs before they reach the
  hosted project), and typechecks + tests both `web/` and `mobile/`.
- Jest for unit tests (`web/src/lib/__tests__`, `mobile/lib/__tests__`).

## Timeline

Fifteen weeks, five phases — see page 7 of the proposal for the full
breakdown and checkpoints. Hard rule: whatever's unfinished at the end of
week 13 gets cut; weeks 14–15 are for testing and the write-up only.

## Author

**Surendra B K** — creator and lead developer of Safe Circle.
GitHub: [@surendr7a](https://github.com/surendr7a)

Licensed under the MIT License — see [LICENSE](LICENSE). Keep the copyright
notice when you reuse it.
