# Phone Wand for Unreal Engine

Version 0.1.0. MIT licence. By Ian Thomas ([storytools.se](https://storytools.se)).

Phone Wand turns phones into pointers for a shared screen. This plugin connects your Unreal game to
the Phone Wand relay and gives Blueprint and C++ every player's pose, screen position and buttons,
already converted to Unreal's frame.

- Install: copy this `PhoneWand` folder into your project's `Plugins` folder and open the project
  (Unreal 5.7 and a C++ toolchain; the plugin ships as source and compiles on first open).
- Use: get the **Phone Wand Subsystem** from the game instance and bind **On Pose** and
  **On Button**. It connects to `ws://127.0.0.1:8480/app` by itself.
- Try it: open the `PhoneWandDemo` project that sits beside this folder in the release zip.

Full documentation: [docs/clients/unreal.md](https://github.com/wildwinter/phone-wand/blob/main/docs/clients/unreal.md)
in the [Phone Wand repository](https://github.com/wildwinter/phone-wand).
