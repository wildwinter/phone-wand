#!/usr/bin/env bash
# Runs the Phone Wand Godot tests: parse check and conformance suite.
#
#   clients/godot/test/run_tests.sh
#   GODOT=/path/to/godot clients/godot/test/run_tests.sh
#   RELAY_URL=ws://127.0.0.1:8480/app clients/godot/test/run_tests.sh   # also runs the live check
#
# The live check needs a running relay with players, for example: phone-wand --simulate 3
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
godot="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
project="$(cd "$here/.." && pwd)"

if [ ! -x "$godot" ]; then
  echo "No Godot at $godot (set GODOT=/path/to/godot)"
  exit 1
fi

"$godot" --headless --path "$project" --import >/dev/null 2>&1 || true

"$here/parse_check.sh"
"$godot" --headless --path "$project" --script res://test/test_conformance.gd

if [ -n "${RELAY_URL:-}" ]; then
  "$godot" --headless --path "$project" --script res://test/live_check.gd -- "$RELAY_URL" 5
fi
