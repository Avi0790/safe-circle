# Demo script

About 8 minutes. Before you start, the day of:

```bash
cd backend
supabase db query --linked -f scripts/demo_seed.sql   # the Demo Crew
scripts/demo_check.sh                                 # everything PASS?
```

Have the web dashboard open (signed in as the Demo Crew owner) and the phone
or simulator signed in to the same account.

## 1. The idea (30 s)

Location sharing that people don't turn off: your circle sees you only while
you share, and at work your managers see you only while you're clocked in.

## 2. Family: the map and SOS (2 min)

- Map tab: circle members, battery, weather where they are.
- Start **Walk me home** to a place; show the countdown (on the lock screen
  in a Live Activity build).
- Hold **SOS**: the circle is alerted with your location; "Call 911" on the
  same prompt. Cancel it.

## 3. Work: the crew (2 min)

- Dashboard → **Live crew**: only the people on shift, the wind warning on
  Maya's shift.
- **Safety report**: eight weeks of hours, SOS answer times, missed
  check-ins, incidents.
- **Schedule**: this week planned against actual, the late and the missed
  shift, the two requests waiting; approve Aisha's time off.

## 4. The roll call, live (2 min)

In a terminal:

```bash
backend/scripts/demo_roll_call.sh
```

Then dashboard → **Roll call** → "Tornado warning. Get inside and check in."
→ Start. Over half a minute the crew answers: four safe, Aisha needs help
(your phone gets the push, and tapping it opens the roll call), Priya
silent.

## 5. Privacy (1 min)

- Work tab as a worker: **Who's looked at you**.
- Settings: ghost mode, history kept 1/7/30 days, download my data, delete
  account.
- Español: switch the language and everything follows, notifications too.

## Afterwards

```bash
supabase db query --linked -f scripts/demo_reset.sql   # remove the demo data
```

## Backup video

If the live demo can't run, play a recording. To make one, sign in on the
simulator, run `mobile/scripts/record_demo.sh`, go through sections 2–5, and
press Ctrl+C. It's saved in `docs/demo-video/`, which git ignores.
