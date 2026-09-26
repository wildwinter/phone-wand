extends SceneTree
## Connects to a running Phone Wand relay and checks that events arrive.
##
##   Godot --headless --path clients/godot --script res://test/live_check.gd -- [url] [seconds]
##
## url defaults to ws://127.0.0.1:8480/app and seconds to 5. Start the relay with simulated players
## first (phone-wand --simulate 3). Exits 0 only if the client connected, saw at least one player
## join and received poses.

var _client: PhoneWandClient
var _elapsed := 0.0
var _duration := 5.0
var _connected := 0
var _joins := 0
var _poses := 0
var _buttons := 0
var _stats := 0
var _changes := 0
var _sent := false


func _initialize() -> void:
	var autoload := root.get_node_or_null("PhoneWand")
	if autoload is PhoneWandClient:
		autoload.auto_connect = false
		autoload.disconnect_from_relay()
	var args := OS.get_cmdline_user_args()
	var url: String = args[0] if args.size() > 0 else PhoneWandClient.DEFAULT_URL
	if args.size() > 1:
		_duration = float(args[1])
	print("Phone Wand live check against ", url, " for ", _duration, " s")
	_client = PhoneWandClient.new()
	_client.url = url
	_client.connected.connect(func(hello: Dictionary) -> void:
		_connected += 1
		print("  connected: relay ", hello.get("relay"), ", protocol ", hello.get("protocol"), ", join ", hello.get("joinUrl")))
	_client.disconnected.connect(func() -> void: print("  disconnected"))
	_client.player_joined.connect(func(p: PhoneWandPlayer) -> void:
		_joins += 1
		print("  join ", p.id, " slot ", p.slot, " ", p.name, " ", p.colour_hex, " ", p.state))
	_client.player_changed.connect(func(_p: PhoneWandPlayer) -> void: _changes += 1)
	_client.pose.connect(func(_p: PhoneWandPlayer) -> void: _poses += 1)
	_client.button.connect(func(_p: PhoneWandPlayer, _b: String, _d: bool) -> void: _buttons += 1)
	_client.stats.connect(func(_p: PhoneWandPlayer) -> void: _stats += 1)
	root.add_child(_client)


func _process(delta: float) -> bool:
	_elapsed += delta
	if not _sent and _client.is_relay_connected() and _elapsed > 1.0:
		# Exercise the app-to-relay messages once; the relay ignores anything it cannot apply.
		_sent = true
		_client.configure_smoothing(1.0, 5.0, 1.0)
		_client.prompt("Godot live check", "", 1000)
		_client.haptic(30)
	if _elapsed < _duration:
		return false
	for p in _client.players_by_slot():
		var where := "screen (%.3f, %.3f)" % [p.screen.x, p.screen.y] if p.has_screen else "no screen"
		print("  %s slot %d %s: seq %d yaw %.1f pitch %.1f dir %s %s, buttons %s, rtt %.1f" % [p.id, p.slot, p.name, p.seq, p.yaw, p.pitch, p.dir, where, p.buttons, p.rtt])
	print("  events: connected %d, joins %d, player %d, poses %d, buttons %d, stats %d" % [_connected, _joins, _changes, _poses, _buttons, _stats])
	var ok := _connected > 0 and _joins > 0 and _poses > 0
	print("LIVE CHECK: " + ("PASS" if ok else "FAIL"))
	_client.disconnect_from_relay()
	quit(0 if ok else 1)
	return true
