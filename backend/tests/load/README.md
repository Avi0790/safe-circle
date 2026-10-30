# Load test

`01_crew_scale.sql` checks that Safe Circle stays fast with a real-sized
crowd. Inside one transaction that rolls itself back it builds a work
organization with 200 workers on shift (a manager leading a team of 40) and
25 family circles of 4, each person with 3 days of location history (about
115,000 positions, written through the same triggers as a phone's uploads).
Then it times what the apps actually run, as the person who runs it, through
row-level security, and reports rows and the best of 3 runs against a
generous limit:

| Query | Who | Expected rows | Limit |
|---|---|---|---|
| Live crew map | owner | 200 | 1000 ms |
| Live crew map | manager of a 40-person team | 40 | 1000 ms |
| A worker's shift track for the day | owner | 60 (on-shift only) | 500 ms |
| Family map, latest positions | circle member | 4 | 500 ms |
| A circle-mate's trail, latest 100 | circle member | 100 | 500 ms |
| Everyone else's positions | a worker | 0 | 3000 ms |
| One location upload (average of 100) | a phone | — | 50 ms |

It runs on every push in CI (`tests/run_all.sh` against the fresh local
database), and locally with `supabase start` then `tests/run_all.sh load`.
`--linked` skips it: it isn't something to do to the live project.

## Results (CI, 2026-10-30)

112,800 positions for 302 people, built in 10 s. Best of 3 runs:

| Query | Rows | Time |
|---|---|---|
| Owner's live crew map (200 on shift) | 200 | 31 ms |
| Manager's live crew map (team of 40) | 40 | 24 ms |
| A worker's shift track | 60 | 0.4 ms |
| Family map, latest positions | 4 | 36 ms |
| A circle-mate's trail (latest 100) | 100 | 12 ms |
| A worker asking for everyone else's positions | 0 | 1,285 ms |
| One location upload (average of 100) | 1 | 0.6 ms |

Every query the apps make stays in tens of milliseconds. The slow one is not
a query the apps make: it is someone asking for the whole table, which
row-level security answers with nothing after checking each row. It's the
cost of refusing, and it's the first thing to index if the table grows by
orders of magnitude.
