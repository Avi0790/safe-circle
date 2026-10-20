# Circle feature tests

Rolled-back SQL tests for circle features, run the same way as the ones in
`../organizations/` (see its README): each is one `do $$ ... $$` block that
creates throwaway `@test.invalid` users, exercises the real functions as them,
and ends by raising an exception carrying the `PASS`/`FAIL` lines, so nothing
persists.

```bash
cd backend
supabase db query --linked -f tests/circles/01_shared_trips.sql
```

| Script | What it covers |
|---|---|
| `01_shared_trips` | Share my ETA: visibility (driver, circle-mate, someone hidden from, outsider), who is pushed, one active trip, throttling, tampering, validation, sharing windows, expiry, export (29 checks) |
| `02_ghost_aware_pushes` | Ghost mode on routine pushes: walk start/end/arrival, check-on-me start/check-in and pins skip someone hidden from (and everyone when the sender isn't sharing) but still reach the rest; overdue walk / check-on-me SOS, the manual SOS and the all-clear after an overdue one still reach the hidden person; helpers not callable (27 checks) |
| `03_walk_trips` | Shared trips can be a walk: stored and visible as a walk, the push says walking and reaches only the circle-mate, a three-argument call from an older app still works as a drive, bad/null/wrong-case modes refused, mode can't be edited directly, only one `start_shared_trip` exists, anon can't call it (18 checks) |
| `04_manual_trips` | Bus, train and flight trips: push wording and recipients (Ghost mode respected), long trips in hours, one active trip, 24 h limit (48 h for flights) on start and on "running late", expiry by ETA + grace (30 min bus, 45 min train, 2 h flight) while drives still go stale after 10 quiet minutes, landing push, no duplicate overloads, helpers not callable (28 checks) |
| `05_road_reports` | Report an incident: who sees a report (reporter, circle-mate; not someone hidden from, not an outsider, nobody after the sharing window ends), expiry (1 h, 3 h for closures), double taps refresh instead of stacking, 5-per-10-minutes limit, validation, no direct insert/update or stretching expiry, only the reporter can take it back, purge after a day, function grants, realtime (24 checks) |
| `06_trip_share_links` | Share ETA with anyone: trip links store only a token hash and expire 30 min after the ETA; an anonymous visitor sees first name, destination, ETA and position; ETA updates (15 s throttle) move the end; others can't see, change or end your link, nor can you stretch it directly; arrival shows "arrived" without any location and ends 15 min later; stopping ends it at once; validation; plain guest links unchanged; shared 5-link limit; anon can read but not create (25 checks) |
| `07_trip_links_follow_trips` | Links for a bus, train or flight trip: the link takes the trip's destination, ETA and mode; flights can be over a day ahead with 2 h grace; running late moves the link, landing marks it arrived without a location, stopping / a new trip / the trip expiring ends it; only your own active trip; Directions links unchanged; one function, internal expiry helper (18 checks) |
