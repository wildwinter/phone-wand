#!/usr/bin/env bash
# Build the Phone Wand Unreal plugin and demo with an installed Unreal Engine, then run the
# PhoneWand automation tests headless (conformance replay, conversions, library, client).
#
# A GitHub-hosted runner has no Unreal on it, so CI cannot run this; run it on a machine that has
# Unreal installed (or a self-hosted runner). No licence or secret is involved.
#
# Usage:  scripts/check-unreal.sh
#         UE_ROOT=/path/to/UE_5.7 scripts/check-unreal.sh
#         PHONEWAND_LIVE_URL=ws://127.0.0.1:8480/app scripts/check-unreal.sh   (also test a running relay)
#         SKIP_BUILD=1 scripts/check-unreal.sh                                  (tests only)
#
# Exit status: 0 when everything compiles and every test passes, 1 on a failure, 2 when no
# Unreal installation was found.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
project="$root/clients/unreal/PhoneWandDemo/PhoneWandDemo.uproject"

case "$(uname -s)" in
  Darwin) platform=Mac ;;
  Linux) platform=Linux ;;
  MINGW*|MSYS*|CYGWIN*) platform=Win64 ;;
  *) echo "check-unreal: unsupported OS $(uname -s)" >&2; exit 2 ;;
esac

ue="${UE_ROOT:-}"
if [ -z "$ue" ]; then
  # Match the engine version the .uproject declares rather than taking the newest, because a
  # newer engine silently upgrades the project when it opens it.
  want="$(sed -n 's/.*"EngineAssociation"[^"]*"\([^"]*\)".*/\1/p' "$project")"
  for base in /Volumes/Data/Unreal "/Users/Shared/Epic Games" "/Applications/Epic Games" "/c/Program Files/Epic Games" "$HOME/UnrealEngine"; do
    if [ -d "$base/UE_$want" ]; then ue="$base/UE_$want"; break; fi
  done
fi

case "$platform" in
  Win64) build="$ue/Engine/Build/BatchFiles/Build.bat"; editor="$ue/Engine/Binaries/Win64/UnrealEditor-Cmd.exe" ;;
  *) build="$ue/Engine/Build/BatchFiles/$platform/Build.sh"; editor="$ue/Engine/Binaries/$platform/UnrealEditor-Cmd" ;;
esac
if [ -z "$ue" ] || [ ! -e "$build" ] || [ ! -e "$editor" ]; then
  echo "check-unreal: no Unreal found (set UE_ROOT to a UE_x.y directory)" >&2
  exit 2
fi
echo "check-unreal: engine $ue"

# ---------------------------------------------------------------- build

if [ -z "${SKIP_BUILD:-}" ]; then
  echo "check-unreal: building PhoneWandDemoEditor ($platform Development)"
  "$build" PhoneWandDemoEditor "$platform" Development -Project="$project" -waitmutex
  echo "check-unreal: the plugin and demo compile."
fi

# ---------------------------------------------------------------- tests

tmp="${TMPDIR:-/tmp}"
out="$(mktemp -d "${tmp%/}/phonewand-unreal.XXXXXX")"
log="$out/automation.log"
report="$out/report"
echo "check-unreal: running PhoneWand automation tests (log: $log)"

export PHONEWAND_CONFORMANCE_DIR="${PHONEWAND_CONFORMANCE_DIR:-$root/conformance}"

set +e
"$editor" "$project" \
  -ExecCmds="Automation RunTests PhoneWand; Quit" \
  -TestExit="Automation Test Queue Empty" \
  -ReportExportPath="$report" \
  -PhoneWandNoConnect \
  -unattended -nullrhi -nosplash -nopause -nosound -NoZen -stdout -FullStdOutLogOutput \
  -abslog="$log" > "$out/stdout.txt" 2>&1
status=$?
set -e

# The exit code alone is not enough: an editor that quits early, or runs no tests, can still
# return 0. Read the log.
passed=$(grep -c "Test Completed. Result={Success}" "$log" 2>/dev/null || true)
failed=$(grep -c "Test Completed. Result={Fail" "$log" 2>/dev/null || true)
passed=${passed:-0}
failed=${failed:-0}

grep -E "Test Completed. Result=" "$log" | sed -E 's/.*Result=\{([A-Za-z]+)\} Name=\{([^}]*)\}.*/  \1  \2/' || true

if [ "$failed" -gt 0 ]; then
  echo "check-unreal: $failed test(s) failed. Errors:" >&2
  grep -E "LogAutomationController: Error|Error: .*PhoneWand|Expected .* but" "$log" | head -40 >&2 || true
  exit 1
fi
if [ "$passed" -eq 0 ]; then
  echo "check-unreal: no PhoneWand tests ran (editor exit status $status). See $log" >&2
  tail -40 "$out/stdout.txt" >&2 || true
  exit 1
fi
if ! grep -q "TEST COMPLETE. EXIT CODE: 0" "$log"; then
  echo "check-unreal: the automation run did not finish cleanly (editor exit status $status). See $log" >&2
  exit 1
fi
echo "check-unreal: $passed PhoneWand tests passed."
