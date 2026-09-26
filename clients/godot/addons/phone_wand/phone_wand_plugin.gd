@tool
extends EditorPlugin
## Registers the PhoneWand autoload (a PhoneWandClient) while the plugin is enabled.

const AUTOLOAD_NAME := "PhoneWand"


func _enable_plugin() -> void:
	if not ProjectSettings.has_setting("autoload/" + AUTOLOAD_NAME):
		add_autoload_singleton(AUTOLOAD_NAME, _client_path())


func _disable_plugin() -> void:
	if ProjectSettings.has_setting("autoload/" + AUTOLOAD_NAME):
		remove_autoload_singleton(AUTOLOAD_NAME)


func _client_path() -> String:
	return (get_script() as Script).resource_path.get_base_dir().path_join("phone_wand_client.gd")
