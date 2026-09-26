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
