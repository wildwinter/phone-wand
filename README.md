# Phone Wand

[![CI](https://github.com/wildwinter/phone-wand/actions/workflows/ci.yml/badge.svg)](https://github.com/wildwinter/phone-wand/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/wildwinter/phone-wand?label=release)](https://github.com/wildwinter/phone-wand/releases/latest)

Turn the phones people already carry into pointers for a shared screen.

Each phone becomes a cursor you aim by turning the phone, with big buttons on its touchscreen.
Players scan a QR code and they're in: nothing to install, no accounts. Your app, in Unity,
Unreal, Godot or JavaScript, sees each player's pointing direction, a cursor position and button
presses.

It's made for prototyping and playtesting things designed for VR controllers, light guns or custom
hardware before that hardware exists. It also suits installations, party games and training rigs
where visitors use their own phones.

```
phones (browser page, HTTPS) --Wi-Fi--> relay (on the display machine) --localhost--> your app
```

- **The phone page** reads the gyroscope, shows Primary, Secondary, Recentre and Calibrate buttons,
  and keeps the screen awake.
- **The relay** is a single program on the machine driving the display. It serves the phone page,
  hands out player slots, does the calibration and smoothing, and passes everything to your app
  over a local WebSocket. Its dashboard shows who is connected and has a full-screen test screen.
- **Client libraries** for [Unity](docs/clients/unity.md), [Unreal](docs/clients/unreal.md),
  [Godot](docs/clients/godot.md) and [JavaScript](docs/clients/js.md) turn that into events and
  engine-native vectors. Anything else can use the [protocol](docs/protocol.md) directly.

## Try it in two minutes

1. Download the relay for the computer that drives your screen from the
   [latest release](https://github.com/wildwinter/phone-wand/releases/latest), and open or unzip it:

   | Computer | Download | To run it |
   |---|---|---|
   | Mac with Apple silicon | `phone-wand-relay-<version>-macos-arm64.dmg` | Open the disk image, drag **Phone Wand** to Applications and open it. It shows in the Dock while the relay runs; quit it to stop the relay. |
   | Intel Mac | `phone-wand-relay-<version>-macos-x64.dmg` | The same |
   | Windows | `phone-wand-relay-<version>-windows-x64.zip` | Unzip it and double-click **Phone Wand.exe**. Its icon sits in the notification area while the relay runs; right-click it to quit. If SmartScreen appears, choose **More info**, then **Run anyway**. Allow it through the firewall on private networks. |
   | Linux | `phone-wand-relay-<version>-linux-x64.tar.gz` (or `-linux-arm64`) | Run `./phone-wand` |

   It opens the dashboard in your browser, with a QR code for phones. Nothing else to install.
2. Scan the QR code with a phone on the same Wi-Fi. A welcome page explains the certificate warning
   that follows and which buttons to tap (see [Phones and certificates](docs/phones.md) to get rid
   of it for good). Then tap **Tap to start**.
3. Press **F** on the dashboard for a full-screen test screen. The phone asks you to set up your
   aim: tap **Calibrate screen**, then aim the top of the phone at the top-left corner of the screen
   and tap, then the bottom-right corner and tap. Your cursor appears where you point.

No phone to hand? Run `phone-wand --simulate 3` for three simulated players.

Phones need a browser with motion sensors: Safari or Chrome on iPhone and iPad, Chrome on Android.

## Add it to your app

| Engine | Get it | Docs |
|---|---|---|
| Unity 6.4 (6000.4) | Package Manager, **Add package from git URL**: `https://github.com/wildwinter/phone-wand.git?path=clients/unity/PhoneWand`, or unzip `phone-wand-unity-<version>.zip` into `Packages/` | [Unity](docs/clients/unity.md) |
| Unreal 5.7 | Unzip `phone-wand-unreal-<version>.zip`, copy `PhoneWand` into your project's `Plugins/` (a demo project comes with it) | [Unreal](docs/clients/unreal.md) |
| Godot 4.7 (GDScript, so web exports work too) | Unzip `phone-wand-godot-<version>.zip` into your project, then enable **Phone Wand** under Project Settings, Plugins | [Godot](docs/clients/godot.md) |
| JavaScript and TypeScript (browsers, Node 22+, Bun, Deno) | `phone-wand-js-<version>.zip`, or `<script src="http://127.0.0.1:8480/phone-wand.js">` from a running relay | [JavaScript](docs/clients/js.md) |

Each comes with a sample that draws a coloured cursor for every player. Anything that can open a
WebSocket can use the [protocol](docs/protocol.md) directly.

To ship a game that starts the relay itself, hidden, so players never see it, see
[Shipping the relay with your game](docs/shipping.md).

## Documentation

- [Getting started](docs/getting-started.md): the relay, the phones and your first app
- [The relay](docs/relay.md): command-line options, the dashboard and networking
- [Phones and certificates](docs/phones.md): HTTPS, removing the warning, iPhone and Android notes
- [Layouts](docs/layouts.md): choosing the phone's buttons, toggles, sliders and other controls
- [Gestures](docs/gestures.md): push, pull, flick, shake and twist, alone or with a button held
- [Calibration and precision](docs/calibration.md): Recentre, screen calibration, smoothing and
  designing for phone pointing
- Client libraries: [JavaScript](docs/clients/js.md), [Unity](docs/clients/unity.md),
  [Godot](docs/clients/godot.md), [Unreal](docs/clients/unreal.md)
- [Shipping the relay with your game](docs/shipping.md): starting the relay from Unity, Godot,
  Unreal or Node, and signing it for macOS
- [Protocol](docs/protocol.md): the messages, for writing your own client
- [Testing](docs/testing.md): simulated players, recording and replay, the conformance suite
- [Development](docs/development.md): building from source and releasing
- [Roadmap](docs/roadmap.md): what's planned, testing still to do, and known limitations
- [Changelog](CHANGELOG.md)

## Status

Phone Wand is new. The protocol is version 0 and may change before 1.0. It is tested with iPhone
(Safari and Chrome) and iPad against a Mac; Android and Windows testing is under way; the [roadmap](docs/roadmap.md) says what's
tested, what's planned and what's known to be missing. Please report problems in
[the issues](https://github.com/wildwinter/phone-wand/issues).

## Licence

MIT. See [LICENSE](LICENSE). Phone Wand is made by Ian Thomas at [storytools.se](https://storytools.se).
