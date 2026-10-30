#!/usr/bin/env bash
# Runs every SQL test in tests/ and fails if any check fails. Each test is a
# `do $$ ... $$` block that rolls itself back by raising its PASS/FAIL lines
# (see tests/organizations/README.md), so this is safe against any database.
#
#   tests/run_all.sh            the local database (supabase start) — what CI runs
#   tests/run_all.sh --linked   the live project
#   tests/run_all.sh --linked organizations/07   only files matching a pattern
set -uo pipefail
cd "$(dirname "$0")/.."

target="--local"
if [ "${1:-}" = "--linked" ] || [ "${1:-}" = "--local" ]; then
  target="$1"
  shift
fi
pattern="${1:-}"

files=$(ls tests/*/*.sql | grep -- "$pattern" || true)
if [ -z "$files" ]; then
  echo "No tests match '$pattern'."
  exit 1
fi

total_pass=0
total_fail=0
broken=()
failed=()

# Locally, psql: the CLI's --local mode runs one statement at a time and
# each test is several. The live project is only reachable through the CLI.
local_db="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
if [ "$target" = "--local" ] && ! command -v psql >/dev/null; then
  echo "Running locally needs psql (brew install libpq), or use --linked."
  exit 1
fi

for file in $files; do
  if [ "$target" = "--local" ]; then
    out=$(psql "$local_db" -X -q -v ON_ERROR_STOP=1 -f "$file" 2>&1)
  else
    out=$(supabase db query --linked -f "$file" 2>&1)
  fi
  # The report arrives as the text of the error, JSON-escaped inside the
  # CLI's own JSON. Pull out the lines between RESULT and CONTEXT.
  report=$(printf '%s' "$out" | python3 -c '
import json, re, sys
text = sys.stdin.read()
# the CLI wraps the error in JSON (twice); psql prints it as is
for _ in range(3 if text.lstrip().startswith(("{", "Initialising", "Connecting")) else 0):
    start = text.find("{")
    if start < 0:
        break
    try:
        obj = json.loads(text[start:text.rfind("}") + 1])
    except Exception:
        break
    text = obj.get("error", {}).get("message") or obj.get("message") or text
m = re.search(r"RESULT\n(.*?)(\n(CONTEXT:|psql:)|$)", text, re.S)
print(m.group(1).strip() if m else "")
')
  name=${file#tests/}
  if [ -z "$report" ]; then
    # no report: the test itself errored before it could finish
    broken+=("$name")
    echo "ERROR $name"
    printf '%s\n' "$out" | tail -5 | sed 's/^/      /'
    continue
  fi
  pass=$(printf '%s\n' "$report" | grep -c '^PASS' || true)
  fail=$(printf '%s\n' "$report" | grep -c '^FAIL' || true)
  total_pass=$((total_pass + pass))
  total_fail=$((total_fail + fail))
  if [ "$fail" -gt 0 ]; then
    failed+=("$name")
    echo "FAIL  $name ($fail of $((pass + fail)) checks failed)"
    printf '%s\n' "$report" | grep '^FAIL' | sed 's/^/      /'
  else
    echo "ok    $name ($pass checks)"
  fi
done

echo
echo "$total_pass checks passed, $total_fail failed, ${#broken[@]} files errored ($(echo "$files" | wc -l | tr -d ' ') files)."
if [ "$total_fail" -gt 0 ] || [ "${#broken[@]}" -gt 0 ]; then
  exit 1
fi
