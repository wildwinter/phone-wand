# Godot client

The Phone Wand addon for Godot connects your game to a running relay and turns what it sends into
Godot signals, `Vector3`, `Quaternion` and `Vector2` values. It is written entirely in GDScript, so
it works in desktop, mobile and web exports. It targets Godot 4.7, and is tested on macOS and in a
web export.

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

The `.gd.uid` files next to each script are part of the addon. Keep them: Godot uses
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

## Layouts

By default every phone shows a big **Primary** button and a smaller **Secondary** one. Your game
can choose other controls, for every phone or for each player: buttons, big round pads, toggles,
sliders, choices, text labels, direction pads, dungeon-crawler keys and empty spaces, placed by a template. [Layouts](../layouts.md) explains the templates and
controls. `PhoneWandLayout` builds them:

```gdscript
func _ready() -> void:
    # A big Shoot button, then Reload, a Zoom toggle and an ammo count below it.
    PhoneWand.set_layout(PhoneWandLayout.layout("primary-row", [
        PhoneWandLayout.button("shoot", "Shoot"),
        PhoneWandLayout.button("reload", "Reload"),
        PhoneWandLayout.toggle("zoom", "Zoom"),
        PhoneWandLayout.label("ammo", "Ammo", "12"),
    ]))
    PhoneWand.button.connect(_on_button)
    PhoneWand.control_changed.connect(_on_control)


func _on_button(player: PhoneWandPlayer, button: String, down: bool) -> void:
    if button == "shoot" and down:
        shoot(player)
        PhoneWand.set_control("ammo", ammo_left(player), player.id)   # a number becomes the label's text


func _on_control(player: PhoneWandPlayer, control: String, value: Variant) -> void:
    if control == "zoom":
        set_zoom(player, value)
```

- `set_layout(layout, id)` sends to one player, or to every phone when `id` is empty. Pass `null`
  for the default. A layout sent before a player joins does not reach them: send it from
  `player_joined` too (or again) if players can join later.
- Presses of your buttons arrive through `button` with your ids. Toggles, sliders and choices
  arrive through `control_changed`, and are kept in `player.controls`: read one with
  `player.get_control("zoom", false)`.
- A `pad` is a big round button, like the default Primary. Its presses arrive through `button`
  with its id, just like a button's. A `space` is an empty cell that takes up room; it has no id,
  so leave it out when you look up controls (see [below](#pad-and-space)).
- A `dpad` (four arrows) or `crawl` (forward, back, step left and right, turn left and right) is
  a set of buttons named `<id>.<direction>`, such as `move.up` or `walk.turn-left`. Their presses
  arrive through `button` like any other, and `is_pressed` works with them. They have no value.
  `PhoneWandLayout.button_for(id, direction)` builds the name from the direction constants (see
  [below](#dpad-and-crawl)).
- Values have the type their control takes: a toggle's `bool`, a slider's `float` from 0 to 1, a
  choice's option index as an `int` (although Godot's JSON parser reads every number as a
  float), and a label's `String`.
- A layout or value the relay can't use (an unknown template, too many controls, a toggle set to
  a number) changes nothing, and comes back through `relay_error`. With nothing connected to that
  signal, the client prints the message as a warning.

The layout is a plain `Dictionary` in the [protocol's](../protocol.md#layouts) JSON shape, so you
can also write it out by hand or load it from a JSON file.

### Dpad and crawl

```gdscript
func _ready() -> void:
    # Dungeon-crawler keys as the big control, with a Use button below.
    PhoneWand.set_layout(PhoneWandLayout.layout("primary-secondary", [
        PhoneWandLayout.crawl("walk"),
        PhoneWandLayout.button("use", "Use"),
    ]))
    PhoneWand.button.connect(_on_button)


func _on_button(player: PhoneWandPlayer, button: String, down: bool) -> void:
    if not down:
        return
    match button:
        "walk.forward": step(player, 1)
        "walk.back": step(player, -1)
        "walk.turn-left": turn(player, -90)
        "walk.turn-right": turn(player, 90)
        "use": use(player)


func _process(_delta: float) -> void:
    # Held directions work with is_pressed too.
    for player in PhoneWand.players_by_slot():
        if player.is_pressed(PhoneWandLayout.button_for("walk", PhoneWandLayout.STEP_LEFT)):
            strafe(player, -1)
```

In the primary templates the first control must be a button, pad, dpad or crawl.

### Pad and space

```gdscript
func _ready() -> void:
    # A big round Fire pad in the middle of the top row, with Jump and Duck below.
    PhoneWand.set_layout(PhoneWandLayout.rows([3, 2], [
        PhoneWandLayout.space(),
        PhoneWandLayout.pad("fire", "Fire"),
        PhoneWandLayout.space(),
        PhoneWandLayout.button("jump", "Jump"),
        PhoneWandLayout.button("duck", "Duck"),
    ], [2, 1]))
```

A pad's presses arrive through `button` as `"fire"`, and `player.is_pressed("fire")` works. Neither
a pad nor a space has a value. Layouts that come back from the relay in `player.layout` can hold
spaces without an `"id"`, so read a control's id with `c.get("id", "")`; `find_control` never
matches a space.

### Rows and columns

The `rows` and `columns` templates let you arrange up to 8 controls yourself. `rows(counts,
controls, heights)` says how many controls go in each row, from the top (the end the player points
with) to the bottom: 1 to 4 rows of 1 to 4 controls, adding up to the number of controls.
`columns(counts, controls, widths)` does the same for columns from left to right, mirrored for
left-handed players. Any control can go in any position.

`heights` and `widths` are optional relative sizes, one positive number per row or column; leave
them out for equal sizes. The relay raises any size under a tenth of the biggest to a tenth.

```gdscript
func _ready() -> void:
    # Crawl keys filling the top three fifths, with Use, Map and a score in a row below.
    PhoneWand.set_layout(PhoneWandLayout.rows([1, 3], [
        PhoneWandLayout.crawl("walk"),
        PhoneWandLayout.button("use", "Use"),
        PhoneWandLayout.toggle("map", "Map"),
        PhoneWandLayout.label("score", "Score", "0"),
    ], [3, 2]))
```

Layouts that come back from the relay keep these fields: `player.layout["rows"]` and
`player.layout["heights"]` (or `"columns"` and `"widths"`).

## Gestures

Players can also flick the phone towards the screen, pull it back, shake it or twist their wrist.
The relay spots these movements and the client fires `gesture`; see [Gestures](../gestures.md) for
what each one is and what works well.

```gdscript
func _ready() -> void:
    PhoneWand.gesture.connect(_on_gesture)
    PhoneWand.configure_gestures(9.0)   # needs a firmer flick than the default 7


func _on_gesture(player: PhoneWandPlayer, gesture: Dictionary) -> void:
    match gesture["gesture"]:
        "pull":
            if "primary" in gesture["buttons"]:
                draw_bow(player, gesture["strength"])
        "push":
            throw_from(player, gesture["dir"] * gesture["speed"])   # dir is in Godot's frame
        "shake":
            shuffle(player)
```

The `gesture` Dictionary holds:

| Key | Meaning |
|---|---|
| `gesture: String` | Movements: `"push"` (towards the screen), `"pull"`, `"left"`, `"right"`, `"up"`, `"down"`, `"shake"`. Fast rotations: `"flick-up"`, `"flick-down"`, `"flick-left"`, `"flick-right"`, `"twist-left"`, `"twist-right"`. |
| `strength: float` | 0 to 1: how vigorous, relative to a strong flick, shake or twist. |
| `speed: float` | Movements and shakes: peak speed in m/s (0 for flicks and twists). |
| `dir: Vector3` | Movements: unit direction in Godot's frame (so a push is about `Vector3.FORWARD`); zero otherwise. |
| `angle: float` | Flicks and twists: how far the phone turned, in degrees (0 for movements). |
| `duration: float` | How long it took, in milliseconds. |
| `t: float` | Relay time it started. |
| `buttons: PackedStringArray` | Button ids held when it started, sorted. |

Sensitivity is set per app with the `gesture_threshold`, `gesture_min_speed`, `gesture_flick_rate`, `gesture_twist_rate`
and `gestures_enabled` properties (in the inspector under Gestures), or with
`configure_gestures(threshold, min_speed, twist_rate)` and `set_gestures_enabled(false)`. The
client sends them when it connects and again after every reconnect.

To recognise movements yourself, read `player.accel` on each pose: the phone's acceleration in
m/s², gravity removed, in Godot's frame (`has_accel` is false if the phone didn't send it).

## API reference

### PhoneWandClient (the `PhoneWand` autoload)

Properties:

| Property | Meaning |
|---|---|
| `url: String` | The relay's app endpoint. Default `ws://127.0.0.1:8480/app`. Setting it while connected reconnects to the new address. |
| `auto_connect: bool` | Connect when the node is ready. Default `true`. |
| `reconnect: bool` | Reconnect when the relay goes away, waiting 0.5 s, then 1, 2, 4 and at most 5 s between tries. Default `true`. |
| `start_relay: bool` | Start the relay program from your game, hidden, if none is running, and stop it when the client goes. Default `false`. See [Starting the relay from your game](#starting-the-relay-from-your-game). |
| `relay_path: String` | The `phone-wand-relay` folder, or the relay executable itself. Empty (the default) means `res://phone-wand-relay` in the editor, and `phone-wand-relay` beside the exported executable. |
| `relay_arguments: PackedStringArray` | Extra relay options, for example `["--max-players", "8"]`. |
| `gestures_enabled: bool` | Send this app `gesture` signals. Default `true`. See [Gestures](#gestures). |
| `gesture_threshold: float` | Acceleration in m/s² that starts a movement; lower is more sensitive. Default `7.0`. |
| `gesture_min_speed: float` | Peak speed in m/s a movement must reach. Default `0.35`. |
| `gesture_flick_rate: float` | Turning speed in degrees per second that makes a flick. Default `250.0`. |
| `gesture_twist_rate: float` | Rolling speed in degrees per second that makes a twist. Default `360.0`. |
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
| `player_changed(player)` | State, name, colour, label, calibration, transport or layout changed. A new layout replaces `player.layout`, `template` and `controls`. |
| `pose(player)` | A new pose arrived, typically 60 times a second per player. |
| `button(player, button: String, down: bool)` | `button` is the button's id in the player's layout: `"primary"` or `"secondary"` by default. Every down is followed by an up, even if the phone disconnects with a button held, or a new layout removes it. |
| `control_changed(player, control: String, value)` | A toggle (`bool`), slider (`float`, 0 to 1), choice (`int` option index) or label (`String`) changed, on the phone or because an app set it. `player.controls` already holds the new value. |
| `relay_error(message: String)` | The relay couldn't use something this app sent, such as an invalid layout. If nothing is connected, the client uses `push_warning` instead. |
| `calibrating(player, step: String)` | The player is being asked to point at a corner: `"top-left"`, `"bottom-right"`, or `"cancelled"`. |
| `calibrated(player, calibration: String)` | The player pressed Recentre (`"ray"`) or finished two-corner calibration (`"screen"`). |
| `stats(player)` | Once a second per player: see `rtt`, `rate` and `dropped`. |
| `gesture(player, gesture: Dictionary)` | The player moved the phone deliberately: a flick, shake or twist. See [Gestures](#gestures) for the Dictionary's keys. |

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
| `configure_gestures(threshold := 7.0, min_speed := 0.35, twist_rate := 360.0, flick_rate := 250.0)` | Sets this app's gesture sensitivity (the `gesture_*` properties) and turns gestures on. |
| `set_gestures_enabled(enabled: bool)` | Turns `gesture` signals on or off for this app. |
| `style(id, colour = null, label = null)` | Changes a player's colour (a `Color` or `"#rrggbb"`) and label, shown on their phone. Pass `null` to leave one unchanged. |
| `prompt(text, id := "", duration := 3000)` | Shows text on a phone, or on every phone when `id` is empty. `duration` is in milliseconds; `0` keeps it up until the next prompt; empty text clears it. |
| `haptic(pattern, id := "")` | Vibrates a phone (Android only: iPhones ignore it). `pattern` is an `int` or an array of milliseconds, alternating on and off. |
| `calibrate(mode := "screen", id := "")` | Asks a player (or everyone) to calibrate: `"screen"` for two corners, or `"ray"` to point at the middle and press Recentre. |
| `set_layout(layout, id := "")` | Chooses the controls a phone shows, or every phone's when `id` is empty. `layout` is a `Dictionary` (see [Layouts](#layouts)) or `null` for the default. |
| `set_control(control: String, value, id := "")` | Sets a toggle, slider, choice or label on a phone, or on every phone when `id` is empty. A number sent to a label becomes its text, and to a choice an `int`. |
| `handle_message(json_text)` / `handle(msg)` | Processes one relay message. The client calls these itself; they are public so tests can replay recorded sessions. |
| `poll()` | Services the connection. Called from `_process`; you only need it if you turn the node's processing off. |
| `url_override() -> String` (static) | The relay URL given at launch, if any (see below). |
| `is_relay_started() -> bool` | True while a relay that this client started is running. |
| `get_relay_pid() -> int` | The process id of the relay this client started, or `-1`. |
| `stop_relay()` | Stops the relay if this client started it. The client does this itself when it is freed (including when the game quits). |
| `relay_executable() -> String` | The relay program `start_relay` would run. |
| `relay_platform() -> String` (static) | `macos`, `windows-x64`, `linux-x64` or `linux-arm64` for this computer, or `""`. |

Smoothing settings and the other app-to-relay messages are only sent while connected. Smoothing and
gesture settings are remembered and sent again after every reconnect; the others are not queued.

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
| `has_accel: bool`, `accel: Vector3` | The phone's acceleration in m/s², gravity removed, in Godot's frame, unsmoothed. `has_accel` is false (and `accel` zero) when the pose didn't carry it, for example if motion access was refused. |
| `rig_q`, `rig_dir: Array` | The pose's quaternion and direction exactly as the relay sent them, in the rig frame. |
| `pose: Dictionary` | The last pose message as received. |
| `has_stats`, `rtt`, `rate`, `dropped` | Round trip in milliseconds, poses per second, and samples lost in the last second. `stats` holds the whole message. |
| `layout: Dictionary` | The controls the phone shows, as the relay sent it (`template` and `controls`). The default layout until an app sends one. |
| `template: String` | The layout's template, such as `"primary-secondary"`, `"grid"` or `"rows"`. |
| `controls: Dictionary` | Current values of the layout's toggles, sliders, choices and labels, by control id. Buttons have none. |

Methods: `is_pressed(button := "primary") -> bool`, `is_on_screen() -> bool`,
`screen_position(viewport_size: Vector2) -> Vector2` (pixels; returns `Vector2.ZERO` when
`has_screen` is false, so check that first), `get_control(id, default = null)` (a control's
current value), `find_control(id) -> Dictionary` (a control's definition in the layout, or empty).

### PhoneWandLayout

Static helpers that return layout and control `Dictionary`s for `set_layout`. `colour` is a
`Color` or `"#rrggbb"`, or `null` for the player's colour.

| Function | Result |
|---|---|
| `layout(template, controls: Array)` | A layout: `"primary"`, `"primary-secondary"`, `"pair"`, `"primary-row"` or `"grid"`, and its controls in order. |
| `rows(counts: Array, controls: Array, heights: Array = [])` | A `"rows"` layout: `counts` controls in each row, top to bottom, with optional relative `heights`. See [Rows and columns](#rows-and-columns). |
| `columns(counts: Array, controls: Array, widths: Array = [])` | A `"columns"` layout: `counts` controls in each column, left to right, with optional relative `widths`. |
| `default_layout()` | Primary and Secondary, what phones show until an app sends a layout. |
| `button(id, label := "", colour = null)` | A button. |
| `pad(id, label := "", colour = null)` | A big round button, like the default Primary. Presses arrive as a button with this id. |
| `space()` | An empty cell that takes up room: `{"type": "space"}`, with no id or value. |
| `toggle(id, label := "", value := false, colour = null)` | An on and off switch. |
| `slider(id, label := "", value := 0.0, vertical := false, spring = null, colour = null)` | A slider from 0 to 1. `spring` is where it returns when let go, or `null` to stay put. |
| `choice(id, options: Array, label := "", value := 0, colour = null)` | 2 to 4 options; the value is the chosen index. |
| `label(id, label := "", text := "", colour = null)` | Text only your game changes, such as a score. |
| `dpad(id, label := "", colour = null)` | Four arrows: buttons `<id>.up`, `<id>.down`, `<id>.left` and `<id>.right`. |
| `crawl(id, label := "", colour = null)` | Dungeon-crawler keys: buttons `<id>.forward`, `<id>.back`, `<id>.step-left`, `<id>.step-right`, `<id>.turn-left` and `<id>.turn-right`. |
| `button_for(control_id, direction) -> String` | The button name for one direction of a dpad or crawl: `button_for("move", PhoneWandLayout.UP)` is `"move.up"`. |

Direction constants: `UP`, `DOWN`, `LEFT`, `RIGHT` (listed in `DPAD_DIRECTIONS`) and `FORWARD`,
`BACK`, `STEP_LEFT`, `STEP_RIGHT`, `TURN_LEFT`, `TURN_RIGHT` (in `CRAWL_DIRECTIONS`), whose values
are the direction names such as `"step-left"`.

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
- lists each player who hasn't set up their aim yet ("Player 2, Bea: set up your aim on your
  phone"), since they have no cursor until they do,
- loads the join QR code from the relay as a texture (with `HTTPRequest`) and shows the join URL,
- lets you try the app-to-relay messages from the keyboard: **C** asks everyone to calibrate the
  screen, **R** asks them to recentre, **P** sends a prompt, **H** a vibration, **Q** hides or
  shows the QR code, and **L** puts the next sample layout on every phone (the default, a
  `primary-row` with a toggle and an ammo label, and a `grid` with every kind of control). The
  most recent control change shows briefly at the top, and Shoot, Reload and Fire update the
  sample labels with `set_control`.
- shows each gesture briefly at the top in the player's colour, with any held buttons (for
  example "Kit: pull + primary").

It uses the `PhoneWand` autoload when the plugin is enabled, and creates its own client otherwise.
For accurate cursors, run the demo full screen and have players use **Calibrate screen** on their
phones.

## Starting the relay from your game

When you ship a game, you probably don't want players to start the relay themselves. Turn on
`start_relay` and the client starts the relay for you, hidden (no window, terminal or browser), when
it connects, and stops it when it goes. The whole scheme, the same in every client library, is in
[Shipping the relay with your game](../shipping.md).

1. Download `phone-wand-relay-<version>-embed.zip` from the
   [releases page](https://github.com/wildwinter/phone-wand/releases), the same version as the
   addon. It holds a `phone-wand-relay` folder with one subfolder per platform (`macos`,
   `windows-x64`, `linux-x64`, `linux-arm64`). Leave out the platforms you don't ship.
2. For running in the editor, put the folder at `res://phone-wand-relay/`, so the macOS relay is
   `res://phone-wand-relay/macos/phone-wand-relay`. Don't commit it to version control: each binary
   is about 100 MB.
3. Turn it on. Either tick **Phone Wand > Start Relay** in **Project > Project Settings** (the
   `phone_wand/start_relay` setting, there while the plugin is enabled), which the `PhoneWand`
   autoload reads when it starts, or set it in code before the client connects:

   ```gdscript
   func _ready() -> void:
       PhoneWand.relay_arguments = ["--max-players", "8"]
       PhoneWand.start_relay = true   # checks for a relay, starts one if needed, then connects
   ```

   Setting `start_relay` in your first scene's `_ready` is early enough: the autoload doesn't count
   as connected until the relay's hello arrives. For a `PhoneWandClient` you create yourself, set it
   before adding the node to the tree (or before `connect_to_relay()`).

What happens then:

- Only if the client's `url` is on this computer (`127.0.0.1`, `localhost` or `[::1]`).
- The client asks `http://127.0.0.1:<port>/status.json` first (for up to a second). If a relay
  answers, for example the Phone Wand app you started while developing, it just uses that one, and
  never stops it.
- Otherwise it runs `phone-wand-relay/<platform>/phone-wand-relay` (`.exe` on Windows) with
  `--lifeline --no-open --app-port <the url's port> --log <log file>` and your `relay_arguments`.
  The relay's standard input is a pipe the game holds open: when the client is freed (or the game
  quits), it closes the pipe, which stops the relay, and ends the process if it hasn't gone within
  two seconds. If the game crashes, the pipe closes anyway and the relay stops by itself.
- The relay writes its output to `user://phone-wand-relay.log`.
- If the relay program isn't there, a warning says where the client looked, and it carries on
  trying to connect as usual.
- In web and mobile exports `start_relay` does nothing (it prints once that it is ignored): run the
  relay separately there.

`disconnect_from_relay()` does not stop a relay the client started; freeing the client does, or
call `stop_relay()`.

### Exporting

Godot can't run a program packed inside a `.pck`, so the relay has to sit beside the exported game:

- Exclude it from the pack: in the export preset's **Resources** tab, add `phone-wand-relay/*` to
  **Filters to exclude files/folders from project**. Otherwise the 100 MB binaries are packed
  into the `.pck`, where they are no use.
- Copy the `phone-wand-relay` folder next to the exported executable, for example
  `MyGame.exe` and `phone-wand-relay/windows-x64/phone-wand-relay.exe` side by side. On macOS, put
  it inside the app bundle, in `MyGame.app/Contents/MacOS/phone-wand-relay/macos/phone-wand-relay`.
- Or put it somewhere else and set `relay_path` (or the `phone_wand/relay_path` project setting) to
  the folder or to the executable.

If you sign and notarize your macOS game, sign the relay inside it with the relay's entitlements
first: see [Signing on macOS](../shipping.md#signing-on-macos). For Windows, see
[Windows](../shipping.md#windows) about the firewall prompt.

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
seconds, so you can start the relay after the game. With `start_relay` on, look for a warning about
where the client looked for the relay, and at `user://phone-wand-relay.log`.

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
repository root, with Godot 4.7:

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
  and final player state (layouts and control values included), checks the frame conversions, and
  checks control values keep their types. It prints `ALL PASS` or every
  difference, and exits non-zero on failure. Pass a different suite folder after `--`.
- `live_check.gd` connects to a running relay and checks that it sees the hello, players joining
  and poses. Start a relay with simulated players, then run:

  ```sh
  phone-wand --simulate 3
  godot --headless --path clients/godot --script res://test/live_check.gd -- ws://127.0.0.1:8480/app 5
  ```

  `run_tests.sh` runs it too when `RELAY_URL` is set.
- `managed_relay_check.gd` checks `start_relay` against real relays, on ports you choose. With the
  relay binary at `clients/godot/phone-wand-relay/macos/phone-wand-relay` (ignored by git) and
  nothing on the ports:

  ```sh
  godot --headless --path clients/godot --script res://test/managed_relay_check.gd -- start 24480 24443 /tmp/pw-data
  ```

  starts the relay, connects, frees the client and checks the relay has gone. Mode `existing`
  (with a relay already running on the app port) checks the client uses it and leaves it running;
  `quit` quits with the client still in the tree; `missing` checks the warning when there is no
  relay to start.
