# Phone Wand

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

1. Download the relay for your computer from the
   [latest release](https://github.com/wildwinter/phone-wand/releases/latest) and unzip it.
2. Run `phone-wand` (on macOS and Linux, `./phone-wand` in a terminal; on Windows, double-click
   `phone-wand.exe`). It prints a QR code and opens the dashboard in your browser.
3. Scan the QR code with a phone on the same Wi-Fi. A welcome page explains the certificate warning
   that follows and which buttons to tap (see [Phones and certificates](docs/phones.md) to get rid
   of it for good). Then tap **Tap to start**.
4. Point the top of the phone at the middle of the screen and press **Recentre**. Your cursor
   appears on the dashboard's test screen.
5. For accurate cursors, press **F** on the dashboard for full screen, then press **Calibrate
   screen** on the phone and point at the top-left and bottom-right corners.

No phone to hand? Run `phone-wand --simulate 3` for three simulated players.

## Documentation

- [Getting started](docs/getting-started.md): the relay, the phones and your first app
- [The relay](docs/relay.md): command-line options, the dashboard and networking
- [Phones and certificates](docs/phones.md): HTTPS, removing the warning, iPhone and Android notes
- [Calibration and precision](docs/calibration.md): Recentre, screen calibration, smoothing and
  designing for phone pointing
- Client libraries: [JavaScript](docs/clients/js.md), [Unity](docs/clients/unity.md),
  [Godot](docs/clients/godot.md), [Unreal](docs/clients/unreal.md)
- [Protocol](docs/protocol.md): the messages, for writing your own client
- [Testing](docs/testing.md): simulated players, recording and replay, the conformance suite
- [Development](docs/development.md): building from source and releasing
- [Changelog](CHANGELOG.md)

## Status

Phone Wand is new. The protocol is version 0 and may change before 1.0. Testing on real phones
(iPhone, iPad and Android) and on Windows is under way. Please report problems in
[the issues](https://github.com/wildwinter/phone-wand/issues).

## Licence

MIT. See [LICENSE](LICENSE). Phone Wand is made by Ian Thomas at [storytools.se](https://storytools.se).
