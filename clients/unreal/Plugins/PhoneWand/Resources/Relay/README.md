# Relay binaries

With **Start Relay** on (Project Settings, Plugins, Phone Wand), the plugin starts the Phone Wand
relay from your game when none is running, and stops it when the game stops. It looks for the relay
here:

```
Resources/Relay/phone-wand-relay/
  macos/phone-wand-relay
  windows-x64/phone-wand-relay.exe
  linux-x64/phone-wand-relay
  linux-arm64/phone-wand-relay
```

Get the `phone-wand-relay` folder from `phone-wand-relay-<version>-embed.zip` on the
[releases page](https://github.com/wildwinter/phone-wand/releases) (the same version as the plugin)
and put it in this folder. Leave out the platforms you don't ship. The plugin's build rules stage
the binary for the platform you package with the game.

The binaries are not in the repository (this folder's `.gitignore` leaves them out). See
`docs/shipping.md` for signing on macOS and the Windows firewall, and `docs/clients/unreal.md` for
the settings.
