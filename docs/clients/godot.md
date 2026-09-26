# Godot client

The Phone Wand addon for Godot connects your game to a running relay and turns what it sends into
Godot signals, `Vector3`, `Quaternion` and `Vector2` values. It is written entirely in GDScript, so
it works in desktop, mobile and web exports, and it supports Godot 4.4 and newer.

If you have not run the relay yet, start with [Getting started](../getting-started.md). No phone
to hand? `phone-wand --simulate 3` gives you three simulated players to develop against.

## Installation

1. Download `phone-wand-godot-<version>.zip` from the
   [latest release](https://github.com/wildwinter/phone-wand/releases/latest).
2. Copy its `addons/phone_wand` folder into your project, so you have
   `res://addons/phone_wand/plugin.cfg`.
3. In Godot, open **Project > Project Settings > Plugins** and enable **Phone Wand**.

Enabling the plugin adds an autoload called `PhoneWand` (a `PhoneWandClient` node). It connects to
the relay at `ws://127.0.0.1:8480/app` as soon as the game starts, and reconnects by itself if the
relay is restarted. Disabling the plugin removes the autoload.

You do not have to use the autoload. `PhoneWandClient` is an ordinary node: add one to a scene (or
create one with `PhoneWandClient.new()`) if you would rather own its lifetime, want to connect to
more than one relay, or have not enabled the plugin.

The `.gd.uid` files next to each script are part of the addon. Keep them: Godot 4.4 and later use
them to keep references stable when files move.

## Quick start

```gdscript
extends Node2D

var cursors := {}  # player id -> Sprite2D


func _ready() -> void:
    PhoneWand.player_joined.connect(_on_joined)
    PhoneWand.player_left.connect(_on_left)
    PhoneWand.pose.connect(_on_pose)
    PhoneWand.button.connect(_on_button)


func _on_joined(player: PhoneWandPlayer) -> void:
    var sprite := Sprite2D.new()
    sprite.texture = preload("res://cursor.png")
    sprite.modulate = player.colour
    add_child(sprite)
    cursors[player.id] = sprite


func _on_left(player: PhoneWandPlayer) -> void:
    cursors[player.id].queue_free()
    cursors.erase(player.id)


func _on_pose(player: PhoneWandPlayer) -> void:
    var sprite: Sprite2D = cursors[player.id]
    sprite.visible = player.has_screen
    if player.has_screen:
        sprite.position = player.screen_position(get_viewport_rect().size)


func _on_button(player: PhoneWandPlayer, button: String, down: bool) -> void:
    if button == "primary" and down:
        print(player.name, " fired at ", player.screen)
```

`player_joined` fires for every player already connected when your game connects, so the code
above works whether the phones joined before or after the game started.

For 3D, aim something with the player's orientation:

```gdscript
func _on_pose(player: PhoneWandPlayer) -> void:
    $Wand.quaternion = player.rotation   # points along -z, like every Godot node
    $RayCast3D.target_position = player.dir * 100.0
```

You do not have to use signals. Every player object is kept up to date, so you can read
`PhoneWand.players` (or `PhoneWand.players_by_slot()`) in `_process` instead.

## API reference

### PhoneWandClient (the `PhoneWand` autoload)

Properties:

| Property | Meaning |
|---|---|
| `url: String` | The relay's app endpoint. Default `ws://127.0.0.1:8480/app`. Setting it while connected reconnects to the new address. |
| `auto_connect: bool` | Connect when the node is ready. Default `true`. |
| `reconnect: bool` | Reconnect when the relay goes away, waiting 0.5 s, then 1, 2, 4 and at most 5 s between tries. Default `true`. |
| `players: Dictionary` | Players by id (`String` to `PhoneWandPlayer`). |
| `hello: Dictionary` | The relay's hello: `protocol`, `relay` (its version), `joinUrl`, `qrUrl`, `maxPlayers`. Empty when not connected. |

Constants: `VERSION` (`"0.1.0"`), `PROTOCOL_VERSION` (`0`), `DEFAULT_URL`.

Signals:

| Signal | When |
|---|---|
| `connected(hello: Dictionary)` | The relay's hello arrived. `player_joined` follows for each player already there. |
| `disconnected()` | The connection was lost. `player_left` fires for every player first. |
| `player_joined(player)` | A player took a slot. |
| `player_left(player)` | A player's slot is free again. A phone that disconnects has 60 seconds to come back before this fires. |
| `player_changed(player)` | State, name, colour, label, calibration or transport changed. |
| `pose(player)` | A new pose arrived, typically 60 times a second per player. |
| `button(player, button: String, down: bool)` | `button` is `"primary"` or `"secondary"`. Every down is followed by an up, even if the phone disconnects with a button held. |
| `calibrating(player, step: String)` | The player is being asked to point at a corner: `"top-left"`, `"bottom-right"`, or `"cancelled"`. |
| `calibrated(player, calibration: String)` | The player pressed Recentre (`"ray"`) or finished two-corner calibration (`"screen"`). |
| `stats(player)` | Once a second per player: see `rtt`, `rate` and `dropped`. |

Every signal passes the same `PhoneWandPlayer` object for a given player, updated in place.

Methods:

| Method | What it does |
|---|---|
| `connect_to_relay(url := "")` | Starts connecting (only needed if `auto_connect` is off, or after `disconnect_from_relay`). Pass a URL to change it first. |
| `disconnect_from_relay()` | Closes the connection and stops reconnecting. `player_left` and `disconnected` fire as usual. |
| `is_relay_connected() -> bool` | True once the hello has arrived. |
| `players_by_slot() -> Array[PhoneWandPlayer]` | The players sorted by slot. |
| `get_player(id) -> PhoneWandPlayer` | The player with this id, or `null`. |
| `get_player_in_slot(slot) -> PhoneWandPlayer` | The player in this slot, or `null`. |
| `get_join_url() -> String` | The URL phones open. |
| `get_qr_url(size := 0) -> String` | A PNG QR code of the join URL, optionally at a size in pixels. |
| `configure_smoothing(min_cutoff := 1.0, beta := 5.0, d_cutoff := 1.0)` | Sets the One Euro filter the relay applies to this app's poses. Lower `min_cutoff` is steadier when still; higher `beta` follows fast movement more closely. |
| `set_raw()` | Turns smoothing off for this app. |
| `style(id, colour = null, label = null)` | Changes a player's colour (a `Color` or `"#rrggbb"`) and label, shown on their phone. Pass `null` to leave one unchanged. |
| `prompt(text, id := "", duration := 3000)` | Shows text on a phone, or on every phone when `id` is empty. `duration` is in milliseconds; `0` keeps it up until the next prompt; empty text clears it. |
| `haptic(pattern, id := "")` | Vibrates a phone (Android only: iPhones ignore it). `pattern` is an `int` or an array of milliseconds, alternating on and off. |
| `calibrate(mode := "screen", id := "")` | Asks a player (or everyone) to calibrate: `"screen"` for two corners, or `"ray"` to point at the middle and press Recentre. |
| `handle_message(json_text)` / `handle(msg)` | Processes one relay message. The client calls these itself; they are public so tests can replay recorded sessions. |
| `poll()` | Services the connection. Called from `_process`; you only need it if you turn the node's processing off. |
| `url_override() -> String` (static) | The relay URL given at launch, if any (see below). |

Smoothing settings and the other app-to-relay messages are only sent while connected. Smoothing is
remembered and sent again after every reconnect; the others are not queued.

The client keeps working while the scene tree is paused (its `process_mode` is `ALWAYS`).

#### Choosing the relay at launch

A client whose `url` is still the default looks for an override when it becomes ready:

- desktop and mobile builds: a user command-line argument, for example
  `godot --path . -- --phone-wand-url=ws://127.0.0.1:9000/app`
- web builds: the page's `relay` query parameter, for example
  `index.html?relay=ws://127.0.0.1:9000/app`

### PhoneWandPlayer

A `RefCounted` object per player, owned by the client and updated in place. Read its fields; do
not change them.

| Field | Meaning |
|---|---|
| `id: String` | Unique for the lifetime of the relay. A phone that reconnects keeps its id and slot. |
| `slot: int` | 0-based player number, lowest free first. |
| `name: String` | Chosen on the phone. |
| `colour: Color`, `colour_hex: String` | The player's colour, and the same as `"#rrggbb"`. |
| `label: String` | Extra text set with `style()`. |
| `state: String` | `"active"` (sending poses), `"paused"` (tab hidden, phone locked, or no data for half a second) or `"waiting"` (not yet allowed motion access). |
| `calibration: String` | `"none"`, `"ray"` or `"screen"`. |
| `calibrating: String` | The corner being calibrated, or `""`. |
| `platform`, `sensor`, `transport: String` | From the phone: `"iOS"`/`"Android"`/`"other"`; the sensor used; `"ws"` or `"http"`. |
| `buttons: Array[String]` | Buttons currently held. Cleared when the player stops being active. |
| `has_pose: bool` | False until the first pose arrives. |
| `seq: int` | The phone's sample counter. |
| `t: float` | When the relay received the sample, in milliseconds since the Unix epoch. |
| `yaw`, `pitch`, `roll: float` | Degrees. Yaw is positive to the right, pitch upwards, roll clockwise as seen from behind. |
| `dir: Vector3` | Unit pointing direction in Godot's frame. |
| `rotation: Quaternion` | The phone's orientation in Godot's frame. |
| `has_screen: bool`, `screen: Vector2` | Normalised screen position: `(0, 0)` top-left, `(1, 1)` bottom-right, outside 0..1 when pointing off the screen. `has_screen` is false when the phone points more than about 87 degrees away from forward. |
| `rig_q`, `rig_dir: Array` | The pose's quaternion and direction exactly as the relay sent them, in the rig frame. |
| `pose: Dictionary` | The last pose message as received. |
| `has_stats`, `rtt`, `rate`, `dropped` | Round trip in milliseconds, poses per second, and samples lost in the last second. `stats` holds the whole message. |

Methods: `is_pressed(button := "primary") -> bool`, `is_on_screen() -> bool`,
`screen_position(viewport_size: Vector2) -> Vector2` (pixels; returns `Vector2.ZERO` when
`has_screen` is false, so check that first).

### PhoneWandFrames

Static conversion helpers, used by `PhoneWandPlayer` and available to you:

| Function | Result |
|---|---|
| `dir_to_godot(rig: Array) -> Vector3` | `[r, u, f]` to `Vector3(r, u, -f)`. |
| `quat_to_godot(rig: Array) -> Quaternion` | `[x, y, z, w]` to `Quaternion(-x, -y, z, w)`, normalised. |
| `dir_to_rig(v: Vector3) -> Array`, `quat_to_rig(q: Quaternion) -> Array` | The reverse. |
| `yaw_pitch_to_godot(yaw, pitch) -> Vector3` | The ray for angles in degrees. |
| `screen_to_pixels(screen: Vector2, size: Vector2) -> Vector2` | `screen * size`. |

## Frames and conversions

The relay describes directions in its own rig frame, `[right, up, forward]`, where forward is where
the player pointed when they pressed Recentre, or the middle of the calibrated screen. Godot is
right-handed with x right, y up and **-z forward**, so the addon converts:

- directions: `[r, u, f]` becomes `Vector3(r, u, -f)`
- orientations: `[x, y, z, w]` becomes `Quaternion(-x, -y, z, w)`

The phone's own axes are: right is its right-hand edge, up is out of the screen, and forward is out
of its top edge (the pointing direction). So `player.rotation * Vector3.FORWARD` equals
`player.dir`, and `player.rotation * Vector3.UP` is the direction the screen faces. A node given
`quaternion = player.rotation` points its -z axis where the phone points, which is what cameras,
`look_at` and `RayCast3D` expect. With the phone held flat and aimed straight ahead, the rotation is
the identity.

Screen positions need no conversion: `(0, 0)` is the top-left of the calibrated screen and `(1, 1)`
the bottom-right, matching Godot's 2D coordinates. Multiply by your viewport size for pixels.

The [protocol](../protocol.md) describes the frames in full.

## The demo

`addons/phone_wand/demo/cursors.tscn` is the main scene of the project in `clients/godot`, and ships
in the addon so you can run it in your own project. It:

- draws each player's coloured ring and name where they point, filled while primary is held,
- plays a ripple when primary is pressed,
- shows an arrow at the edge of the window when a player points off the screen,
- loads the join QR code from the relay as a texture (with `HTTPRequest`) and shows the join URL,
- lets you try the app-to-relay messages from the keyboard: **C** asks everyone to calibrate the
  screen, **R** asks them to recentre, **P** sends a prompt, **H** a vibration, and **Q** hides or
  shows the QR code.

It uses the `PhoneWand` autoload when the plugin is enabled, and creates its own client otherwise.
For accurate cursors, run the demo full screen and have players use **Calibrate screen** on their
phones.

## Web exports

The addon uses `WebSocketPeer` and `HTTPRequest`, which Godot implements with the browser's own
WebSocket and fetch in web exports, and it does not need threads, so the "no threads" web export
works. Where it gets harder is the browser's security rules, because the relay's main app port is
plain `ws://` on `127.0.0.1`.

**What works reliably:** serve the exported game from the same computer as the relay, over plain
HTTP from `localhost` or `127.0.0.1`. Godot's **Remote Debug > Run in Browser** does exactly this
(at `http://localhost:8060`), as does any local static server, for example
`python3 -m http.server 8000` in the export folder. The page and the relay are then both on this
computer, there is no mixed content, and the relay accepts the connection.

**Pages served over HTTPS** (itch.io, GitHub Pages, your own site) are a problem:

- A page loaded over `https://` opening a `ws://` connection is mixed content. Chrome and Firefox
  currently treat `127.0.0.1` and `localhost` as trustworthy and usually allow it; Safari blocks it.
  Browsers are also adding permission prompts for public websites that reach into your own computer
  or network (Chrome calls this Local Network Access), so a player may be asked to allow it. These
  rules differ between browsers and change between versions, so do not rely on them for anything
  that must work.
- The relay only accepts app connections from web pages on this computer (`localhost`,
  `127.0.0.1`, `[::1]` or `*.localhost` origins). A page from anywhere else is refused with a 403
  unless you start the relay with `--allow-origin <origin>`, for example
  `phone-wand --allow-origin https://example.itch.io`. Only allow origins you trust: any page from
  that origin, open in a browser on this computer, could then read the players' input and send
  prompts to their phones.
- To avoid mixed content, connect securely to `wss://127.0.0.1:8443/app` (the relay's phone port,
  which answers app connections only from its own computer), for example with
  `?relay=wss://127.0.0.1:8443/app`. The browser must trust the relay's certificate: open
  `https://127.0.0.1:8443/` once and accept the warning, or install `~/.phone-wand/ca.crt.pem` on
  the computer.

**A page on a different computer from the relay** needs the relay started with
`--app-host 0.0.0.0` (so other machines can connect), `--allow-origin` for the page's origin, the
page served over plain `http://`, and the relay's address passed in, for example
`index.html?relay=ws://192.168.1.20:8480/app`.

In short: for events and installations, use a desktop export, or a web export served from
`localhost` on the display machine.

Use `?relay=ws://host:port/app` in the page URL to point a web build at a relay that is not on the
default address.

## Troubleshooting

**Nothing happens, and `is_relay_connected()` stays false.** Check the relay is running and note the
app port it prints (8480 unless you changed it with `--app-port`). The client retries every few
seconds, so you can start the relay after the game.

**"Unable to set TCP no delay option" warnings in the output.** Godot prints this on macOS and
Linux each time a connection attempt fails, which happens every few seconds while the relay is not
running. It is harmless and stops once the relay is up.

**The cursor is offset or drifts.** Have the player press Recentre while pointing at the middle of
the screen, or better, use Calibrate screen with the game full screen. See
[Calibration and precision](../calibration.md).

**Cursors are jittery, or lag behind.** Adjust smoothing with `configure_smoothing()`: lower
`min_cutoff` (say 0.5) for steadier aim when still, higher `beta` (say 10) for less lag when moving.

**`PhoneWand` is an unknown identifier.** The plugin is not enabled, or another autoload already
uses the name `PhoneWand`. Enable the plugin, or add a `PhoneWandClient` node yourself.

**Errors about `PhoneWandClient` or `PhoneWandPlayer` not being found after copying the addon.**
Let the editor finish importing (or run `godot --headless --path . --import` once) so it registers
the addon's class names.

**Web build cannot connect.** See [Web exports](#web-exports). The browser's developer console
shows mixed content and connection errors, and the relay logs "Refused an app connection" when it
turns away a page's origin.

## Testing

The project in `clients/godot` contains the tests (they are not part of the addon). From the
repository root, with Godot 4.4 or newer:

```sh
clients/godot/test/run_tests.sh                     # parse check and conformance suite
GODOT=/path/to/godot clients/godot/test/run_tests.sh
```

Or step by step:

```sh
godot --headless --path clients/godot --import
clients/godot/test/parse_check.sh
godot --headless --path clients/godot --script res://test/test_conformance.gd
```

- `parse_check.sh` parses every script in the addon on its own, because a script that does not
  parse stops a whole project from opening.
- `test_conformance.gd` replays every session in the repository's
  [conformance suite](../../conformance/README.md) through `handle_message`, compares the event log
  and final player state, and checks the frame conversions. It prints `ALL PASS` or every
  difference, and exits non-zero on failure. Pass a different suite folder after `--`.
- `live_check.gd` connects to a running relay and checks that it sees the hello, players joining
  and poses. Start a relay with simulated players, then run:

  ```sh
  phone-wand --simulate 3
  godot --headless --path clients/godot --script res://test/live_check.gd -- ws://127.0.0.1:8480/app 5
  ```

  `run_tests.sh` runs it too when `RELAY_URL` is set.
