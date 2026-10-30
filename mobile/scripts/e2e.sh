#!/usr/bin/env bash
# Runs the Maestro tap-through tests (.maestro/) on the booted iPhone
# simulator, asking for the test account instead of taking it on the command
# line (so the password isn't left in your shell history).
#
#   scripts/e2e.sh              signed-out and signed-in flows
#   scripts/e2e.sh signed-out   only the ones that need no account
#
# Use a test account, not one with your family on it: the signed-in flows send
# a check-in to its circle and clock it in and out. Each flow signs the app
# out first.
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME_17:-/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home}"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

device=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1 || true)
if [ -z "$device" ]; then
  echo "No iPhone simulator is running. Start one (open -a Simulator), install the app, then try again."
  exit 1
fi

which="${1:-all}"
if [ "$which" = "all" ] || [ "$which" = "signed-out" ]; then
  maestro --device "$device" test .maestro/signed-out
fi
if [ "$which" = "signed-out" ]; then
  exit 0
fi

echo
echo "Signed-in tests: the email and password of a Safe Circle TEST account."
read -r -p "Test account email: " email
read -r -s -p "Test account password (hidden): " password
echo
case "$email" in
  "" | *REAL-TEST* | *example.com | your-*)
    echo "That isn't a real account's email. Sign up a test account in the app first, then use its email."
    exit 1
    ;;
esac
maestro --device "$device" test -e EMAIL="$email" -e PASSWORD="$password" .maestro/signed-in
