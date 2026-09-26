@tool
extends EditorPlugin
## Registers the PhoneWand autoload (a PhoneWandClient) while the plugin is enabled, and the
## phone_wand/* project settings the autoload reads.

const AUTOLOAD_NAME := "PhoneWand"

## Project settings read by the PhoneWand autoload when it becomes ready.
const SETTINGS := [
	{"name": "phone_wand/start_relay", "type": TYPE_BOOL, "default": false,
		"hint": PROPERTY_HINT_NONE, "hint_string": ""},
	{"name": "phone_wand/relay_path", "type": TYPE_STRING, "default": "",
		"hint": PROPERTY_HINT_NONE, "hint_string": ""},
]


func _enter_tree() -> void:
	for s in SETTINGS:
		var setting_name: String = s["name"]
		if not ProjectSettings.has_setting(setting_name):
			ProjectSettings.set_setting(setting_name, s["default"])
		ProjectSettings.set_initial_value(setting_name, s["default"])
		ProjectSettings.set_as_basic(setting_name, true)
		ProjectSettings.add_property_info({"name": setting_name, "type": s["type"],
			"hint": s["hint"], "hint_string": s["hint_string"]})


func _enable_plugin() -> void:
	if not ProjectSettings.has_setting("autoload/" + AUTOLOAD_NAME):
		add_autoload_singleton(AUTOLOAD_NAME, _client_path())


func _disable_plugin() -> void:
	if ProjectSettings.has_setting("autoload/" + AUTOLOAD_NAME):
		remove_autoload_singleton(AUTOLOAD_NAME)


func _client_path() -> String:
	return (get_script() as Script).resource_path.get_base_dir().path_join("phone_wand_client.gd")
