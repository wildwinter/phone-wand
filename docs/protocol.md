# Phone Wand protocol, version 0

This is the contract between the relay and apps (the Unity, Unreal, Godot and JavaScript client
libraries, or anything else that can open a WebSocket). It also documents the phone link, which only
the relay and the phone page use.

Protocol version 0 is a development version: it may change between releases until 1.0. Every
change is listed in the [changelog](../CHANGELOG.md).

## Overview

```
phones (browser page, HTTPS) --Wi-Fi--> relay (on the display machine) --localhost--> apps
```

- Apps connect to `ws://127.0.0.1:8480/app` (the port is configurable with `--app-port`). Web
  builds served over HTTPS, which browsers may not allow to open a plain `ws://` connection, can use
  `wss://127.0.0.1:8443/app` instead: the same endpoint on the phone port, only reachable from the
  relay's own computer.
- Every message is one JSON object in one WebSocket text frame, with a `type` field.
- Unknown message types and unknown fields must be ignored, so newer relays can add information
  without breaking older clients.
- Several apps may connect at once. Each receives every event.

## Frames and units

All angles are in **degrees**. All times are in **milliseconds**.

Directions and orientations use the **rig frame**, whose three axes are named rather than
numbered, so no engine convention is implied:

| Component | Meaning |
|---|---|
| `right` (index 0) | to the player's right |
| `up` (index 1) | up, opposite to gravity |
| `forward` (index 2) | the calibrated "forward": where the player pointed when they pressed Recentre, or the middle of the calibrated screen |

Vectors are sent as arrays `[right, up, forward]`. This happens to match Unity's axes exactly.
Each client library converts to its engine:

| Engine | Conversion from `[r, u, f]` |
|---|---|
| Unity (x right, y up, z forward, left-handed) | `new Vector3(r, u, f)` |
| Godot (x right, y up, -z forward, right-handed) | `Vector3(r, u, -f)` |
| Unreal (x forward, y right, z up, left-handed) | `FVector(f, r, u)` (scale as needed) |
| Three.js (x right, y up, -z forward) | `new Vector3(r, u, -f)` |

Quaternions are sent as `[x, y, z, w]` in the rig frame and rotate the **phone body** into the rig
frame. The phone body axes are:

- body `right` = the phone's right-hand edge (screen facing you, top pointing away),
- body `up` = out of the screen,
- body `forward` = out of the top edge of the phone, which is the pointing direction.

So the identity quaternion is "pointing forward, screen facing the ceiling", which is how people hold a
phone to aim it. The rig quaternion is used directly by Unity as `new Quaternion(x, y, z, w)`. Godot
uses `Quaternion(-x, -y, z, w)`, and Unreal uses `FQuat(z, x, y, w)`, each of which the client
libraries apply for you.

`yaw` is positive to the right, `pitch` is positive upwards, and `roll` is positive when the phone
turns clockwise as seen from behind (right edge down). The ray direction is
`[sin(yaw) cos(pitch), sin(pitch), cos(yaw) cos(pitch)]`.

### Screen coordinates

`screen` is `[x, y]` in normalised screen space: `[0, 0]` is the top-left corner and `[1, 1]` the
bottom-right. Values outside 0..1 mean the player is pointing off the screen. `screen` is `null`
when the phone points more than about 87 degrees away from forward, and while the player is doing
two-corner screen calibration (so apps hide the cursor, which would otherwise distract them).

`screen` is also `null` until the player has calibrated at least once this run (their
`calibration` is still `none`). A cursor before then would sit wherever the phone happened to be
pointing when it joined, so apps show a prompt instead, such as "Player 2: set up your aim on your
phone". `q`, the angles and `dir` are sent from the start.

Until a player calibrates a screen, the relay uses a default virtual screen 40 degrees wide and
22.5 degrees high (16:9) centred on forward, so Recentre alone gives a usable cursor.

## Players

A player object appears in `hello`, `join` and `player`:

```json
{ "id": "p3", "slot": 0, "name": "Ian", "colour": "#ff4d6d", "label": "",
  "state": "active", "calibration": "ray",
  "device": { "platform": "iOS", "sensor": "deviceorientation", "transport": "ws" },
  "layout": { "template": "primary-secondary", "controls": [ ... ] },
  "controls": { } }
```

| Field | Meaning |
|---|---|
| `id` | Unique for the lifetime of the relay. A phone that reconnects (after sleeping, or reloading the page) keeps its id and slot. |
| `slot` | 0-based player number, lowest free first. Stable while the player is connected or reconnecting. |
| `name` | Chosen on the phone. |
| `colour` | `#rrggbb`, lower case. Set by slot, overridable by apps with `style`. |
| `label` | Extra text set by apps with `style` (a team name, say). Empty by default. |
| `state` | `active` (sending poses), `paused` (tab hidden, phone locked, or no data for 0.5 s) or `waiting` (joined but has not yet allowed motion access). |
| `calibration` | `none`, `ray` (Recentre pressed) or `screen` (two-corner calibrated). |
| `device.platform` | `iOS`, `Android`, or `other`. |
| `device.sensor` | `relative-orientation-sensor` or `deviceorientation`. |
| `device.transport` | `ws` (WebSocket) or `http` (the HTTP fallback). |
| `layout` | The controls the phone shows (see [Layouts](#layouts)). Until an app sends one, the default: `primary-secondary` with buttons `primary` and `secondary`. |
| `controls` | Current values of the layout's toggles, sliders, choices and labels, by control id. Buttons have no value. |

## Relay to app

### `hello`

Sent once, immediately after connecting.

```json
{ "type": "hello", "protocol": 0, "relay": "0.1.0",
  "joinUrl": "http://192.168.1.20:8440/?k=7f3a", "qrUrl": "http://127.0.0.1:8480/qr.png",
  "maxPlayers": 4, "players": [ { "id": "p1", ... } ] }
```

`joinUrl` is the address the QR code carries: normally the relay's welcome page, which explains the
certificate warning and then continues to the secure phone page. `qrUrl` serves a PNG (append `?size=512` for a size in pixels) that engines can load as a texture.
`/qr.svg` also works.

### `join`

`{ "type": "join", "player": { ... } }`: a new player took a slot.

### `leave`

`{ "type": "leave", "id": "p1" }`: the player's slot is free again. A phone that disconnects has 60
seconds to reconnect before it leaves.

### `player`

`{ "type": "player", "player": { ... } }`: something about the player changed (state, name, colour,
calibration or transport). Always the complete player object.

### `pose`

Sent every time a phone sends orientation, typically 60 times a second.

```json
{ "type": "pose", "id": "p1", "seq": 1042, "t": 1790300000123.4,
  "q": [0.01, 0.12, 0.0, 0.99], "yaw": 13.9, "pitch": -1.2, "roll": 0.4,
  "dir": [0.24, -0.02, 0.97], "screen": [0.84, 0.53] }
```

| Field | Meaning |
|---|---|
| `seq` | The phone's sample counter. Increases by one per sample, so gaps show dropped samples. Restarts from 0 when the phone reconnects. |
| `t` | When the relay received the sample, in milliseconds since the Unix epoch. |
| `q` | Calibrated orientation in the rig frame, `[x, y, z, w]`. |
| `yaw`, `pitch`, `roll` | Calibrated angles in degrees. |
| `dir` | Calibrated unit pointing direction `[right, up, forward]`. |
| `screen` | Normalised screen position, or `null`. |
| `accel` | The phone's acceleration in m/s², gravity removed, as `[right, up, forward]` in the rig frame. Only when the phone sends it (it does unless motion access was refused). Unsmoothed. |

All values are smoothed with the app's filter settings (see `configure`).

### `button`

`{ "type": "button", "id": "p1", "button": "primary", "down": true }`

`button` is the id of a button in the player's layout: `primary` and `secondary` by default. A
d-pad or crawl pad's directions are buttons too, named `<its id>.<direction>` (`move.up`). Every
`down` is followed by an `up` (`"down": false`), including when a phone disconnects with a button
held, or a new layout removes a held button.

### `control`

`{ "type": "control", "id": "p1", "control": "power", "value": 0.8 }`

A toggle (`true` or `false`), slider (0 to 1), choice (option index) or label (text) changed,
either on the phone or because an app set it. Sent only when the value actually changes. The
player's `controls` hold the latest values.

### `error`

`{ "type": "error", "message": "layout: template grid holds at most 6 controls" }`

Sent only to the app whose message the relay couldn't use, saying why.

### `gesture`

```json
{ "type": "gesture", "id": "p1", "gesture": "pull", "strength": 0.62, "speed": 1.55,
  "dir": [0.05, -0.1, -0.99], "angle": 0, "duration": 240, "t": 1790300000123.4, "buttons": ["primary"] }
```

The player moved the phone deliberately. See [Gestures](gestures.md).

| Field | Meaning |
|---|---|
| `gesture` | Movements of the whole phone: `push` (towards the screen), `pull` (back towards the player), `left`, `right`, `up`, `down`, `shake`. Fast rotations: `flick-up`, `flick-down`, `flick-left`, `flick-right` (the pointing direction turned quickly), `twist-left`, `twist-right` (a quick roll of the wrist; right is clockwise from behind). |
| `strength` | 0 to 1: how vigorous, relative to a strong flick, shake or twist. |
| `speed` | Movements and shakes: peak speed in m/s (0 for flicks and twists). |
| `dir` | Movements: unit direction, `[right, up, forward]` (zeros otherwise). |
| `angle` | Flicks and twists: how far the phone turned, in degrees (0 for movements). |
| `duration` | How long it took, in ms. |
| `t` | Relay time it started. |
| `buttons` | Button ids that were held when it started, sorted. |

Each app gets gestures detected with its own sensitivity (see `configure`).

### `calibrating`

`{ "type": "calibrating", "id": "p1", "step": "top-left" }`

The player has started screen calibration and is being asked to point at a corner. `step` is
`top-left` or `bottom-right`, or `cancelled`. A failed attempt starts again at `top-left`. Apps may
draw corner markers to help. Until `calibrated` or `cancelled`, the player's poses have no `screen`.

### `calibrated`

`{ "type": "calibrated", "id": "p1", "calibration": "ray" }`

The player pressed Recentre (`ray`) or finished two-corner calibration (`screen`).

### `stats`

Sent once a second for each connected player.

`{ "type": "stats", "id": "p1", "rtt": 18.5, "rate": 60.1, "dropped": 0 }`

`rtt` is the round trip from relay to phone and back, in milliseconds. `rate` is poses per second.
`dropped` counts samples lost or arriving out of order in the last second.

## App to relay

All optional. Messages naming an `id` that does not exist are ignored.

### `configure`

Sets this app connection's options. Every field is optional.

```json
{ "type": "configure", "smoothing": { "minCutoff": 1.0, "beta": 5.0, "dCutoff": 1.0 },
  "gestures": { "threshold": 7, "minSpeed": 0.35, "flickRate": 250, "twistRate": 360 } }
```

`smoothing` sets the One Euro filter for poses sent to this app; `false` turns smoothing off. Lower
`minCutoff` means steadier when still; higher `beta` means quicker when moving.

`gestures` sets this app's gesture sensitivity, or `false` for no `gesture` messages: `threshold`
is the acceleration in m/s² that starts a movement (lower is more sensitive), `minSpeed` the peak
speed in m/s a movement must reach, `flickRate` the turning speed in degrees per second a flick must
reach, and `twistRate` the rolling speed a twist must reach.

### `style`

`{ "type": "style", "id": "p1", "colour": "#00c2ff", "label": "Blue team" }`

Changes the colour shown on the phone and in `player` messages. `label` shows under the player's
name on the phone. Either field may be omitted.

### `prompt`

`{ "type": "prompt", "id": "p1", "text": "Aim at the red door", "duration": 3000 }`

Shows text on the phone. Omit `id` to send to every player. `duration` is in milliseconds (default
3000); `0` keeps it until the next prompt; an empty `text` clears it.

### `haptic`

`{ "type": "haptic", "id": "p1", "pattern": [40] }`

Vibrates the phone where the browser allows it (Android, not iPhone). `pattern` alternates on and off
durations in milliseconds. Omit `id` to send to everyone.

### `calibrate`

`{ "type": "calibrate", "id": "p1", "mode": "screen" }`

Asks the player to run calibration. `mode` is `screen` (two corners) or `ray` (asks them to point at
the middle and press Recentre). Omit `id` to ask everyone.

### `layout`

`{ "type": "layout", "id": "p1", "layout": { "template": "grid", "controls": [ ... ] } }`

Sets the controls a phone shows. Omit `id` for every phone; `"layout": null` goes back to the
default. The relay remembers each player's layout, so a phone that reconnects gets it back, and
sends every app a `player` message with the new layout. Held buttons that aren't in the new layout
are released. An invalid layout gets an `error` and changes nothing.

### `set`

`{ "type": "set", "id": "p1", "control": "score", "value": "120" }`

Changes a control's value on a phone: a toggle's `true` or `false`, a slider's 0 to 1, a choice's
option index, or a label's text. Omit `id` for every phone. Every app gets a `control` message.

## Layouts

A layout is a template plus its controls, in order:

```json
{ "template": "primary-row",
  "controls": [
    { "id": "shoot", "type": "button", "label": "Shoot" },
    { "id": "reload", "type": "button", "label": "Reload" },
    { "id": "zoom", "type": "toggle", "label": "Zoom" },
    { "id": "ammo", "type": "label", "label": "Ammo", "text": "12" } ] }
```

| Template | Controls | Placement |
|---|---|---|
| `primary` | 1 | Preset: `rows: [1]`, a first button drawn as a pad. |
| `primary-secondary` | 1 or 2 | Preset: `rows: [1, 2]`, `heights: [3, 1]`, a first button drawn as a pad, then a space and the second control. The default. |
| `pair` | 1 or 2 | Preset: `rows: [2]`. |
| `primary-row` | 1 to 4 | Preset: `rows: [1, n - 1]`, `heights: [3, 1]`, a first button drawn as a pad. |
| `grid` | 1 to 6 | Preset: rows of two, with a space to even out the last. |
| `rows` | 1 to 8 | `rows`: how many controls in each row, top (the pointing end) to bottom, 1 to 4 rows of 1 to 4, adding up to the number of controls. Optional `heights`: relative heights, one positive number per row. |
| `columns` | 1 to 8 | The same with `columns` (left to right, mirrored for left hands) and `widths`. |

In the `primary` templates the first control is the big one and must be a button, `pad`, `dpad`
or `crawl`. Placement mirrors for players who choose left-handed on their phone. In `rows` and
`columns`, a size under a tenth of the biggest is raised to a tenth, so nothing shrinks away.

```json
{ "type": "layout", "layout": { "template": "rows", "rows": [1, 3], "heights": [3, 2],
  "controls": [ { "id": "walk", "type": "crawl" }, { "id": "attack", "type": "button" },
    { "id": "use", "type": "button" }, { "id": "map", "type": "toggle" } ] } }
```

Every control but a `space` has an `id` (1 to 32 letters, digits, `_`, `.` or `-`, unique in the layout), a
`type`, and optionally a `label` (up to 24 characters) and a `colour` (`#rrggbb`; the player's
colour when omitted).

| Type | Extra fields | Value |
|---|---|---|
| `button` | | none: presses arrive as `button` messages |
| `pad` | | none: a big round button; presses arrive as `button` messages |
| `toggle` | `value`: starting state | `true` or `false` |
| `slider` | `value`: starting position, `orientation`: `horizontal` (default) or `vertical`, `spring`: where it returns when let go (0 to 1), or `null` to stay put | 0 to 1 |
| `choice` | `options`: 2 to 4 strings (up to 16 characters each), `value`: starting index | option index |
| `label` | `text`: up to 80 characters | the text; only apps change it |
| `space` | no `id` needed, no `label` or `colour` | none: an empty cell |
| `dpad` | | none: each direction is a button, `<id>.up`, `<id>.down`, `<id>.left` and `<id>.right` |
| `crawl` | | none: each direction is a button, `<id>.forward`, `<id>.back`, `<id>.step-left`, `<id>.step-right`, `<id>.turn-left` and `<id>.turn-right` |

A control's id must not equal another control's direction button (a button `move.up` beside a d-pad
`move`).

## Phone link

The phone page and the relay talk over `wss://<relay>:8443/phone`, or over the HTTP fallback when a
WebSocket cannot connect (Safari can refuse secure WebSockets to a self-signed server even after
the page has been accepted). The fallback is `POST /phone/send?sid=...` carrying a JSON array of
messages, plus a Server-Sent Events stream at `GET /phone/events?sid=...` for messages to the
phone. Apps never see this link; it is described so the relay and phone page can be reimplemented.

Phone to relay:

| Message | Fields |
|---|---|
| `hello` | `key` (join key from the QR code), `token` (reconnect token, if any), `name`, `platform`, `sensor` |
| `ready` | Motion access granted; poses follow. |
| `pose` | `seq`, `ts` (phone clock, ms), `q` (`[x, y, z, w]`, device to sensor world, W3C `DeviceOrientation` frame), and `a` (optional: acceleration in m/s² without gravity, in the phone's own axes `[x, y, z]`, from `devicemotion`) |
| `button` | `button` (a button id from the layout), `down` |
| `control` | `control`, `value` |
| `recentre` | |
| `corner` | `step` (`top-left` or `bottom-right`), `q` |
| `calibrate-start`, `calibrate-cancel` | |
| `pause`, `resume` | The page was hidden or shown. |
| `name` | `name` |
| `pong` | `n`, `ts` |

Relay to phone:

| Message | Fields |
|---|---|
| `welcome` | `id`, `token`, `slot`, `name`, `colour`, `label`, `calibration` |
| `rejected` | `reason` (`full` or `bad-key`) |
| `style` | `colour`, `label` |
| `prompt` | `text`, `duration` |
| `haptic` | `pattern` |
| `calibrate` | `mode` |
| `calibration` | `calibration`, `step`, `ok` |
| `ping` | `n` |
| `layout` | `layout`, `values` (sent after `welcome`, and whenever an app changes it) |
| `set` | `control`, `value` |

## Conformance

`conformance/` holds recorded sessions and the output every implementation must produce from them.
See [conformance/README.md](../conformance/README.md).
