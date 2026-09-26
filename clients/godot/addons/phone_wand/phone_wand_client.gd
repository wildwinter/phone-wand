class_name PhoneWandClient
extends Node
## Connects to a Phone Wand relay and tracks every player's pose and buttons.
##
## Enable the Phone Wand plugin and this node is available everywhere as the PhoneWand autoload:
##
##   func _ready() -> void:
##       PhoneWand.pose.connect(_on_pose)
##       PhoneWand.button.connect(_on_button)
##
##   func _on_pose(player: PhoneWandPlayer) -> void:
##       if player.has_screen:
##           $Cursor.position = player.screen_position(get_viewport_rect().size)
##
##   func _on_button(player: PhoneWandPlayer, button: String, down: bool) -> void:
##       if button == "primary" and down:
##           fire(player)
##
## You can also add a PhoneWandClient node to a scene yourself. It uses WebSocketPeer, polled in
## _process, so it works in desktop, mobile and web exports alike. See docs/clients/godot.md.

## Emitted when the relay's hello arrives. hello holds protocol, relay, joinUrl, qrUrl and
## maxPlayers. player_joined follows for every player already connected.
signal connected(hello: Dictionary)
## Emitted when the connection to the relay is lost, after player_left for every player.
signal disconnected()
## A player took a slot (or was already there when the client connected).
signal player_joined(player: PhoneWandPlayer)
## A player's slot is free again. The player object is no longer in players.
signal player_left(player: PhoneWandPlayer)
## Something about the player changed: state, name, colour, label, calibration or transport.
signal player_changed(player: PhoneWandPlayer)
## A new pose arrived, typically 60 times a second per player.
signal pose(player: PhoneWandPlayer)
## A button went down or up. button is "primary" or "secondary". Every down is followed by an up.
signal button(player: PhoneWandPlayer, button: String, down: bool)
## The player is being asked to point at a corner: step is "top-left", "bottom-right" or
## "cancelled".
signal calibrating(player: PhoneWandPlayer, step: String)
## The player pressed Recentre ("ray") or finished two-corner calibration ("screen").
signal calibrated(player: PhoneWandPlayer, calibration: String)
## Connection statistics for the player arrived (once a second). See player.rtt, rate, dropped.
signal stats(player: PhoneWandPlayer)

const VERSION := "0.1.0"
const PROTOCOL_VERSION := 0
const DEFAULT_URL := "ws://127.0.0.1:8480/app"

const _RETRY_START_MS := 500
const _RETRY_MAX_MS := 5000
const _HANDSHAKE_TIMEOUT_MS := 5000

## The relay's app endpoint. Changing it while connected reconnects to the new address.
@export var url: String = DEFAULT_URL:
	set(value):
		if value == url:
			return
		url = value
		if _wanted:
			_drop_socket()
			_retry_ms = _RETRY_START_MS
			_open_socket()
## Connect as soon as the node is ready.
@export var auto_connect: bool = true
## Reconnect automatically, with backoff from 0.5 to 5 seconds, when the relay goes away.
@export var reconnect: bool = true

## Players by id.
var players: Dictionary = {}
## The relay's hello (without "players"), or empty when not connected.
var hello: Dictionary = {}

var _ws: WebSocketPeer = null
var _open := false
var _wanted := false
var _retry_ms := _RETRY_START_MS
var _next_attempt_ms := 0
var _attempt_started_ms := 0
# null: the relay's default. false: raw. Dictionary: One Euro settings.
var _smoothing: Variant = null
var _smoothing_set := false


func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _ready() -> void:
	if url == DEFAULT_URL:
		var override := url_override()
		if override != "":
			url = override
	if auto_connect:
		connect_to_relay()


## A relay URL given at launch, or "". Desktop builds read the command-line user argument
## --phone-wand-url=<url> (after --); web builds read the page's ?relay=<url> query parameter.
## Clients whose url is left at DEFAULT_URL use it automatically.
static func url_override() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--phone-wand-url="):
			return arg.trim_prefix("--phone-wand-url=")
	if OS.has_feature("web"):
		var value: Variant = JavaScriptBridge.eval("new URLSearchParams(window.location.search).get('relay') || ''", true)
		if value is String:
			return value
	return ""


func _process(_delta: float) -> void:
	poll()


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE and _ws != null:
		_ws.close()


# ---------------------------------------------------------------- connection

## Starts connecting (and keeps reconnecting if reconnect is on). Pass a url to change it first.
func connect_to_relay(relay_url: String = "") -> void:
	if relay_url != "":
		url = relay_url
	_wanted = true
	if _ws == null:
		_next_attempt_ms = 0
		_open_socket()


## Closes the connection and stops reconnecting. Fires player_left and disconnected as usual.
func disconnect_from_relay() -> void:
	_wanted = false
	_next_attempt_ms = 0
	if _ws != null:
		_drop_socket()


## True once the relay's hello has arrived.
func is_relay_connected() -> bool:
	return not hello.is_empty()


## Players sorted by slot.
func players_by_slot() -> Array[PhoneWandPlayer]:
	var list: Array[PhoneWandPlayer] = []
	for p in players.values():
		list.append(p)
	list.sort_custom(func(a: PhoneWandPlayer, b: PhoneWandPlayer) -> bool: return a.slot < b.slot)
	return list


## The player with this id, or null.
func get_player(id: String) -> PhoneWandPlayer:
	return players.get(id)


## The player in this slot, or null.
func get_player_in_slot(slot: int) -> PhoneWandPlayer:
	for p in players.values():
		if p.slot == slot:
			return p
	return null


## The join URL phones open (from hello), or "" when not connected.
func get_join_url() -> String:
	return str(hello.get("joinUrl", ""))


## The URL of a QR code PNG for the join URL (from hello), or "" when not connected.
## Pass a size in pixels to ask for a particular size.
func get_qr_url(size: int = 0) -> String:
	var qr := str(hello.get("qrUrl", ""))
	if qr != "" and size > 0:
		qr += ("&" if qr.contains("?") else "?") + "size=%d" % size
	return qr


## Services the WebSocket. Called from _process; call it yourself only if you remove the node's
## processing.
func poll() -> void:
	var now := Time.get_ticks_msec()
	if _ws == null:
		if _wanted and reconnect and _next_attempt_ms > 0 and now >= _next_attempt_ms:
			_open_socket()
		return
	_ws.poll()
	var ready_state := _ws.get_ready_state()
	if ready_state == WebSocketPeer.STATE_OPEN:
		if not _open:
			_open = true
			_retry_ms = _RETRY_START_MS
			if _smoothing_set:
				_send({"type": "configure", "smoothing": _smoothing})
		while _ws != null and _ws.get_available_packet_count() > 0:
			var packet := _ws.get_packet()
			if _ws.was_string_packet():
				handle_message(packet.get_string_from_utf8())
	elif ready_state == WebSocketPeer.STATE_CONNECTING:
		if now - _attempt_started_ms > _HANDSHAKE_TIMEOUT_MS:
			_ws.close()
			_on_closed()
	elif ready_state == WebSocketPeer.STATE_CLOSED:
		_on_closed()


func _open_socket() -> void:
	_next_attempt_ms = 0
	_ws = WebSocketPeer.new()
	_ws.inbound_buffer_size = 1 << 18
	_ws.max_queued_packets = 8192
	_open = false
	_attempt_started_ms = Time.get_ticks_msec()
	var err := _ws.connect_to_url(url)
	if err != OK:
		_ws = null
		_schedule_reconnect()


func _drop_socket() -> void:
	if _ws != null:
		_ws.close()
	_on_closed()


func _on_closed() -> void:
	_ws = null
	_open = false
	var was := not hello.is_empty()
	hello = {}
	var gone := players.values()
	players.clear()
	for p in gone:
		player_left.emit(p)
	if was:
		disconnected.emit()
	_schedule_reconnect()


func _schedule_reconnect() -> void:
	if not _wanted or not reconnect:
		return
	_next_attempt_ms = Time.get_ticks_msec() + _retry_ms
	_retry_ms = mini(_retry_ms * 2, _RETRY_MAX_MS)


func _send(msg: Dictionary) -> void:
	if _ws != null and _open and _ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_ws.send_text(JSON.stringify(msg))


# ---------------------------------------------------------------- app to relay

## Sets the One Euro filter the relay applies to this app's poses. Lower min_cutoff is steadier
## when still; higher beta is quicker when moving. Remembered and re-sent after reconnecting.
func configure_smoothing(min_cutoff: float = 1.0, beta: float = 5.0, d_cutoff: float = 1.0) -> void:
	_smoothing = {"minCutoff": min_cutoff, "beta": beta, "dCutoff": d_cutoff}
	_smoothing_set = true
	_send({"type": "configure", "smoothing": _smoothing})


## Turns smoothing off: poses arrive exactly as the phone sent them. Remembered across reconnects.
func set_raw() -> void:
	_smoothing = false
	_smoothing_set = true
	_send({"type": "configure", "smoothing": false})


## Changes a player's colour (a Color or "#rrggbb") and/or label. Pass null to leave one alone.
func style(id: String, colour: Variant = null, label: Variant = null) -> void:
	var msg := {"type": "style", "id": id}
	if colour is Color:
		msg["colour"] = "#" + (colour as Color).to_html(false).to_lower()
	elif colour != null:
		msg["colour"] = str(colour)
	if label != null:
		msg["label"] = str(label)
	_send(msg)


## Shows text on a phone, or on every phone when id is "". duration is in milliseconds;
## 0 keeps the text until the next prompt, and empty text clears it.
func prompt(text: String, id: String = "", duration: int = 3000) -> void:
	var msg := {"type": "prompt", "text": text, "duration": duration}
	if id != "":
		msg["id"] = id
	_send(msg)


## Vibrates a phone, or every phone when id is "" (Android only; iPhones ignore it).
## pattern is milliseconds, alternating on and off: an int, an Array or a PackedInt32Array.
func haptic(pattern: Variant, id: String = "") -> void:
	var list: Array = []
	if pattern is Array or pattern is PackedInt32Array or pattern is PackedFloat32Array:
		for v in pattern:
			list.append(int(v))
	else:
		list.append(int(pattern))
	var msg := {"type": "haptic", "pattern": list}
	if id != "":
		msg["id"] = id
	_send(msg)


## Asks a player (or everyone when id is "") to calibrate: mode "screen" (two corners) or
## "ray" (point at the middle and press Recentre).
func calibrate(mode: String = "screen", id: String = "") -> void:
	var msg := {"type": "calibrate", "mode": mode}
	if id != "":
		msg["id"] = id
	_send(msg)


# ---------------------------------------------------------------- relay to app

## Handles one relay message as JSON text. Public so recorded sessions can be replayed through it.
func handle_message(json_text: String) -> void:
	var parsed: Variant = JSON.parse_string(json_text)
	if parsed is Dictionary:
		handle(parsed)


## Handles one decoded relay message.
func handle(msg: Dictionary) -> void:
	match str(msg.get("type", "")):
		"hello":
			var h := msg.duplicate(true)
			h.erase("type")
			h.erase("players")
			for key in ["protocol", "maxPlayers"]:
				if h.has(key):
					h[key] = int(h[key])
			hello = h
			connected.emit(hello)
			var list: Variant = msg.get("players")
			if list is Array:
				for info in list:
					if info is Dictionary:
						player_joined.emit(_upsert(info))
		"join":
			var info: Variant = msg.get("player")
			if info is Dictionary:
				player_joined.emit(_upsert(info))
		"player":
			var info: Variant = msg.get("player")
			if info is Dictionary:
				var p := _upsert(info)
				if p.state != "active":
					p.buttons.clear()
				player_changed.emit(p)
		"leave":
			var p := _known(msg)
			if p == null:
				return
			players.erase(p.id)
			player_left.emit(p)
		"pose":
			var p := _known(msg)
			if p == null:
				return
			p.apply_pose(msg)
			pose.emit(p)
		"button":
			var p := _known(msg)
			if p == null:
				return
			var b := str(msg.get("button", ""))
			var down := bool(msg.get("down", false))
			if down:
				if not p.buttons.has(b):
					p.buttons.append(b)
			else:
				p.buttons.erase(b)
			button.emit(p, b, down)
		"calibrating":
			var p := _known(msg)
			if p == null:
				return
			var step := str(msg.get("step", ""))
			p.calibrating = "" if step == "cancelled" else step
			calibrating.emit(p, step)
		"calibrated":
			var p := _known(msg)
			if p == null:
				return
			p.calibration = str(msg.get("calibration", p.calibration))
			p.calibrating = ""
			calibrated.emit(p, p.calibration)
		"stats":
			var p := _known(msg)
			if p == null:
				return
			p.apply_stats(msg)
			stats.emit(p)


func _known(msg: Dictionary) -> PhoneWandPlayer:
	return players.get(str(msg.get("id", "")))


func _upsert(info: Dictionary) -> PhoneWandPlayer:
	var id := str(info.get("id", ""))
	var p: PhoneWandPlayer = players.get(id)
	if p == null:
		p = PhoneWandPlayer.new()
		players[id] = p
	p.apply_info(info)
	return p
