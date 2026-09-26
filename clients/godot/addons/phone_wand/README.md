# Phone Wand for Godot

Turn the phones people already carry into pointers for a shared screen. This addon connects your
Godot game to a running [Phone Wand](https://github.com/wildwinter/phone-wand) relay and gives you
every player's pointing direction, cursor position and button presses as Godot signals and
Godot-native vectors.

- Godot 4.7, GDScript only, so it works in desktop, mobile and web exports.
- Enable the plugin and the `PhoneWand` autoload is ready to use:

```gdscript
func _ready() -> void:
    PhoneWand.pose.connect(func(player: PhoneWandPlayer) -> void:
        if player.has_screen:
            $Cursor.position = player.screen_position(get_viewport_rect().size))
    PhoneWand.button.connect(func(player: PhoneWandPlayer, button: String, down: bool) -> void:
        if button == "primary" and down:
            print(player.name, " fired"))
```

The demo scene, `demo/cursors.tscn`, draws a cursor for every player who has set up their aim, a line asking the others to, and the
join QR code.

Full documentation: [docs/clients/godot.md](https://github.com/wildwinter/phone-wand/blob/main/docs/clients/godot.md).

Version 0.1.0. MIT licence (see LICENSE). Made by Ian Thomas at [storytools.se](https://storytools.se).
