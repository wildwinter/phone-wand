# Shipping the relay with your game

During development you run the relay yourself (the Phone Wand app, or `phone-wand` in a terminal).
When you ship a game or an installation, you probably don't want players to start a separate
program. Instead, each client library can start the relay for you, hidden, when your game starts,
and stop it when your game stops.

The relay stays its own program; your game starts it as a child process. Nothing about it shows:
no window, no terminal and no browser. Your game shows the join QR code itself, from the relay's
`qrUrl`, as the samples do.

Web builds can't start programs, so a web build still needs the relay running separately. Phones
and tablets can't run it either: this is for Windows, macOS and Linux builds.

## 1. Get the relay binaries

Download `phone-wand-relay-<version>-embed.zip` from the
[releases page](https://github.com/wildwinter/phone-wand/releases), using the same version as your
client library. It holds one folder:

```
phone-wand-relay/
  macos/phone-wand-relay            one universal binary (Apple silicon and Intel), signed and notarized
  windows-x64/phone-wand-relay.exe
  linux-x64/phone-wand-relay
  linux-arm64/phone-wand-relay
```

Keep the folder names: the client libraries look for `phone-wand-relay/<platform>/`. You can leave
out platforms you don't ship. Each binary is about 100 MB (the relay carries its own JavaScript
engine), so only include what you need.

## 2. Put the folder in your project

| Engine | Where | Notes |
|---|---|---|
| Unity | `Assets/StreamingAssets/phone-wand-relay/` | Unity copies StreamingAssets into every build unchanged. |
| Godot | Next to the exported game's executable (on macOS, in `Contents/MacOS` inside the `.app`). In the editor, `res://phone-wand-relay/`. | Godot can't run programs packed inside a `.pck`, so copy the folder beside your export. Add `phone-wand-relay/*` to the export preset's **Filters to exclude files/folders** so it isn't packed. |
| Unreal | `Plugins/PhoneWand/Resources/Relay/` (so `.../Relay/phone-wand-relay/<platform>/`) | The plugin's build rules stage it with packaged games. |
| Node | Anywhere; pass the folder to `startRelay`. | |

## 3. Turn it on

| Engine | Setting |
|---|---|
| Unity | **Start Relay** on the Phone Wand Client component (`StartRelay = true`). |
| Godot | `start_relay = true` on the `PhoneWand` autoload (or your `PhoneWandClient`), before it connects. |
| Unreal | **Start Relay** in Project Settings, Plugins, Phone Wand. |
| JavaScript (Node) | `await startRelay({ folder })` from `phone-wand-node.mjs`, before creating `PhoneWand`. |

Each also lets you set the path to the folder or the executable yourself, and extra relay options
(for example `--max-players 8` or `--key party`).

## What the client libraries do

This is the same in every client library:

1. **Only for a relay on this computer.** If the client's URL isn't `127.0.0.1` or `localhost`,
   nothing is started.
2. **Use a relay that's already running.** The client first asks
   `http://127.0.0.1:<app port>/status.json` (waiting up to about a second). If a relay answers,
   for example the Phone Wand app you started while developing, the client just uses it.
3. **Otherwise start one**, found at `phone-wand-relay/<platform>/phone-wand-relay` (`.exe` on
   Windows), where `<platform>` is `macos`, `windows-x64`, `linux-x64` or `linux-arm64`. On macOS
   and Linux the client makes sure the file is executable first. It runs:

   ```
   phone-wand-relay --lifeline --no-open --app-port <port> --log <log file> <your extra options>
   ```

   with a pipe as its standard input and no window. The log file is in the engine's usual place
   for per-user data (below). If the binary isn't there, the client logs a clear message saying
   where it looked, and carries on trying to connect as usual.
4. **Connect as usual.** The relay takes a moment to start; the client's normal reconnecting
   covers that.
5. **Stop it when the game stops.** When the client shuts down, it closes the relay's standard
   input, which makes the relay stop cleanly (`--lifeline`), and ends the process if it hasn't gone
   within two seconds. If the game crashes, the pipe closes anyway and the relay stops by itself,
   so it never runs on unseen.

A relay the client didn't start is never stopped by it.

| Engine | Relay log |
|---|---|
| Unity | `Application.persistentDataPath/phone-wand-relay.log` |
| Godot | `user://phone-wand-relay.log` |
| Unreal | `phone-wand-relay.log` in the project's log folder (`FPaths::ProjectLogDir()`: `Saved/Logs` in most builds; on macOS the editor uses `~/Library/Logs/Unreal Engine/<Project>Editor/`, and a sandboxed game its container) |
| Node | Where you say, or the system temporary folder |

## Relay options for games

Anything the relay accepts can go in the extra options. Useful ones:

| Option | Why |
|---|---|
| `--max-players <n>` | Your game's player count. |
| `--key <text>` | A fixed join key, so a printed QR code keeps working. |
| `--port <n>`, `--landing-port <n>` | If the defaults clash with something else on the machine. |
| `--data-dir <dir>` | Keep the relay's certificate and settings with your game's data. |

If you change the app port with `--app-port`, change your client's URL to match; the client passes
its URL's port for you.

## Signing on macOS

The macOS binary in the zip is signed with the Phone Wand developer's certificate and notarized,
so it runs from an unsigned development build straight away.

When you sign and notarize your own game, sign the relay with your identity too, **with the
relay's entitlements**. The relay compiles JavaScript as it runs, which the hardened runtime blocks
unless these entitlements are present; without them it quits at once.

Save this as `relay.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-executable-page-protection</key><true/>
</dict>
</plist>
```

Then sign the relay inside your app before signing the app itself (don't use `--deep`, which
would re-sign it without the entitlements):

```bash
codesign --force --timestamp --options runtime --entitlements relay.entitlements \
  --sign "Developer ID Application: Your Name (TEAMID)" \
  "YourGame.app/Contents/<where it is>/phone-wand-relay/macos/phone-wand-relay"
```

Your game's own entitlements are unaffected.

If your game runs in the App Sandbox (Unreal's packaged Mac games do by default), the relay runs in
it too. It works with its default data folder, but a `--data-dir` outside the sandbox container
fails with a permissions error.

## Windows

The Windows binary isn't signed. Inside a signed game that is usually fine; SmartScreen judges the
program the player starts, which is your game. The first time the relay runs, Windows Firewall
asks whether it may accept connections: players must allow it on private networks, or phones can't
connect. Mention this in your game's instructions, or add a firewall rule in your installer for
`phone-wand-relay.exe` (inbound TCP, private networks).
