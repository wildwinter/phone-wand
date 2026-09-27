class_name PhoneWandPlayer
extends RefCounted
## Everything a PhoneWandClient knows about one player.
##
## Player objects are owned by the client and updated in place, so a reference you keep stays
## current until the player leaves. Read the fields; do not change them.

# ---------------------------------------------------------------- identity and state

## Unique for the lifetime of the relay. Survives the phone reconnecting.
var id: String = ""
## 0-based player number, lowest free first.
var slot: int = 0
## The name chosen on the phone.
var name: String = ""
## The player's colour.
var colour: Color = Color.WHITE
## The player's colour as the relay sent it, "#rrggbb" in lower case.
var colour_hex: String = "#ffffff"
## Extra text set by an app with PhoneWandClient.style().
var label: String = ""
## "active" (sending poses), "paused" or "waiting" (motion access not yet allowed).
var state: String = "waiting"
## "none", "ray" (Recentre pressed) or "screen" (two-corner calibrated).
var calibration: String = "none"
## "iOS", "Android" or "other".
var platform: String = ""
## "relative-orientation-sensor" or "deviceorientation".
var sensor: String = ""
## "ws" (WebSocket) or "http" (the HTTP fallback).
var transport: String = ""
## The corner the player is being asked to point at during screen calibration
## ("top-left" or "bottom-right"), or "" when not calibrating.
var calibrating: String = ""
## Buttons currently held: "primary" and "secondary" by default, or the button ids of the layout.
var buttons: Array[String] = []

# ---------------------------------------------------------------- layout

## The controls the phone shows, as the relay sent it: {"template": ..., "controls": [...]}.
## The default (primary-secondary with buttons primary and secondary) until an app sends one.
var layout: Dictionary = PhoneWandLayout.default_layout()
## The layout's template, such as "primary-secondary", "grid" or "rows".
var template: String = "primary-secondary"
## Current values of the layout's toggles (bool), sliders (float, 0 to 1), choices (int, the
## option index) and labels (String), by control id. Buttons, pads and spaces have no value.
var controls: Dictionary = {}

# ---------------------------------------------------------------- stats

## True once a stats message has arrived.
var has_stats: bool = false
## Round trip from relay to phone and back, in milliseconds.
var rtt: float = 0.0
## Poses per second.
var rate: float = 0.0
## Samples lost or out of order in the last second.
var dropped: int = 0
## The last stats message as received (without "type"), or empty.
var stats: Dictionary = {}

# ---------------------------------------------------------------- pose

## True once a pose has arrived.
var has_pose: bool = false
## The phone's sample counter. Restarts from 0 when the phone reconnects.
var seq: int = 0
## When the relay received the sample, in milliseconds since the Unix epoch.
var t: float = 0.0
## Degrees, positive to the right.
var yaw: float = 0.0
## Degrees, positive upwards.
var pitch: float = 0.0
## Degrees, positive when the phone turns clockwise as seen from behind.
var roll: float = 0.0
## Unit pointing direction in Godot's frame (x right, y up, -z forward).
var dir: Vector3 = Vector3.FORWARD
## Orientation of the phone in Godot's frame. Rotates Vector3.FORWARD to dir, and Vector3.UP
## to the phone's screen normal.
var rotation: Quaternion = Quaternion.IDENTITY
## True when the relay sent a screen position. False when the phone points too far away.
var has_screen: bool = false
## Normalised screen position: (0, 0) top-left, (1, 1) bottom-right. Values outside 0..1 mean
## the player points off the screen. Only meaningful when has_screen is true.
var screen: Vector2 = Vector2.ZERO
## The pose's quaternion as sent, in the rig frame [x, y, z, w].
var rig_q: Array = [0.0, 0.0, 0.0, 1.0]
## The pose's direction as sent, in the rig frame [right, up, forward].
var rig_dir: Array = [0.0, 0.0, 1.0]
## True when the last pose carried the phone's acceleration (phones send it unless motion access
## was refused).
var has_accel: bool = false
## The phone's acceleration in m/s², gravity removed, in Godot's frame (x right, y up, -z forward).
## Unsmoothed. Vector3.ZERO when has_accel is false. See docs/gestures.md ("Raw motion").
var accel: Vector3 = Vector3.ZERO
## The last pose message as received (without "type"), or empty.
var pose: Dictionary = {}


## True while the named button is held.
func is_pressed(button: String = "primary") -> bool:
	return buttons.has(button)


## The current value of a toggle, slider, choice or label, or default if the layout has none.
func get_control(control_id: String, default: Variant = null) -> Variant:
	return controls.get(control_id, default)


## The definition of a control in the layout (with "id", "type" and so on), or an empty Dictionary.
func find_control(control_id: String) -> Dictionary:
	var list: Variant = layout.get("controls")
	if list is Array:
		for c in list:
			# Spaces may have no id: never match those.
			if c is Dictionary and c.has("id") and str(c["id"]) == control_id:
				return c
	return {}


## True if the player has a screen position inside the screen.
func is_on_screen() -> bool:
	return has_screen and screen.x >= 0.0 and screen.x <= 1.0 and screen.y >= 0.0 and screen.y <= 1.0


## The screen position in pixels for a viewport of the given size, such as
## get_viewport_rect().size. Returns Vector2.ZERO when has_screen is false, so check that first.
func screen_position(viewport_size: Vector2) -> Vector2:
	if not has_screen:
		return Vector2.ZERO
	return screen * viewport_size


## The player's colour as a "#rrggbb" string.
func get_colour_hex() -> String:
	return colour_hex


func _to_string() -> String:
	return "PhoneWandPlayer(%s slot=%d name=%s)" % [id, slot, name]


# ---------------------------------------------------------------- updated by the client

## Applies a player object from the relay. Called by PhoneWandClient.
func apply_info(info: Dictionary) -> void:
	id = str(info.get("id", id))
	slot = int(info.get("slot", slot))
	name = str(info.get("name", name))
	var hex := str(info.get("colour", colour_hex))
	colour_hex = hex
	if Color.html_is_valid(hex):
		colour = Color.html(hex)
	label = str(info.get("label", label))
	state = str(info.get("state", state))
	calibration = str(info.get("calibration", calibration))
	var device: Variant = info.get("device")
	if device is Dictionary:
		platform = str(device.get("platform", platform))
		sensor = str(device.get("sensor", sensor))
		transport = str(device.get("transport", transport))
	var new_layout: Variant = info.get("layout")
	if new_layout is Dictionary:
		layout = new_layout.duplicate(true)
		template = str(layout.get("template", ""))
	var values: Variant = info.get("controls")
	if values is Dictionary:
		controls = {}
		for key in values:
			controls[str(key)] = normalise_value(str(key), values[key])


## Applies a control value from the relay. Called by PhoneWandClient; returns the stored value.
func apply_control(control_id: String, value: Variant) -> Variant:
	var v: Variant = normalise_value(control_id, value)
	controls[control_id] = v
	return v


## A control value with the type its control takes: JSON numbers arrive as floats, so a choice's
## index becomes an int and a slider's position a float. Buttons, pads, dpads, crawls and spaces
## have no value.
func normalise_value(control_id: String, value: Variant) -> Variant:
	var number := typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT
	match str(find_control(control_id).get("type", "")):
		"choice":
			return int(value) if number else value
		"slider":
			return float(value) if number else value
		"label":
			return value if value is String else str(value)
	return value


## Applies a pose message from the relay. Called by PhoneWandClient.
func apply_pose(msg: Dictionary) -> void:
	pose = msg.duplicate(true)
	pose.erase("type")
	has_pose = true
	seq = int(msg.get("seq", 0))
	t = float(msg.get("t", 0.0))
	yaw = float(msg.get("yaw", 0.0))
	pitch = float(msg.get("pitch", 0.0))
	roll = float(msg.get("roll", 0.0))
	var q: Variant = msg.get("q")
	rig_q = q.duplicate() if q is Array else [0.0, 0.0, 0.0, 1.0]
	var d: Variant = msg.get("dir")
	rig_dir = d.duplicate() if d is Array else [0.0, 0.0, 1.0]
	rotation = PhoneWandFrames.quat_to_godot(rig_q)
	dir = PhoneWandFrames.dir_to_godot(rig_dir)
	var a: Variant = msg.get("accel")
	has_accel = a is Array and a.size() >= 3
	accel = PhoneWandFrames.dir_to_godot(a) if has_accel else Vector3.ZERO
	var s: Variant = msg.get("screen")
	if s is Array and s.size() >= 2:
		has_screen = true
		screen = Vector2(float(s[0]), float(s[1]))
	else:
		has_screen = false
		screen = Vector2.ZERO


## Applies a stats message from the relay. Called by PhoneWandClient.
func apply_stats(msg: Dictionary) -> void:
	stats = msg.duplicate(true)
	stats.erase("type")
	has_stats = true
	rtt = float(msg.get("rtt", 0.0))
	rate = float(msg.get("rate", 0.0))
	dropped = int(msg.get("dropped", 0))
