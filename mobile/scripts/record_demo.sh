#!/usr/bin/env bash
# Records the booted iPhone simulator to docs/demo-video/<date-time>.mp4, as a
# backup in case the live demo can't run (Wi-Fi, an expired signing, ...).
# Press Ctrl+C to stop. The shot list is in docs/demo-script.md.
#
#   mobile/scripts/record_demo.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
if ! xcrun simctl list devices booted | grep -q Booted; then
  echo "No simulator is running. Start one (npx expo run:ios) and sign in first."
  exit 1
fi
mkdir -p docs/demo-video
out="docs/demo-video/safe-circle-$(date +%Y%m%d-%H%M).mp4"
echo "Recording to $out — press Ctrl+C to stop."
xcrun simctl io booted recordVideo --codec=h264 --force "$out"
