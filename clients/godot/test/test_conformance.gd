extends SceneTree
## Replays the Phone Wand conformance suite through PhoneWandClient.handle_message and checks the
## event log, the final player state and the frame conversions.
##
##   Godot --headless --path clients/godot --import
##   Godot --headless --path clients/godot --script res://test/test_conformance.gd [-- <conformance dir>]
##
## Without a path it uses the repository's conformance folder, two levels above this project.
## Prints ALL PASS, or every difference, and exits non-zero on failure.

const TOLERANCE := 0.0001

var _failures := 0
var _log: PackedStringArray = []


func _initialize() -> void:
	# Keep the project's PhoneWand autoload (if any) quiet: this test never touches the network.
	var autoload := root.get_node_or_null("PhoneWand")
	if autoload is PhoneWandClient:
		autoload.auto_connect = false
		autoload.disconnect_from_relay()
	var dir := _conformance_dir()
	print("Phone Wand Godot conformance, suite at ", dir)
	var index: Variant = _read_json(dir.path_join("index.json"))
	if not (index is Dictionary):
		_fail("cannot read index.json in %s" % dir)
		_finish()
		return
	if int(index.get("protocol", -1)) != PhoneWandClient.PROTOCOL_VERSION:
		_fail("suite is protocol %s, client is %d" % [str(index.get("protocol")), PhoneWandClient.PROTOCOL_VERSION])
	for session_name in index.get("sessions", []):
		_run_session(dir, str(session_name))
	_check_conversions(dir)
	_check_value_types()
	_check_gestures()
	_finish()


func _finish() -> void:
	if _failures == 0:
		print("ALL PASS")
		quit(0)
	else:
		print("FAILED: %d difference(s)" % _failures)
		quit(1)


func _conformance_dir() -> String:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		return args[0]
	return ProjectSettings.globalize_path("res://").path_join("../../conformance").simplify_path()


func _fail(message: String) -> void:
	_failures += 1
	printerr("  FAIL ", message)


# ---------------------------------------------------------------- sessions

func _run_session(dir: String, session_name: String) -> void:
	var before := _failures
	var client := PhoneWandClient.new()
	client.auto_connect = false
	client.reconnect = false
	_log = []
	client.connected.connect(func(hello: Dictionary) -> void:
		_log.append("connected protocol=%d max=%d" % [int(hello.get("protocol", 0)), int(hello.get("maxPlayers", 0))]))
	client.player_joined.connect(func(p: PhoneWandPlayer) -> void:
		_log.append("join %s slot=%d name=%s colour=%s" % [p.id, p.slot, p.name, p.colour_hex]))
	client.player_changed.connect(func(p: PhoneWandPlayer) -> void:
		_log.append("player %s state=%s calibration=%s name=%s colour=%s transport=%s" % [p.id, p.state, p.calibration, p.name, p.colour_hex, p.transport]))
	client.player_left.connect(func(p: PhoneWandPlayer) -> void:
		_log.append("leave %s" % p.id))
	client.pose.connect(func(p: PhoneWandPlayer) -> void:
		_log.append("pose %s seq=%d screen=%s" % [p.id, p.seq, "yes" if p.has_screen else "no"]))
	client.button.connect(func(p: PhoneWandPlayer, b: String, down: bool) -> void:
		_log.append("button %s %s %s" % [p.id, b, "down" if down else "up"]))
	client.control_changed.connect(func(p: PhoneWandPlayer, c: String, _value: Variant) -> void:
		_log.append("control %s %s" % [p.id, c]))
	# error fires nothing in the log; connecting keeps the warnings out of the output.
	client.relay_error.connect(func(_message: String) -> void: pass)
	client.gesture.connect(func(p: PhoneWandPlayer, g: Dictionary) -> void:
		var held: PackedStringArray = g["buttons"]
		_log.append("gesture %s %s buttons=%s" % [p.id, g["gesture"], ",".join(held) if held.size() > 0 else "-"]))
	client.calibrating.connect(func(p: PhoneWandPlayer, step: String) -> void:
		_log.append("calibrating %s %s" % [p.id, step]))
	client.calibrated.connect(func(p: PhoneWandPlayer, calibration: String) -> void:
		_log.append("calibrated %s %s" % [p.id, calibration]))
	client.stats.connect(func(p: PhoneWandPlayer) -> void:
		_log.append("stats %s" % p.id))

	var stream := FileAccess.get_file_as_string(dir.path_join("app/%s.jsonl" % session_name))
	if stream == "":
		_fail("%s: cannot read app/%s.jsonl" % [session_name, session_name])
		client.free()
		return
	var lines := 0
	for line in stream.split("\n", false):
		if line.strip_edges() == "":
			continue
		client.handle_message(line)
		lines += 1

	# Event log, line for line.
	var expected_text := FileAccess.get_file_as_string(dir.path_join("app/%s.events.txt" % session_name))
	var expected: PackedStringArray = []
	for line in expected_text.split("\n", false):
		if line.strip_edges() != "":
			expected.append(line.strip_edges(false, true))
	var n := maxi(expected.size(), _log.size())
	var shown := 0
	for i in n:
		var want := expected[i] if i < expected.size() else "<end>"
		var got := _log[i] if i < _log.size() else "<end>"
		if want != got:
			if shown < 10:
				_fail("%s: event %d: expected '%s', got '%s'" % [session_name, i + 1, want, got])
			else:
				_failures += 1
			shown += 1
	if shown > 10:
		printerr("  ... and %d more event differences in %s" % [shown - 10, session_name])

	# Final state.
	var want_state: Variant = _read_json(dir.path_join("app/%s.state.json" % session_name))
	if not (want_state is Dictionary):
		_fail("%s: cannot read app/%s.state.json" % [session_name, session_name])
	else:
		_compare(want_state, _state(client), session_name + ".state")

	var verdict := "ok" if _failures == before else "FAILED"
	print("  %s: %d messages, %d events, %s" % [session_name, lines, _log.size(), verdict])
	client.free()


func _state(client: PhoneWandClient) -> Dictionary:
	var list: Array = []
	for p in client.players_by_slot():
		var buttons: Array = p.buttons.duplicate()
		buttons.sort()
		var pose: Variant = null
		if p.has_pose:
			pose = {
				"seq": p.seq,
				"yaw": p.yaw,
				"pitch": p.pitch,
				"roll": p.roll,
				"q": p.rig_q,
				"dir": p.rig_dir,
				"screen": [p.screen.x, p.screen.y] if p.has_screen else null,
			}
		list.append({
			"id": p.id,
			"slot": p.slot,
			"name": p.name,
			"colour": p.colour_hex,
			"label": p.label,
			"state": p.state,
			"calibration": p.calibration,
			"transport": p.transport,
			"buttons": buttons,
			"template": p.template,
			"controls": p.controls,
			"pose": pose,
		})
	return {"players": list}


func _is_number(v: Variant) -> bool:
	return typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT


func _compare(want: Variant, got: Variant, path: String) -> void:
	if _is_number(want):
		if not _is_number(got) or absf(float(want) - float(got)) > TOLERANCE:
			_fail("%s: expected %s, got %s" % [path, str(want), str(got)])
	elif want is Dictionary:
		if not (got is Dictionary):
			_fail("%s: expected an object, got %s" % [path, str(got)])
			return
		for key in want:
			if not got.has(key):
				_fail("%s.%s: missing" % [path, key])
			else:
				_compare(want[key], got[key], "%s.%s" % [path, key])
		for key in got:
			if not want.has(key):
				_fail("%s.%s: unexpected field" % [path, key])
	elif want is Array:
		if not (got is Array) or got.size() != want.size():
			_fail("%s: expected %s, got %s" % [path, str(want), str(got)])
			return
		for i in want.size():
			_compare(want[i], got[i], "%s[%d]" % [path, i])
	elif want == null:
		if got != null:
			_fail("%s: expected null, got %s" % [path, str(got)])
	else:
		if typeof(got) != typeof(want) or got != want:
			_fail("%s: expected %s, got %s" % [path, str(want), str(got)])


# ---------------------------------------------------------------- control value types

# Godot parses every JSON number as a float: check choices come out as ints, sliders as floats and
# labels as text, and that PhoneWandLayout builds what the relay expects.
func _check_value_types() -> void:
	var before := _failures
	var client := PhoneWandClient.new()
	client.auto_connect = false
	client.reconnect = false
	var grid := PhoneWandLayout.layout("grid", [
		PhoneWandLayout.button("fire", "Fire"),
		PhoneWandLayout.slider("power", "Power", 0.5),
		PhoneWandLayout.choice("weapon", ["Bow", "Sling"], "Weapon", 1),
		PhoneWandLayout.label("score", "Score", "7"),
	])
	var player := {"id": "p1", "slot": 0, "name": "A", "colour": "#ff4d6d", "label": "", "state": "active",
		"calibration": "none", "device": {}, "layout": grid, "controls": {"power": 0.5, "weapon": 1, "score": "7"}}
	client.handle_message(JSON.stringify({"type": "join", "player": player}))
	var got := []
	client.control_changed.connect(func(_p: PhoneWandPlayer, c: String, v: Variant) -> void: got.append([c, v]))
	client.handle_message('{"type":"control","id":"p1","control":"weapon","value":0}')
	client.handle_message('{"type":"control","id":"p1","control":"power","value":1}')
	client.handle_message('{"type":"control","id":"p1","control":"score","value":"10"}')
	var p := client.get_player("p1")
	var checks := [
		[p.template, "grid"],
		[typeof(p.get_control("weapon")), TYPE_INT],
		[p.get_control("weapon"), 0],
		[typeof(p.get_control("power")), TYPE_FLOAT],
		[p.get_control("score"), "10"],
		[p.get_control("missing", -1), -1],
		[got.size(), 3],
		[typeof(got[0][1]) if got.size() > 0 else -1, TYPE_INT],
		[str(p.find_control("weapon").get("type")), "choice"],
		[PhoneWandClient._number_text(12.0), "12"],
		[PhoneWandClient._number_text(2.5), "2.5"],
		[JSON.stringify(PhoneWandLayout.default_layout()), '{"controls":[{"id":"primary","label":"Primary","type":"button"},{"id":"secondary","label":"Secondary","type":"button"}],"template":"primary-secondary"}'],
		[JSON.stringify(PhoneWandLayout.dpad("move")), '{"id":"move","type":"dpad"}'],
		[JSON.stringify(PhoneWandLayout.crawl("walk", "Walk", Color(1, 0, 0))), '{"colour":"#ff0000","id":"walk","label":"Walk","type":"crawl"}'],
		[PhoneWandLayout.button_for("move", PhoneWandLayout.UP), "move.up"],
		[PhoneWandLayout.button_for("walk", PhoneWandLayout.STEP_LEFT), "walk.step-left"],
		[PhoneWandLayout.button_for("walk", PhoneWandLayout.TURN_RIGHT), "walk.turn-right"],
		[",".join(PhoneWandLayout.DPAD_DIRECTIONS), "up,down,left,right"],
		[",".join(PhoneWandLayout.CRAWL_DIRECTIONS), "forward,back,step-left,step-right,turn-left,turn-right"],
		[JSON.stringify(PhoneWandLayout.rows([1, 2], [PhoneWandLayout.crawl("walk"), PhoneWandLayout.button("a"), PhoneWandLayout.label("b")], [3, 2])),
			'{"controls":[{"id":"walk","type":"crawl"},{"id":"a","type":"button"},{"id":"b","text":"","type":"label"}],"heights":[3,2],"rows":[1,2],"template":"rows"}'],
		[JSON.stringify(PhoneWandLayout.rows([2], [PhoneWandLayout.button("a"), PhoneWandLayout.button("b")])),
			'{"controls":[{"id":"a","type":"button"},{"id":"b","type":"button"}],"rows":[2],"template":"rows"}'],
		[JSON.stringify(PhoneWandLayout.columns([1, 2], [PhoneWandLayout.dpad("move"), PhoneWandLayout.button("a"), PhoneWandLayout.button("b")], [1, 2.5])),
			'{"columns":[1,2],"controls":[{"id":"move","type":"dpad"},{"id":"a","type":"button"},{"id":"b","type":"button"}],"template":"columns","widths":[1,2.5]}'],
		[JSON.stringify(PhoneWandLayout.columns([1], [PhoneWandLayout.button("a")])),
			'{"columns":[1],"controls":[{"id":"a","type":"button"}],"template":"columns"}'],
	]
	for i in checks.size():
		if checks[i][0] != checks[i][1]:
			_fail("value types[%d]: expected %s, got %s" % [i, str(checks[i][1]), str(checks[i][0])])
	# A player message replaces the layout and values entirely.
	player["layout"] = PhoneWandLayout.default_layout()
	player["controls"] = {}
	client.handle_message(JSON.stringify({"type": "player", "player": player}))
	if p.template != "primary-secondary" or not p.controls.is_empty():
		_fail("value types: a player message did not replace the layout and controls")
	# A rows layout comes back from the relay with its counts and heights.
	player["layout"] = {"template": "rows", "rows": [1, 3], "heights": [3, 2], "controls": [
		PhoneWandLayout.crawl("walk"), PhoneWandLayout.button("a"), PhoneWandLayout.button("b"), PhoneWandLayout.button("c")]}
	client.handle_message(JSON.stringify({"type": "player", "player": player}))
	if p.template != "rows" or str(p.layout.get("rows")) != str([1.0, 3.0]) or str(p.layout.get("heights")) != str([3.0, 2.0]):
		_fail("value types: a player message lost a rows layout's rows or heights: %s" % str(p.layout))
	client.free()
	var verdict := "ok" if _failures == before else "FAILED"
	print("  control value types: %d checks, %s" % [checks.size() + 2, verdict])


# ---------------------------------------------------------------- gestures

# The gesture signal's Dictionary, accel on poses, and what the client sends in configure.
func _check_gestures() -> void:
	var before := _failures
	var client := PhoneWandClient.new()
	client.auto_connect = false
	client.reconnect = false
	var player := {"id": "p1", "slot": 0, "name": "A", "colour": "#ff4d6d", "label": "", "state": "active",
		"calibration": "ray", "device": {}}
	client.handle_message(JSON.stringify({"type": "join", "player": player}))
	var got := []
	client.gesture.connect(func(p: PhoneWandPlayer, g: Dictionary) -> void: got.append([p, g]))
	client.handle_message('{"type":"gesture","id":"p1","gesture":"pull","strength":0.62,"speed":1.55,"dir":[0.05,-0.1,-0.99],"duration":240,"t":1000.5,"buttons":["secondary","primary"]}')
	client.handle_message('{"type":"gesture","id":"nobody","gesture":"push","strength":1,"speed":1,"dir":[0,0,1],"duration":200,"t":1,"buttons":[]}')
	client.handle_message('{"type":"pose","id":"p1","seq":1,"t":5,"q":[0,0,0,1],"yaw":0,"pitch":0,"roll":0,"dir":[0,0,1],"screen":null,"accel":[1,2,3]}')
	var p := client.get_player("p1")
	var accel_after_first := p.accel
	var has_accel_first := p.has_accel
	client.handle_message('{"type":"pose","id":"p1","seq":2,"t":6,"q":[0,0,0,1],"yaw":0,"pitch":0,"roll":0,"dir":[0,0,1],"screen":null}')
	var g: Dictionary = got[0][1] if got.size() > 0 else {}
	var checks := [
		[got.size(), 1],
		[got[0][0] == p if got.size() > 0 else false, true],
		[g.get("gesture"), "pull"],
		[g.get("buttons"), PackedStringArray(["primary", "secondary"])],
		[g.get("dir", Vector3.ZERO).is_equal_approx(Vector3(0.05, -0.1, 0.99)), true],
		[is_equal_approx(g.get("strength", 0.0), 0.62), true],
		[is_equal_approx(g.get("speed", 0.0), 1.55), true],
		[is_equal_approx(g.get("duration", 0.0), 240.0), true],
		[is_equal_approx(g.get("t", 0.0), 1000.5), true],
		[has_accel_first, true],
		[accel_after_first.is_equal_approx(Vector3(1, 2, -3)), true],
		[p.has_accel, false],
		[p.accel, Vector3.ZERO],
		[JSON.stringify(client._gesture_settings()), '{"flickRate":250.0,"minSpeed":0.35,"threshold":7.0,"twistRate":360.0}'],
	]
	client.configure_gestures(9.0, 0.5, 400.0, 300.0)
	checks.append([JSON.stringify(client._gesture_settings()), '{"flickRate":300.0,"minSpeed":0.5,"threshold":9.0,"twistRate":400.0}'])
	client.set_gestures_enabled(false)
	checks.append([client._gesture_settings(), false])
	client.configure_gestures()
	checks.append([client.gestures_enabled, true])
	for i in checks.size():
		if checks[i][0] != checks[i][1]:
			_fail("gestures[%d]: expected %s, got %s" % [i, str(checks[i][1]), str(checks[i][0])])
	client.free()
	var verdict := "ok" if _failures == before else "FAILED"
	print("  gestures and accel: %d checks, %s" % [checks.size(), verdict])


# ---------------------------------------------------------------- conversions

func _check_conversions(dir: String) -> void:
	var data: Variant = _read_json(dir.path_join("conversions.json"))
	if not (data is Dictionary):
		_fail("cannot read conversions.json")
		return
	var before := _failures
	var cases: Array = data.get("cases", [])
	for i in cases.size():
		var c: Dictionary = cases[i]
		var rig: Dictionary = c["rig"]
		var godot: Dictionary = c["godot"]
		var where := "conversions[%d]" % i
		var q := PhoneWandFrames.quat_to_godot(rig["q"])
		_compare(godot["q"], [q.x, q.y, q.z, q.w], where + ".godot.q")
		var d := PhoneWandFrames.dir_to_godot(rig["dir"])
		_compare(godot["dir"], [d.x, d.y, d.z], where + ".godot.dir")
		var u := PhoneWandFrames.dir_to_godot(rig["up"])
		_compare(godot["up"], [u.x, u.y, u.z], where + ".godot.up")
		# Rotating Godot's own forward (-z) and up (+y) by the quaternion gives dir and up.
		var fwd := q * Vector3.FORWARD
		_compare(godot["dir"], [fwd.x, fwd.y, fwd.z], where + ".rotated forward")
		var up := q * Vector3.UP
		_compare(godot["up"], [up.x, up.y, up.z], where + ".rotated up")
		# And through a player, as a pose would arrive.
		var p := PhoneWandPlayer.new()
		p.apply_pose({"type": "pose", "id": "x", "seq": 0, "t": 0, "q": rig["q"], "yaw": 0, "pitch": 0, "roll": 0, "dir": rig["dir"], "screen": null})
		_compare(godot["dir"], [p.dir.x, p.dir.y, p.dir.z], where + ".player.dir")
		var pf := p.rotation * Vector3.FORWARD
		_compare(godot["dir"], [pf.x, pf.y, pf.z], where + ".player.rotation")
	var verdict := "ok" if _failures == before else "FAILED"
	print("  conversions: %d cases, %s" % [cases.size(), verdict])


func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))
