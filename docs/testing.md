# Testing

## Simulated players

```bash
phone-wand --simulate 3
```

adds three players that wander around the default screen area and press Primary every few seconds.
They behave exactly like phones as far as apps can tell, so you can develop and test an app with no
phone at all. Real phones can join alongside them.

## Recording and replaying

Record every message real phones send:

```bash
phone-wand --record session.jsonl
```

Replay it later as virtual phones, in real time:

```bash
phone-wand --replay session.jsonl
phone-wand --replay session.jsonl --loop
```

This is handy for reproducing a bug, testing an app against a real play session, or comparing
smoothing settings on identical movement. Recordings are plain JSON lines: each has a time `t` in
milliseconds and either a phone message (`msg`), a connection opening (`open`) or closing (`close`).

## The conformance suite

`conformance/` holds scripted sessions, the exact messages the relay must send for them, and the
events and state every client library must produce from those messages. It keeps the relay and the
four client libraries in step. See [conformance/README.md](../conformance/README.md) for the format.

| What | Command |
|---|---|
| Relay and JavaScript client | `bun run test` |
| Conformance files are current | `bun scripts/conformance.ts --check` |
| Unity (C# core, no editor needed) | `dotnet run --project clients/unity/TestHost` |
| Unity (editor compile and live check) | `scripts/check-unity.sh` (add `--live` and `--managed-relay`) |
| Godot | `godot --headless --path clients/godot --script res://test/test_conformance.gd` |
| Unreal (build and automation tests) | `scripts/check-unreal.sh` |

When the relay's behaviour changes on purpose, regenerate the files with
`bun scripts/conformance.ts`, review the diff, and update the client libraries until they pass.

CI runs everything except the Unity editor and Unreal checks, which need the engines installed; run
those locally before a release.

## Testing on phones

The relay's dashboard shows each phone's platform, connection type (WebSocket or HTTP fallback),
update rate, round-trip time and dropped samples. When trying a new phone or browser, check:

1. The page loads and **Tap to start** reaches the button screen.
2. The dashboard shows the phone at around 60 Hz.
3. The cursor follows the phone smoothly after Recentre.
4. Screen calibration puts the cursor where the phone points.
5. Locking the phone shows the player as paused; unlocking resumes it as the same player.
