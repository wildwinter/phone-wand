#!/usr/bin/env bash
# Does every script in the addon parse?
#
#   clients/godot/test/parse_check.sh          # needs Godot; skips cleanly without it
#   GODOT=/path/to/godot clients/godot/test/parse_check.sh
#
# Godot parses every script in a project when the project opens, so one bad file in the addon
# stops a user's whole project loading. The named --script test runs only parse what they reach
# (the demo and the editor plugin are reached by none of them), so this checks each file on its own
# with one --check-only run per file.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
godot="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
project="$(cd "$here/.." && pwd)"
addon="${1:-$project/addons}"

if [ ! -x "$godot" ]; then
  echo "SKIP parse_check: no Godot at $godot (set GODOT=/path/to/godot)"
  exit 0
fi

# Import first so the addon's class_name globals are in the project's script cache; without it,
# every script that names PhoneWandClient or PhoneWandPlayer reports a false parse error.
"$godot" --headless --path "$project" --import >/dev/null 2>&1 || true

broken=0
count=0
while IFS= read -r file; do
  count=$((count + 1))
  rel="${file#"$project"/}"
  # Godot reports a parse failure in its output and still exits 0, so the output is the verdict.
  out="$("$godot" --headless --path "$project" --check-only --script "res://$rel" 2>&1 \
        | grep -E "Parse Error|SCRIPT ERROR|Failed to load script" || true)"
  if [ -n "$out" ]; then
    broken=$((broken + 1))
    echo "PARSE CHECK: FAIL $rel"
    echo "$out" | sed 's/^/  /' | head -5
  fi
done < <(find "$addon" -name '*.gd' | sort)

if [ "$broken" -gt 0 ]; then
  echo "PARSE CHECK: $broken of $count script(s) do not parse"
  exit 1
fi
echo "PARSE CHECK: ALL PASS ($count scripts, $("$godot" --headless --version 2>/dev/null | head -1))"
