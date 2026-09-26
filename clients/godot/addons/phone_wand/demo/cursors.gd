extends Control
## Phone Wand demo: draws each player's cursor where their phone points.
##
## - A coloured ring with the player's name at their screen position.
## - A ripple when they press a button (and a filled ring while one is held).
## - An arrow at the edge of the window when they point off the screen.
## - A line of text at the bottom left for each player who still has to set up their aim (players
##   have no screen position until they have calibrated once, or while they are calibrating).
## - The join QR code (loaded from the relay as a PNG) and the join URL as text.
## - L cycles every phone through sample layouts (the default, primary-row with a toggle and a
##   label, and a grid with every kind of control); the latest control change shows at the top.
##
## Uses the PhoneWand autoload when the plugin is enabled, or makes its own client if not. With the
## phone_wand/start_relay project setting on (as in this project), the client starts the relay
## from res://phone-wand-relay itself when none is running.

const CURSOR_RADIUS := 18.0
const RIPPLE_TIME := 0.6
const EDGE_MARGIN := 28.0
## Space kept clear below the waiting list for the status line.
const WAITING_BOTTOM := 48.0
## How long the latest control change (or relay error) stays at the top of the window.
const NOTICE_TIME := 2.5

## The relay to use when this scene makes its own client (no PhoneWand autoload).
@export var relay_url: String = PhoneWandClient.DEFAULT_URL

var wand: PhoneWandClient
var _ripples: Array[Dictionary] = []
var _qr_request: HTTPRequest
var _qr_loaded_from := ""
var _layouts: Array = []
var _layout_index := 0
var _notice := ""
var _notice_colour := Color.WHITE
var _notice_age := NOTICE_TIME

@onready var _qr_panel: PanelContainer = %QrPanel
@onready var _qr_image: TextureRect = %QrImage
@onready var _join_label: Label = %JoinLabel
@onready var _status_label: Label = %StatusLabel


func _ready() -> void:
	wand = get_node_or_null("/root/PhoneWand") as PhoneWandClient
	if wand == null:
		wand = PhoneWandClient.new()
		wand.name = "PhoneWandClient"
		wand.url = relay_url
		# Like the autoload, start the relay when the phone_wand/start_relay project setting is on.
		wand.start_relay = bool(ProjectSettings.get_setting("phone_wand/start_relay", false))
		add_child(wand)
	wand.connected.connect(_on_connected)
	wand.disconnected.connect(_on_disconnected)
	wand.player_joined.connect(_on_players_changed.unbind(1))
	wand.player_left.connect(_on_players_changed.unbind(1))
	wand.button.connect(_on_button)
	wand.control_changed.connect(_on_control_changed)
	wand.relay_error.connect(_on_relay_error)
	_layouts = _sample_layouts()
	_qr_request = HTTPRequest.new()
	add_child(_qr_request)
	_qr_request.request_completed.connect(_on_qr_completed)
	if wand.is_relay_connected():
		_on_connected(wand.hello)
	_update_status()


func _process(delta: float) -> void:
	for r in _ripples:
		r["age"] += delta
	_ripples = _ripples.filter(func(r: Dictionary) -> bool: return r["age"] < RIPPLE_TIME)
	_notice_age += delta
	queue_redraw()


func _unhandled_input(event: InputEvent) -> void:
	# Keys for trying the app-to-relay messages from the keyboard.
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_C:
				wand.calibrate("screen")
			KEY_R:
				wand.calibrate("ray")
			KEY_P:
				wand.prompt("Hello from Godot")
			KEY_H:
				wand.haptic([40, 60, 40])
			KEY_Q:
				_qr_panel.visible = not _qr_panel.visible
			KEY_L:
				_layout_index = (_layout_index + 1) % _layouts.size()
				var entry: Dictionary = _layouts[_layout_index]
				wand.set_layout(entry["layout"])
				_show_notice("Layout on every phone: " + entry["name"], Color.WHITE)


func _on_connected(hello: Dictionary) -> void:
	_join_label.text = "Join at\n" + str(hello.get("joinUrl", ""))
	var qr := wand.get_qr_url(512)
	if qr != "" and qr != _qr_loaded_from:
		_qr_request.cancel_request()
		if _qr_request.request(qr) == OK:
			_qr_loaded_from = qr
	_update_status()


func _on_disconnected() -> void:
	_qr_loaded_from = ""
	_update_status()


func _on_players_changed() -> void:
	_update_status()


func _on_qr_completed(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_qr_loaded_from = ""
		return
	var image := Image.new()
	if image.load_png_from_buffer(body) != OK:
		return
	_qr_image.texture = ImageTexture.create_from_image(image)


func _on_button(player: PhoneWandPlayer, button_name: String, down: bool) -> void:
	if not down:
		return
	# Any button makes a ripple, so custom layouts work too.
	if player.has_screen:
		_ripples.append({"pos": _clamped(player.screen_position(size)), "colour": player.colour, "age": 0.0})
	# The sample layouts' labels count presses, to show set_control.
	match button_name:
		"shoot":
			wand.set_control("ammo", maxi(int(player.get_control("ammo", "0")) - 1, 0), player.id)
		"reload":
			wand.set_control("ammo", 12, player.id)
		"fire":
			wand.set_control("score", int(player.get_control("score", "0")) + 1, player.id)


func _on_control_changed(player: PhoneWandPlayer, control: String, value: Variant) -> void:
	_show_notice("%s: %s = %s" % [player.name, control, JSON.stringify(value)], player.colour)


func _on_relay_error(message: String) -> void:
	_show_notice("Relay error: " + message, Color(1.0, 0.36, 0.42))


func _show_notice(text: String, colour: Color) -> void:
	_notice = text
	_notice_colour = colour
	_notice_age = 0.0


# The layouts L cycles through: the default, then primary-row and grid.
static func _sample_layouts() -> Array:
	return [
		{"name": "default", "layout": null},
		{"name": "primary-row", "layout": PhoneWandLayout.layout("primary-row", [
			PhoneWandLayout.button("shoot", "Shoot"),
			PhoneWandLayout.button("reload", "Reload"),
			PhoneWandLayout.toggle("zoom", "Zoom"),
			PhoneWandLayout.label("ammo", "Ammo", "12"),
		])},
		{"name": "grid", "layout": PhoneWandLayout.layout("grid", [
			PhoneWandLayout.button("fire", "Fire"),
			PhoneWandLayout.toggle("shield", "Shield"),
			PhoneWandLayout.slider("power", "Power", 0.5),
			PhoneWandLayout.slider("throttle", "Throttle", 0.5, true, 0.5),
			PhoneWandLayout.choice("weapon", ["Bow", "Sling", "Net"], "Weapon"),
			PhoneWandLayout.label("score", "Score", "0"),
		])},
	]


func _update_status() -> void:
	if not wand.is_relay_connected():
		if wand.is_relay_started():
			_status_label.text = "Starting the Phone Wand relay at %s" % wand.url
		else:
			_status_label.text = "Waiting for the Phone Wand relay at %s\nStart it with: phone-wand --simulate 3" % wand.url
		_qr_panel.visible = false
		return
	var count := wand.players.size()
	var max_players := int(wand.hello.get("maxPlayers", 0))
	_status_label.text = "%d of %d players.  Keys: C calibrate screen, R ask to recentre, P prompt, H haptic, Q show or hide QR, L next layout" % [count, max_players]
	_qr_panel.visible = true


func _draw() -> void:
	var font := get_theme_default_font()
	var font_size := get_theme_default_font_size()
	for r in _ripples:
		var k: float = r["age"] / RIPPLE_TIME
		var c: Color = r["colour"]
		c.a = 1.0 - k
		draw_arc(r["pos"], CURSOR_RADIUS + 70.0 * k, 0.0, TAU, 48, c, 4.0 * (1.0 - k) + 1.0, true)
	for player in wand.players_by_slot():
		if not player.has_pose:
			continue
		# No cursor until the player has aimed once, nor while they calibrate: _draw_waiting says why.
		if not player.has_screen and _is_waiting(player):
			continue
		var colour := player.colour
		if player.state != "active":
			colour = colour.darkened(0.5)
		var inside := player.has_screen and Rect2(Vector2.ZERO, size).grow(-1.0).has_point(player.screen_position(size))
		if inside:
			var pos := player.screen_position(size)
			if not player.buttons.is_empty():
				draw_circle(pos, CURSOR_RADIUS, colour)
			draw_circle(pos, CURSOR_RADIUS, colour, false, 4.0, true)
			draw_circle(pos, 3.0, colour)
			_draw_name(font, font_size, pos, player, colour, false)
		else:
			_draw_edge_arrow(font, font_size, player, colour)
	_draw_waiting(font, font_size)
	if _notice != "" and _notice_age < NOTICE_TIME:
		var c := _notice_colour
		c.a = 1.0 - _notice_age / NOTICE_TIME
		var width := font.get_string_size(_notice, HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size).x
		var pos := Vector2((size.x - width) / 2.0, font_size + 16.0)
		draw_string_outline(font, pos, _notice, HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, 4, Color(0, 0, 0, 0.8 * c.a))
		draw_string(font, pos, _notice, HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, c)


# True for a player who still has to do something before they get a cursor.
func _is_waiting(player: PhoneWandPlayer) -> bool:
	return player.state == "waiting" or player.calibration == "none" or player.calibrating != ""


# Lists, bottom left, what each player without a cursor still needs to do on their phone.
func _draw_waiting(font: Font, font_size: int) -> void:
	var waiting: Array[PhoneWandPlayer] = []
	for player in wand.players_by_slot():
		if _is_waiting(player):
			waiting.append(player)
	var line_height := font_size * 1.5
	var left := 16.0
	for i in waiting.size():
		var player := waiting[i]
		var what := "set up your aim on your phone"
		if player.calibrating != "":
			what = "is calibrating: aim at the marked corner"
		elif player.state == "waiting":
			what = "tap Tap to start on your phone"
		var numbered := "Player %d" % (player.slot + 1)
		var who := player.name if player.name == numbered else "%s, %s" % [numbered, player.name]
		var y := size.y - WAITING_BOTTOM - (waiting.size() - 1 - i) * line_height
		draw_circle(Vector2(left + font_size * 0.35, y - font_size * 0.35), font_size * 0.35, player.colour)
		var pos := Vector2(left + font_size, y)
		var text := "%s: %s" % [who, what]
		draw_string_outline(font, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, 4, Color(0, 0, 0, 0.8))
		draw_string(font, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, player.colour)


func _draw_edge_arrow(font: Font, font_size: int, player: PhoneWandPlayer, colour: Color) -> void:
	var centre := size / 2.0
	var toward: Vector2
	if player.has_screen:
		toward = player.screen_position(size) - centre
	else:
		# Pointing far away: use the pointing direction (x right, y up in Godot's frame).
		toward = Vector2(player.dir.x, -player.dir.y) * size.length()
	if toward.length() < 0.001:
		return
	var inner := Rect2(Vector2.ZERO, size).grow(-EDGE_MARGIN)
	var half := inner.size / 2.0
	var scale_x: float = half.x / absf(toward.x) if absf(toward.x) > 0.0001 else INF
	var scale_y: float = half.y / absf(toward.y) if absf(toward.y) > 0.0001 else INF
	var tip := centre + toward * minf(scale_x, scale_y)
	var d := toward.normalized()
	var side := Vector2(-d.y, d.x)
	var points := PackedVector2Array([tip + d * 14.0, tip - d * 10.0 + side * 12.0, tip - d * 10.0 - side * 12.0])
	draw_colored_polygon(points, colour)
	_draw_name(font, font_size, tip - d * 40.0, player, colour, true)


# Draws the player's name beside a point (or centred on it), kept inside the window.
func _draw_name(font: Font, font_size: int, at: Vector2, player: PhoneWandPlayer, colour: Color, centred: bool) -> void:
	var text := player.name if player.name != "" else player.id
	if player.label != "":
		text += " (" + player.label + ")"
	var text_size := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size)
	var pos: Vector2
	if centred:
		pos = at + Vector2(-text_size.x / 2.0, font_size / 2.0)
	else:
		pos = at + Vector2(CURSOR_RADIUS + 6.0, font_size / 2.0)
		if pos.x + text_size.x > size.x - 4.0:
			pos.x = at.x - CURSOR_RADIUS - 6.0 - text_size.x
	pos.x = clampf(pos.x, 4.0, maxf(4.0, size.x - text_size.x - 4.0))
	pos.y = clampf(pos.y, font_size + 4.0, size.y - 6.0)
	draw_string_outline(font, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, 4, Color(0, 0, 0, 0.8))
	draw_string(font, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, colour.lightened(0.3))


func _clamped(pos: Vector2) -> Vector2:
	return pos.clamp(Vector2.ZERO, size)
