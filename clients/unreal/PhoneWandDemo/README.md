# Phone Wand demo (Unreal)

A ready-to-open sample project for the Phone Wand plugin. Every phone draws a cursor in its
player's colour, with its name, a ripple when the player presses the main button, and an arrow at
the edge of the screen when it points off the screen. The join QR code sits in the top-right corner.

1. Keep this folder next to the `Plugins` folder that holds the `PhoneWand` plugin, as in the release
   zip. The project finds the plugin through `AdditionalPluginDirectories`.
2. Start the relay (`phone-wand`, or `phone-wand --simulate 3` to try it without phones). Or let
   the demo start it: **Start Relay** is on in its settings, so if no relay is running and the
   relay binaries are in `Plugins/PhoneWand/Resources/Relay/phone-wand-relay/`, the demo starts one,
   hidden, and stops it when you stop playing.
3. Open `PhoneWandDemo.uproject` in Unreal 5.7 and let it build, then press **Play**.

The project has no content of its own: it opens the engine's `Template_Default` map and its game
mode adds the HUD. See [docs/clients/unreal.md](https://github.com/wildwinter/phone-wand/blob/main/docs/clients/unreal.md).
