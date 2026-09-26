extends SceneTree
## Checks start_relay against real relays (see docs/shipping.md, "What the client libraries do").
##
##   Godot --headless --path clients/godot --script res://test/managed_relay_check.gd -- <mode> <app port> <phone port> <data dir>
##
## mode "start": nothing may be listening on the app port. Needs the relay binary at
##   res://phone-wand-relay/<platform>/phone-wand-relay. Checks that the client starts the relay,
##   connects, and that freeing the client stops the relay (status.json stops answering and the
##   process is gone).
## mode "existing": a relay must already be running on the app port, for example
##   bun packages/relay/src/main.ts --no-open --app-port 24480 --port 24443 --no-landing --data-dir <dir>
##   Checks that the client uses it, starts nothing, and leaves it running when freed.
## mode "quit": like "start", but quits the game with the client still in the tree, as a game
##   would. Prints the relay's process id as "relay pid N"; check afterwards that it has gone.
## mode "late": like "start", but turns start_relay on only after the client has begun connecting
##   (as a game does when it sets PhoneWand.start_relay in its first scene's _ready).
## mode "missing": nothing may be listening, and relay_path points at a folder with no relay. Checks
##   that the client warns, starts nothing, and carries on trying to connect.
##
## Prints MANAGED RELAY CHECK: PASS or FAIL and exits 0 only on PASS.

const CONNECT_TIMEOUT_MS := 30000
const MISSING_WAIT_MS := 3000

var _mode := ""
var _app_port := 0
var _client: PhoneWandClient
var _started_ms := 0
var _connected := false
var _failures: Array[String] = []


func _initialize() -> void:
	var autoload := root.get_node_or_null("PhoneWand")
	if autoload is PhoneWandClient:
		autoload.auto_connect = false
		autoload.disconnect_from_relay()
	var args := OS.get_cmdline_user_args()
	if args.size() < 4:
		print("usage: -- <start|existing> <app port> <phone port> <data dir>")
		quit(2)
		return
	_mode = args[0]
	_app_port = int(args[1])
	var already := _status_answers(_app_port)
	print("Managed relay check, mode ", _mode, ", app port ", _app_port, ", relay already answering: ", already)
	if (_mode == "start" or _mode == "quit" or _mode == "late") and already:
		_fail("something is already answering on port %d" % _app_port)
	if _mode == "existing" and not already:
		_fail("no relay is running on port %d" % _app_port)
	if _mode == "missing" and already:
		_fail("something is already answering on port %d" % _app_port)
	_client = PhoneWandClient.new()
	_client.url = "ws://127.0.0.1:%d/app" % _app_port
	_client.start_relay = _mode != "late"
	_client.relay_arguments = PackedStringArray(["--port", args[2], "--no-landing", "--data-dir", args[3]])
	if _mode == "missing":
		_client.relay_path = args[3].path_join("no-relay-here")
	_client.connected.connect(func(hello: Dictionary) -> void:
		_connected = true
		print("  connected: relay ", hello.get("relay"), ", join ", hello.get("joinUrl")))
	root.add_child(_client)
	_started_ms = Time.get_ticks_msec()


func _process(_delta: float) -> bool:
	if not _failures.is_empty():
		return _finish()
	if _mode == "late" and not _client.start_relay:
		print("  client connecting without start_relay; turning it on now")
		_client.start_relay = true
		return false
	if _mode == "missing":
		if Time.get_ticks_msec() - _started_ms < MISSING_WAIT_MS:
			return false
		if _connected:
			_fail("connected, but nothing should be running")
		if _client.get_relay_pid() >= 0:
			_fail("started a relay from a folder with no relay")
		if not _client.is_relay_connected() and _client._wanted and not _client._relay_checked:
			_fail("the relay check did not run")
		print("  no relay started; still trying to connect: ", _client._wanted and _client._relay_http == null)
		return _finish()
	if not _connected:
		if Time.get_ticks_msec() - _started_ms > CONNECT_TIMEOUT_MS:
			_fail("did not see connected within %d ms" % CONNECT_TIMEOUT_MS)
			return _finish()
		return false

	var pid := _client.get_relay_pid()
	print("  relay pid started by the client: ", pid, ", is_relay_started: ", _client.is_relay_started())
	if _mode == "quit":
		if pid < 0:
			_fail("the client did not start the relay")
		print("  relay pid ", pid, "; quitting with the client still in the tree")
		for f in _failures:
			print("  FAIL: ", f)
		print("MANAGED RELAY CHECK (quit): %s" % ("PASS so far; check the relay has gone" if _failures.is_empty() else "FAIL"))
		quit(0 if _failures.is_empty() else 1)
		return true
	if _mode == "start" or _mode == "late":
		if pid < 0 or not _client.is_relay_started():
			_fail("the client did not start the relay")
		print("  freeing the client")
		var t := Time.get_ticks_msec()
		root.remove_child(_client)
		_client.free()
		print("  freed in %d ms" % (Time.get_ticks_msec() - t))
		if pid >= 0 and OS.is_process_running(pid):
			_fail("relay process %d is still running after the client was freed" % pid)
		if _status_answers(_app_port):
			_fail("status.json still answers after the client was freed")
		else:
			print("  status.json no longer answers; relay process gone: ", pid >= 0 and not OS.is_process_running(pid))
	else:
		if pid >= 0:
			_fail("the client started a relay (process %d) although one was running" % pid)
		root.remove_child(_client)
		_client.free()
		OS.delay_msec(1000)
		if not _status_answers(_app_port):
			_fail("the existing relay stopped answering after the client was freed")
		else:
			print("  the existing relay still answers after the client was freed")
	return _finish()


func _finish() -> bool:
	var autoload := root.get_node_or_null("PhoneWand")
	if autoload is PhoneWandClient:
		# This project turns on phone_wand/start_relay for the demo; the autoload reads it when ready
		# (it is kept from connecting above, so it starts nothing here).
		print("  PhoneWand autoload start_relay (from the project setting): ", autoload.start_relay, ", started a relay: ", autoload.get_relay_pid() >= 0)
	for f in _failures:
		print("  FAIL: ", f)
	var ok := _failures.is_empty()
	print("MANAGED RELAY CHECK (%s): %s" % [_mode, "PASS" if ok else "FAIL"])
	if is_instance_valid(_client):
		_client.free()
	quit(0 if ok else 1)
	return true


func _fail(text: String) -> void:
	_failures.append(text)


# A blocking GET of status.json, true if a relay answers within about a second.
func _status_answers(port: int) -> bool:
	var http := HTTPClient.new()
	if http.connect_to_host("127.0.0.1", port) != OK:
		return false
	var deadline := Time.get_ticks_msec() + 1000
	var requested := false
	var body := PackedByteArray()
	while Time.get_ticks_msec() < deadline:
		http.poll()
		var status := http.get_status()
		if status == HTTPClient.STATUS_CONNECTED:
			if requested:
				break
			http.request(HTTPClient.METHOD_GET, "/status.json", [])
			requested = true
		elif status == HTTPClient.STATUS_BODY:
			body.append_array(http.read_response_body_chunk())
		elif status != HTTPClient.STATUS_RESOLVING and status != HTTPClient.STATUS_CONNECTING and status != HTTPClient.STATUS_REQUESTING:
			break
		OS.delay_msec(10)
	http.close()
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8()) if not body.is_empty() else null
	return parsed is Dictionary and parsed.get("relay") is String
