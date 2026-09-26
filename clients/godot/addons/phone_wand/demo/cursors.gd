extends Control
## Phone Wand demo: draws each player's cursor where their phone points.
##
## - A coloured ring with the player's name at their screen position.
## - A ripple when they press the primary button (and a filled ring while it is held).
## - An arrow at the edge of the window when they point off the screen.
## - The join QR code (loaded from the relay as a PNG) and the join URL as text.
##
## Uses the PhoneWand autoload when the plugin is enabled, or makes its own client if not.

const CURSOR_RADIUS := 18.0
const RIPPLE_TIME := 0.6
const EDGE_MARGIN := 28.0

## The relay to use when this scene makes its own client (no PhoneWand autoload).
@export var relay_url: String = PhoneWandClient.DEFAULT_URL

var wand: PhoneWandClient
var _ripples: Array[Dictionary] = []
var _qr_request: HTTPRequest
var _qr_loaded_from := ""

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
		add_child(wand)
	wand.connected.connect(_on_connected)
	wand.disconnected.connect(_on_disconnected)
	wand.player_joined.connect(_on_players_changed.unbind(1))
	wand.player_left.connect(_on_players_changed.unbind(1))
	wand.button.connect(_on_button)
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
	if button_name == "primary" and down and player.has_screen:
		_ripples.append({"pos": _clamped(player.screen_position(size)), "colour": player.colour, "age": 0.0})


func _update_status() -> void:
	if not wand.is_relay_connected():
		_status_label.text = "Waiting for the Phone Wand relay at %s\nStart it with: phone-wand --simulate 3" % wand.url
		_qr_panel.visible = false
		return
	var count := wand.players.size()
	var max_players := int(wand.hello.get("maxPlayers", 0))
	_status_label.text = "%d of %d players.  Keys: C calibrate screen, R ask to recentre, P prompt, H haptic, Q show or hide QR" % [count, max_players]
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
		var colour := player.colour
		if player.state != "active":
			colour = colour.darkened(0.5)
		var inside := player.has_screen and Rect2(Vector2.ZERO, size).grow(-1.0).has_point(player.screen_position(size))
		if inside:
			var pos := player.screen_position(size)
			if player.is_pressed("primary"):
				draw_circle(pos, CURSOR_RADIUS, colour)
			draw_circle(pos, CURSOR_RADIUS, colour, false, 4.0, true)
			draw_circle(pos, 3.0, colour)
			_draw_name(font, font_size, pos, player, colour, false)
		else:
			_draw_edge_arrow(font, font_size, player, colour)


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
