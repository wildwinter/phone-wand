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
## Something about the player changed: state, name, colour, label, calibration, transport or
## layout (a new layout replaces player.layout, player.template and player.controls).
signal player_changed(player: PhoneWandPlayer)
## A new pose arrived, typically 60 times a second per player.
signal pose(player: PhoneWandPlayer)
## A button went down or up. button is the button's id in the player's layout: "primary" or
## "secondary" by default. Every down is followed by an up.
signal button(player: PhoneWandPlayer, button: String, down: bool)
## A toggle (bool), slider (float, 0 to 1), choice (int, the option index) or label (String)
## changed, on the phone or because an app set it. player.controls already holds the new value.
signal control_changed(player: PhoneWandPlayer, control: String, value: Variant)
## The relay could not use something this app sent (a bad layout, say); message says why. With
## nothing connected to this signal, the client prints the message as a warning instead.
signal relay_error(message: String)
## The player is being asked to point at a corner: step is "top-left", "bottom-right" or
## "cancelled".
signal calibrating(player: PhoneWandPlayer, step: String)
## The player pressed Recentre ("ray") or finished two-corner calibration ("screen").
signal calibrated(player: PhoneWandPlayer, calibration: String)
## Connection statistics for the player arrived (once a second). See player.rtt, rate, dropped.
signal stats(player: PhoneWandPlayer)
## The player moved the phone deliberately (see docs/gestures.md). gesture holds:
## "gesture" (String: movements push, pull, left, right, up, down, shake; fast rotations flick-up,
## flick-down, flick-left, flick-right, twist-left, twist-right), "strength" (float, 0 to 1),
## "speed" (float, movements' peak m/s, else 0), "dir" (Vector3, movements' unit direction in
## Godot's frame, else zero), "angle" (float, flicks' and twists' degrees turned, else 0), "duration" (float, ms),
## "t" (float, relay time it started) and "buttons" (PackedStringArray, button ids held when it
## started, sorted). "Hold primary and pull" is gesture == "pull" and buttons.has("primary").
signal gesture(player: PhoneWandPlayer, gesture: Dictionary)

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
		if _wanted and _relay_http == null:
			_drop_socket()
			_retry_ms = _RETRY_START_MS
			_open_socket()
## Connect as soon as the node is ready.
@export var auto_connect: bool = true
## Reconnect automatically, with backoff from 0.5 to 5 seconds, when the relay goes away.
@export var reconnect: bool = true

@export_group("Managed relay")
## Start the Phone Wand relay program from this game, hidden, unless one is already running, and
## stop it when this client goes. Only for a url on this computer, in desktop builds. Set it before
## the client connects (the PhoneWand autoload also reads the phone_wand/start_relay project
## setting). See docs/shipping.md.
@export var start_relay: bool = false:
	set(value):
		start_relay = value
		# Turned on after connect_to_relay (for example in the main scene's _ready, after the
		# autoload's): check for a relay now, if the client hasn't connected yet.
		if value and _wanted and not _relay_checked and hello.is_empty():
			_begin_relay_check()
## The phone-wand-relay folder (holding macos, windows-x64, ...) or the relay executable itself.
## Empty: res://phone-wand-relay in the editor, or phone-wand-relay beside the exported executable.
@export var relay_path: String = ""
## Extra relay options, for example ["--max-players", "8"].
@export var relay_arguments: PackedStringArray = PackedStringArray()

@export_group("Gestures")
## Send gesture signals. Off: the relay sends this app no gestures. See docs/gestures.md.
@export var gestures_enabled: bool = true:
	set(value):
		gestures_enabled = value
		_send_gestures()
## Acceleration in m/s² that starts a movement. Lower is more sensitive.
@export_range(1.0, 30.0, 0.1, "or_greater") var gesture_threshold: float = 7.0:
	set(value):
		gesture_threshold = value
		_send_gestures()
## Peak speed in m/s a movement must reach.
@export_range(0.0, 3.0, 0.01, "or_greater") var gesture_min_speed: float = 0.35:
	set(value):
		gesture_min_speed = value
		_send_gestures()
## Turning speed in degrees per second that makes a flick.
@export_range(30.0, 1440.0, 1.0, "or_greater") var gesture_flick_rate: float = 250.0:
	set(value):
		gesture_flick_rate = value
		_send_gestures()
## Rolling speed in degrees per second that makes a twist.
@export_range(30.0, 1440.0, 1.0, "or_greater") var gesture_twist_rate: float = 360.0:
	set(value):
		gesture_twist_rate = value
		_send_gestures()

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
# True while configure_gestures sets several settings, so they go in one message.
var _gestures_batch := false

# Managed relay (start_relay). _relay_checked: the check has run (or been skipped) for this client.
var _relay_checked := false
var _relay_http: HTTPClient = null
var _relay_check_deadline_ms := 0
var _relay_check_body := PackedByteArray()
var _relay_port := 0
var _relay_pid := -1
# The relay's standard input: the lifeline. Kept referenced while the relay runs; closing it stops
# the relay (--lifeline), and it closes by itself if this process ends in any way.
var _relay_stdio: FileAccess = null
var _relay_stderr: FileAccess = null
static var _relay_platform_noted := false


func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _ready() -> void:
	if url == DEFAULT_URL:
		var override := url_override()
		if override != "":
			url = override
	if _is_autoload():
		if not start_relay and bool(ProjectSettings.get_setting("phone_wand/start_relay", false)):
			start_relay = true
		if relay_path == "":
			relay_path = str(ProjectSettings.get_setting("phone_wand/relay_path", ""))
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
	if what == NOTIFICATION_PREDELETE:
		if _ws != null:
			_ws.close()
		# Freed, including when the game quits: stop the relay if this client started it.
		stop_relay()


# ---------------------------------------------------------------- connection

## Starts connecting (and keeps reconnecting if reconnect is on). Pass a url to change it first.
func connect_to_relay(relay_url: String = "") -> void:
	if relay_url != "":
		url = relay_url
	_wanted = true
	if start_relay and not _relay_checked:
		_begin_relay_check()
		return
	if _ws == null and _relay_http == null:
		_next_attempt_ms = 0
		_open_socket()


## Closes the connection and stops reconnecting. Fires player_left and disconnected as usual.
## A relay this client started keeps running until the client is freed (or stop_relay()).
func disconnect_from_relay() -> void:
	_wanted = false
	_next_attempt_ms = 0
	if _relay_http != null:
		# Still asking whether a relay is running: give up, and check again on the next connect.
		_relay_http.close()
		_relay_http = null
		_relay_checked = false
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
	if _relay_http != null:
		_poll_relay_check(now)
		return
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
			var configure := {"type": "configure", "gestures": _gesture_settings()}
			if _smoothing_set:
				configure["smoothing"] = _smoothing
			_send(configure)
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


# ---------------------------------------------------------------- managed relay

## True while a relay that this client started is running.
func is_relay_started() -> bool:
	return _relay_pid >= 0 and OS.is_process_running(_relay_pid)


## The process id of the relay this client started, or -1.
func get_relay_pid() -> int:
	return _relay_pid


## Stops the relay if this client started it: closes its standard input (so it stops cleanly),
## waits up to two seconds, then ends the process. Called when the client is freed. Never stops a
## relay the client didn't start.
func stop_relay() -> void:
	if _relay_pid < 0:
		return
	var pid := _relay_pid
	_relay_pid = -1
	if _relay_stdio != null:
		_relay_stdio.close()
		_relay_stdio = null
	if _relay_stderr != null:
		_relay_stderr.close()
		_relay_stderr = null
	var deadline := Time.get_ticks_msec() + 2000
	while OS.is_process_running(pid) and Time.get_ticks_msec() < deadline:
		OS.delay_msec(20)
	if OS.is_process_running(pid):
		OS.kill(pid)


## The relay executable start_relay would run: relay_path if it names a file, otherwise
## <folder>/<platform>/phone-wand-relay (.exe on Windows). "" if this platform has no relay build.
func relay_executable() -> String:
	var path := relay_path
	if path == "":
		if OS.has_feature("editor"):
			path = ProjectSettings.globalize_path("res://phone-wand-relay")
		else:
			path = OS.get_executable_path().get_base_dir().path_join("phone-wand-relay")
	elif path.begins_with("res://") or path.begins_with("user://"):
		path = ProjectSettings.globalize_path(path)
	if FileAccess.file_exists(path):
		return path
	var platform := relay_platform()
	if platform == "":
		return ""
	var exe := "phone-wand-relay.exe" if OS.get_name() == "Windows" else "phone-wand-relay"
	return path.path_join(platform).path_join(exe)


## The folder name for this computer inside phone-wand-relay/ (macos, windows-x64, linux-x64 or
## linux-arm64), or "" if the relay isn't built for it.
static func relay_platform() -> String:
	var arch := Engine.get_architecture_name()
	match OS.get_name():
		"macOS":
			return "macos"
		"Windows":
			return "windows-x64" if arch == "x86_64" else ""
		"Linux":
			if arch == "x86_64":
				return "linux-x64"
			if arch == "arm64":
				return "linux-arm64"
	return ""


# The app port if url is a relay on this computer (127.0.0.1, localhost or [::1]), otherwise -1.
static func _local_app_port(relay_url: String) -> int:
	var rest := relay_url
	var scheme_end := rest.find("://")
	if scheme_end >= 0:
		rest = rest.substr(scheme_end + 3)
	rest = rest.get_slice("/", 0).get_slice("?", 0).get_slice("#", 0)
	if rest.contains("@"):
		rest = rest.substr(rest.rfind("@") + 1)
	var host := rest
	var port_text := ""
	if rest.begins_with("["):
		var close := rest.find("]")
		if close < 0:
			return -1
		host = rest.substr(0, close + 1)
		if rest.substr(close + 1).begins_with(":"):
			port_text = rest.substr(close + 2)
	elif rest.contains(":"):
		host = rest.get_slice(":", 0)
		port_text = rest.get_slice(":", 1)
	if not ["127.0.0.1", "localhost", "[::1]"].has(host.to_lower()):
		return -1
	if port_text.is_valid_int() and int(port_text) > 0:
		return int(port_text)
	return 8480


func _is_autoload() -> bool:
	if not is_inside_tree():
		return false
	return get_parent() == get_tree().root and ProjectSettings.has_setting("autoload/" + String(name))


# Starts asking http://127.0.0.1:<port>/status.json whether a relay is running; poll() carries on
# from there, starts one if nobody answers, then opens the socket.
func _begin_relay_check() -> void:
	_relay_checked = true
	if OS.has_feature("web") or OS.has_feature("mobile"):
		if not _relay_platform_noted:
			_relay_platform_noted = true
			print("phone-wand: start_relay is ignored on this platform; start the relay separately.")
		_connect_after_relay_check()
		return
	_relay_port = _local_app_port(url)
	if _relay_port < 0:
		_connect_after_relay_check()
		return
	if _ws != null:
		# Not connected yet (no hello), so nothing to announce: wait for the check instead.
		_ws.close()
		_ws = null
		_open = false
	_relay_http = HTTPClient.new()
	_relay_check_body = PackedByteArray()
	_relay_check_deadline_ms = Time.get_ticks_msec() + 1000
	if _relay_http.connect_to_host("127.0.0.1", _relay_port) != OK:
		_finish_relay_check(false)


func _poll_relay_check(now: int) -> void:
	var http := _relay_http
	http.poll()
	match http.get_status():
		HTTPClient.STATUS_CONNECTED:
			if http.has_response():
				_finish_relay_check(_is_relay_status(_relay_check_body))
				return
			if http.request(HTTPClient.METHOD_GET, "/status.json", ["Accept: application/json"]) != OK:
				_finish_relay_check(false)
				return
		HTTPClient.STATUS_BODY:
			var chunk := http.read_response_body_chunk()
			_relay_check_body.append_array(chunk)
			if http.get_status() != HTTPClient.STATUS_BODY:
				_finish_relay_check(_is_relay_status(_relay_check_body))
				return
		HTTPClient.STATUS_RESOLVING, HTTPClient.STATUS_CONNECTING, HTTPClient.STATUS_REQUESTING:
			pass
		_:
			# Can't connect, connection error or disconnected: nothing is listening.
			_finish_relay_check(_is_relay_status(_relay_check_body))
			return
	if now > _relay_check_deadline_ms:
		_finish_relay_check(false)


static func _is_relay_status(body: PackedByteArray) -> bool:
	if body.is_empty():
		return false
	var status: Variant = JSON.parse_string(body.get_string_from_utf8())
	return status is Dictionary and status.get("relay") is String


func _finish_relay_check(relay_answered: bool) -> void:
	if _relay_http != null:
		_relay_http.close()
		_relay_http = null
	if not relay_answered:
		_launch_relay()
	_connect_after_relay_check()


func _connect_after_relay_check() -> void:
	if _wanted and _ws == null:
		_next_attempt_ms = 0
		_retry_ms = _RETRY_START_MS
		_open_socket()


func _launch_relay() -> void:
	var exe := relay_executable()
	if exe == "":
		push_warning("phone-wand: start_relay is on, but the relay isn't built for %s %s. See docs/shipping.md." % [OS.get_name(), Engine.get_architecture_name()])
		return
	if not FileAccess.file_exists(exe):
		push_warning("phone-wand: start_relay is on, but there is no relay at %s. Put the phone-wand-relay folder there, or set relay_path. See docs/shipping.md." % exe)
		return
	if OS.get_name() != "Windows":
		OS.execute("chmod", ["+x", exe])  # Failures don't matter: it may already be executable.
	var log_file := ProjectSettings.globalize_path("user://phone-wand-relay.log")
	var args := PackedStringArray(["--lifeline", "--no-open", "--app-port", str(_relay_port), "--log", log_file])
	args.append_array(relay_arguments)
	var info := OS.execute_with_pipe(exe, args, false)
	if info.is_empty() or int(info.get("pid", -1)) < 0:
		push_warning("phone-wand: the relay at %s could not start." % exe)
		return
	_relay_stdio = info.get("stdio")
	_relay_stderr = info.get("stderr")
	_relay_pid = int(info["pid"])
	print("phone-wand: started the relay (process %d); its log is %s" % [_relay_pid, log_file])


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


## Sets this app's gesture sensitivity (see docs/gestures.md): threshold is the acceleration in
## m/s² that starts a movement (lower is more sensitive), min_speed the peak speed in m/s a movement
## must reach, twist_rate the rolling speed in degrees per second that makes a twist, and flick_rate
## the turning speed that makes a flick. Turns gestures on. The same as setting the gesture_*
## properties, and sent again after reconnecting.
func configure_gestures(threshold: float = 7.0, min_speed: float = 0.35, twist_rate: float = 360.0, flick_rate: float = 250.0) -> void:
	_gestures_batch = true
	gesture_threshold = threshold
	gesture_min_speed = min_speed
	gesture_twist_rate = twist_rate
	gesture_flick_rate = flick_rate
	gestures_enabled = true
	_gestures_batch = false
	_send_gestures()


## Turns gesture signals on or off for this app. Remembered across reconnects.
func set_gestures_enabled(enabled: bool) -> void:
	gestures_enabled = enabled


# The configure message's gestures value: the settings, or false.
func _gesture_settings() -> Variant:
	if not gestures_enabled:
		return false
	return {"threshold": gesture_threshold, "minSpeed": gesture_min_speed, "flickRate": gesture_flick_rate, "twistRate": gesture_twist_rate}


func _send_gestures() -> void:
	if not _gestures_batch:
		_send({"type": "configure", "gestures": _gesture_settings()})


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


## Chooses the controls a phone shows, or every phone's when id is "". layout is a Dictionary in
## the protocol's shape ({"template": ..., "controls": [...]}; PhoneWandLayout builds them), or
## null for the default Primary and Secondary. An invalid layout changes nothing and comes back as
## relay_error. See docs/layouts.md.
func set_layout(layout: Variant, id: String = "") -> void:
	var msg := {"type": "layout", "layout": layout if layout is Dictionary else null}
	if id != "":
		msg["id"] = id
	_send(msg)


## Changes a control's value on a phone, or on every phone when id is "": a toggle's bool, a
## slider's 0 to 1, a choice's option index, or a label's text. A number sent to a label becomes
## its text. Every app then gets control_changed.
func set_control(control: String, value: Variant, id: String = "") -> void:
	var targets: Array = []
	if id != "":
		var p: PhoneWandPlayer = players.get(id)
		if p != null:
			targets.append(p)
	else:
		targets = players.values()
	var number := typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT
	if number:
		for p in targets:
			var type := str(p.find_control(control).get("type", ""))
			if type == "label":
				value = _number_text(value)
				break
			if type == "choice":
				value = int(value)
				break
	var msg := {"type": "set", "control": control, "value": value}
	if id != "":
		msg["id"] = id
	_send(msg)


# 3.0 as "3", 2.5 as "2.5".
static func _number_text(value: Variant) -> String:
	if typeof(value) == TYPE_FLOAT and value == floorf(value) and absf(value) < 1e15:
		return str(int(value))
	return str(value)


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
		"control":
			var p := _known(msg)
			if p == null:
				return
			var c := str(msg.get("control", ""))
			control_changed.emit(p, c, p.apply_control(c, msg.get("value")))
		"error":
			var message := str(msg.get("message", ""))
			if relay_error.get_connections().is_empty():
				push_warning("phone-wand: " + message)
			else:
				relay_error.emit(message)
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
		"gesture":
			var p := _known(msg)
			if p == null:
				return
			gesture.emit(p, _gesture_event(msg))


# A gesture message as the gesture signal's Dictionary, with dir in Godot's frame.
static func _gesture_event(msg: Dictionary) -> Dictionary:
	var held := PackedStringArray()
	var list: Variant = msg.get("buttons")
	if list is Array:
		for b in list:
			held.append(str(b))
	held.sort()
	return {
		"gesture": str(msg.get("gesture", "")),
		"strength": float(msg.get("strength", 0.0)),
		"speed": float(msg.get("speed", 0.0)),
		"dir": PhoneWandFrames.dir_to_godot(msg.get("dir")),
		"angle": float(msg.get("angle", 0.0)),
		"duration": float(msg.get("duration", 0.0)),
		"t": float(msg.get("t", 0.0)),
		"buttons": held,
	}


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
