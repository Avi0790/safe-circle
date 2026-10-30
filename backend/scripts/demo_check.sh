#!/usr/bin/env bash
# Before a demo: is the live project ready? Read-only. Run from anywhere:
#
#   backend/scripts/demo_check.sh
#
# Checks the database (scripts/demo_check.sql: demo data, scheduled jobs,
# push, privacy), that every migration here is applied, and that every Edge
# Function the app uses is deployed. Exits 1 if anything FAILs.
set -uo pipefail
cd "$(dirname "$0")/.."

# Written but deliberately not deployed until there's a Stripe account
# (see backend/README.md), so not expected on the live project.
NOT_DEPLOYED="billing stripe-webhook"

echo "Safe Circle — demo check ($(date '+%a %b %-d, %-I:%M %p'))"

# The SQL check reports by raising its results, inside the error JSON.
supabase db query --linked -f scripts/demo_check.sql 2>&1 | python3 -c '
import json, re, sys
raw = sys.stdin.read()
text = raw
# the database error is JSON inside the CLI error message, itself JSON
for _ in range(3):
    start = text.find("{")
    if start < 0:
        break
    try:
        obj = json.loads(text[start:text.rfind("}") + 1])
    except Exception:
        break
    text = obj.get("error", {}).get("message") or obj.get("message") or text
m = re.search(r"RESULT\n(.*?)\nCONTEXT:", text, re.S)
if not m:
    print("FAIL could not run the database check:\n" + raw.strip()[-600:])
else:
    print(m.group(1).rstrip())
' | tee /tmp/safecircle_demo_check.$$

echo
echo "— Migrations —"
supabase migration list --linked --output-format json 2>&1 | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    rows = json.loads(raw[raw.find("{"):raw.rfind("}") + 1])["migrations"]
except Exception:
    lines = [l for l in raw.splitlines() if l.strip() and "new version" not in l.lower() and "recommend updating" not in l.lower()]
    print("FAIL could not list migrations: " + (lines[-1] if lines else "no answer") + "  → supabase link, or supabase login")
    sys.exit()
pending = [r["local"] for r in rows if r["local"] and not r["remote"]]
extra = [r["remote"] for r in rows if r["remote"] and not r["local"]]
if pending:
    print("FAIL not applied to live: " + ", ".join(pending) + "  → supabase db push --linked")
else:
    print("PASS all %d migrations applied (latest %s)" % (len(rows), rows[-1]["local"]))
if extra:
    print("WARN on live but not in this folder: " + ", ".join(extra) + "  → git pull")
' | tee -a /tmp/safecircle_demo_check.$$

echo
echo "— Edge Functions —"
LOCAL=$(ls supabase/functions | grep -v '^_' | tr '\n' ' ')
supabase functions list --output-format json 2>&1 | NOT_DEPLOYED="$NOT_DEPLOYED" LOCAL="$LOCAL" python3 -c '
import json, os, sys
raw = sys.stdin.read()
try:
    live = {f["slug"]: f["status"] for f in json.loads(raw[raw.find("{"):raw.rfind("}") + 1])["functions"]}
except Exception:
    # show what the CLI actually said rather than guessing
    lines = [l for l in raw.splitlines() if l.strip() and "new version" not in l.lower() and "recommend updating" not in l.lower()]
    print("FAIL could not list Edge Functions: " + (lines[-1] if lines else "no answer") + "  → supabase login, then try again")
    sys.exit()
skip = os.environ["NOT_DEPLOYED"].split()
for name in os.environ["LOCAL"].split():
    if name in skip:
        continue
    status = live.get(name)
    if status == "ACTIVE":
        print("PASS " + name + " is deployed")
    else:
        print("FAIL " + name + " is " + (status or "not deployed").lower() + "  → supabase functions deploy " + name)
' | tee -a /tmp/safecircle_demo_check.$$

fails=$(grep -c '^FAIL' /tmp/safecircle_demo_check.$$)
warns=$(grep -c '^WARN' /tmp/safecircle_demo_check.$$)
passes=$(grep -c '^PASS' /tmp/safecircle_demo_check.$$)
rm -f /tmp/safecircle_demo_check.$$
echo
if [ "$fails" -eq 0 ]; then
  echo "READY: $passes passed, $warns to look at."
else
  echo "NOT READY: $fails to fix, $warns to look at, $passes passed. Each FAIL says what to do (→)."
  exit 1
fi
