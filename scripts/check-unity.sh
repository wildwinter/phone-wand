#!/usr/bin/env bash
# Compile the Phone Wand Unity package, its sample and the demo project with the Unity editor you
# have installed, and check the frame conversions with Unity's own maths.
#
# The dotnet TestHost (clients/unity/TestHost) covers the engine-free core and runs anywhere. It
# cannot compile the parts that use UnityEngine: the PhoneWandClient component, the WebGL
# transport, the Cursors sample and the demo. This script does.
#
# A batch-mode Unity can exit 0 with a project full of compiler errors, so the LOG decides the
# outcome here, together with proof that every assembly was freshly compiled.
#
#   scripts/check-unity.sh                 compile check + conversions
#   scripts/check-unity.sh --live [url]    also connect to a running relay (default
#                                          ws://127.0.0.1:8480/app) for 3 seconds and require a
#                                          hello, joins and poses. Start the relay with simulated
#                                          players first:  bun run sim
#   UNITY_PATH=/path/to/Unity scripts/check-unity.sh
set -e

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
project="$root/clients/unity/PhoneWandDemo"
samples="$root/clients/unity/PhoneWand/Samples~"
staged="$project/Assets/Samples"

live=""
live_url="ws://127.0.0.1:8480/app"
while [ $# -gt 0 ]; do
  case "$1" in
    --live)
      live=1
      if [ -n "${2:-}" ] && [ "${2#-}" = "$2" ]; then live_url="$2"; shift; fi
      ;;
    -h|--help)
      sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "check-unity: unknown argument $1" >&2
      exit 2
      ;;
  esac
  shift
done

unity="${UNITY_PATH:-}"
if [ -z "$unity" ]; then
  # The newest Hub editor. sort -V so 6000.4.10 beats 6000.4.6.
  unity="$(ls -d /Applications/Unity/Hub/Editor/*/Unity.app/Contents/MacOS/Unity 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ ! -x "$unity" ]; then
  echo "check-unity: no Unity editor found." >&2
  echo "  Install one through Unity Hub, or point at it: UNITY_PATH=/path/to/Unity $0" >&2
  exit 2
fi

logdir="$(mktemp -d "${TMPDIR:-/tmp}/check-unity.XXXXXX")"
# Unity's build step can crash under a long TMPDIR, so it gets a short one of its own.
unity_tmp="$(mktemp -d /tmp/check-unity-tmp.XXXXXX)"
stamp="$logdir/stamp"
touch "$stamp"

# Unity ignores folders ending in ~, so the sample is invisible where it lives. Copy it into the
# demo for the run (with its .meta files, so the scene's script references resolve) and remove it,
# and the .meta Unity writes beside it, afterwards.
cleanup() { rm -rf "$staged" "$staged.meta" "$unity_tmp"; }
trap cleanup EXIT
rm -rf "$staged" "$staged.meta"
mkdir -p "$staged"
cp -R "$samples/." "$staged/"

# Clear the compiled assemblies so the run must compile them all, then require each to be newer
# than the stamp. A crashed or licence-blocked Unity compiles nothing and fails here.
assemblies="$project/Library/ScriptAssemblies"
expected=(StoryTools.PhoneWand.Core.dll StoryTools.PhoneWand.dll Assembly-CSharp.dll Assembly-CSharp-Editor.dll)
rm -rf "$assemblies"

run_unity() {
  # $1: log file; the rest: extra arguments.
  local log="$1"
  shift
  rm -f "$log"
  local status=0
  TMPDIR="$unity_tmp" "$unity" -batchmode -nographics -projectPath "$project" -logFile "$log" "$@" >/dev/null 2>&1 || status=$?
  if [ ! -f "$log" ]; then
    echo "check-unity: Unity wrote no log; something stopped it before it started." >&2
    exit 1
  fi
  return $status
}

echo "check-unity: $unity"
log="$logdir/compile.log"
# Compile everything, then check conversions.json with UnityEngine's Quaternion and Vector3.
# -ignorecompilererrors so Unity reports every error rather than stopping at the first.
status=0
run_unity "$log" -ignorecompilererrors -executeMethod PhoneWandChecks.Conversions || status=$?

errors="$(grep -c "error CS" "$log" || true)"
if [ "$errors" -gt 0 ]; then
  echo "check-unity: $errors compiler error(s):" >&2
  grep "error CS" "$log" | sort -u | sed 's/^/  /' >&2
  exit 1
fi
if grep -q "Unhandled exception\|Aborting batchmode due to failure\|Scripts have compiler errors" "$log"; then
  echo "check-unity: Unity did not finish:" >&2
  grep "Unhandled exception\|Aborting batchmode due to failure\|Scripts have compiler errors" "$log" | sort -u | sed 's/^/  /' >&2
  echo "  See: $log" >&2
  exit 1
fi
missing=()
for dll in "${expected[@]}"; do
  [ "$assemblies/$dll" -nt "$stamp" ] || missing+=("$dll")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "check-unity: Unity did not compile ${missing[*]}, so nothing proves the scripts build." >&2
  echo "  (A licence prompt, a project open in another editor, or a crashed build will do this.)  See: $log" >&2
  exit 1
fi
warnings="$(grep "warning CS" "$log" | grep -c "PhoneWand" || true)"
if [ "$warnings" -gt 0 ]; then
  echo "check-unity: $warnings compiler warning(s) in Phone Wand code:" >&2
  grep "warning CS" "$log" | grep "PhoneWand" | sort -u | sed 's/^/  /' >&2
fi
echo "check-unity: the package (Core + Unity), the Cursors sample and the demo compile."

if [ "$status" -ne 0 ] || ! grep -q "PhoneWandChecks: conversions PASS" "$log"; then
  echo "check-unity: the conversions check failed:" >&2
  grep "PhoneWandChecks" "$log" | sort -u | sed 's/^/  /' >&2
  echo "  See: $log" >&2
  exit 1
fi
grep "PhoneWandChecks: conversions PASS" "$log" | head -1 | sed 's/^/check-unity: /'

if [ -n "$live" ]; then
  log="$logdir/live.log"
  echo "check-unity: live check against $live_url"
  status=0
  run_unity "$log" -executeMethod PhoneWandChecks.Live -phoneWandUrl "$live_url" -phoneWandSeconds 3 || status=$?
  grep "^PhoneWandChecks: " "$log" | sed 's/^/  /'
  if [ "$status" -ne 0 ] || ! grep -q "PhoneWandChecks: live PASS" "$log"; then
    echo "check-unity: the live check failed (is a relay with players running at $live_url?). See: $log" >&2
    exit 1
  fi
  echo "check-unity: live check passed."
fi

rm -rf "$logdir"
echo "check-unity: ALL PASS"
