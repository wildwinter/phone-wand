# Changelog

All notable changes to Phone Wand are listed here. The relay, the phone page and every client
library share one version number. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may change
the protocol.

## [Unreleased]

## [0.4.0] - 2026-09-26

### Added

- **Layouts**: apps choose the controls each phone shows, from five templates (`primary`,
  `primary-secondary`, `pair`, `primary-row`, `grid`) placed for the player's thumb, with buttons,
  toggles, sliders, choices and labels. New `layout` and `set` messages for apps, a `control` event
  for value changes, and an `error` message when the relay can't use something an app sent. The
  relay remembers each player's layout and values through reconnects. See `docs/layouts.md`.
- A settings button on the phone, in the top corner away from the thumb: which hand the player
  uses (the layout mirrors for the left hand), Calibrate screen, and their name.
- The dashboard can send sample layouts to every phone, and shows control changes.

### Changed

- **Unity: breaking.** `PhoneButton` is no longer an enum but a class of string constants, because
  button ids now come from the layout. `e.Button == PhoneButton.Primary` and
  `player.IsHeld(PhoneButton.Primary)` still work; variables typed as `PhoneButton` become `string`.
- Recentre moved into the phone's top bar, in the corner nearest the thumb, and Calibrate screen into
  settings, so the game's controls get the rest of the screen. Button names can be any id from the layout, not just `primary` and
  `secondary` (which remain the default).

## [0.3.1] - 2026-09-26

### Added

- `docs/roadmap.md`: planned features, testing still to do, and known limitations.
- `scripts/check-unity.sh --managed-relay` checks Start Relay from start to stop.

### Tested

- Safari on iPhone works, including the welcome page, calibration and the Mac app. It connects over
  WebSocket even with the relay's own certificate (the HTTP fallback wasn't needed), at 60 updates
  a second with a 9 to 17 ms round trip on home Wi-Fi.
- iPad works too.

## [0.3.0] - 2026-09-26

### Added

- Games can start the relay themselves, hidden, and stop it when they stop: a **Start Relay**
  option in the Unity, Godot and Unreal clients, and `startRelay()` for Node. A relay that's
  already running is used instead. See `docs/shipping.md`.
- `phone-wand-relay-<version>-embed.zip`: the relay for every platform, laid out for games to
  ship, with one universal macOS binary, signed and notarized.
- Relay options `--lifeline` (stop when standard input closes) and `--log <file>`.

### Fixed

- The Unreal demo project failed to launch once packaged ("cannot be opened because of a problem",
  a missing `libtbb`): it found the plugin through a folder that also contained the project, which
  confuses Unreal's packaging. The plugin now lives in `Plugins/PhoneWand`, beside the demo, in
  both the repository and the release zip, and the demo packages as it is.

## [0.2.0] - 2026-09-26

### Changed

- **Phone Wand.app** is now a proper Mac app: it shows in the Dock while the relay runs, has Open
  Dashboard and Show Log in its menus, reopens the dashboard when its Dock icon is clicked, and
  stops the relay when it quits. Stopping the relay from the dashboard quits the app.
- **Phone Wand.exe** for Windows: a notification-area (tray) app beside the relay, with the same
  behaviour. The relay program in the Windows zip is now called `phone-wand-relay.exe`, and runs
  without a console window when started by the tray app.
- New players have no cursor until they have aimed once (poses have no `screen` until the player's
  calibration is no longer `none`). Straight after Tap to start, the phone asks them to set up their
  aim, and the dashboard and samples show "Player 2: set up your aim on your phone" meanwhile.
- The macOS disk image no longer has a separate command-line relay beside the app. The relay inside
  the app still runs from Terminal, with options.

## [0.1.3] - 2026-09-26

### Added

- **Phone Wand.app** for macOS, in the disk image next to the command-line relay. Double-click it and
  the relay runs in the background with the dashboard as its window. Output goes to
  `~/Library/Logs/Phone Wand/relay.log`, and startup errors appear in a dialog.
- A **Stop relay** button on the dashboard.

### Fixed

- macOS still refused to open the relay from the 0.1.2 disk image ("Apple could not verify ... is
  free of malware"): Finder won't open a command-line program downloaded from the internet, however
  it is signed. The notarized Mac app is what to double-click now.

## [0.1.2] - 2026-09-26

### Fixed

- macOS could refuse to open the downloaded relay, warning that it may harm the Mac. The macOS relay
  now comes as a disk image (`.dmg`) with Apple's notarization stapled to it, so it opens without a
  warning, even offline.

## [0.1.1] - 2026-09-26

### Changed

- The supported engine versions are stated as Unity 6.4 (6000.4), Godot 4.7 and Unreal 5.7, the
  versions the clients are built and tested with. The Unity package now declares 6000.4 rather than
  2021.3, and the docs no longer suggest older versions.

## [0.1.0] - 2026-09-26

The first release.

### Relay

- A single program for macOS, Windows and Linux, with nothing else to install. It serves the phone
  page over HTTPS using its own local certificate authority, assigns player slots, keeps a slot for
  60 seconds while a phone reconnects, and passes everything to apps over a localhost WebSocket.
- A welcome page, opened by the QR code over plain HTTP, that explains the certificate warning
  before the phone shows it and says which buttons to tap on that browser. Phones that already
  trust the relay go straight past it.
- Calibration and cursor maths: Recentre sets forward, two-corner calibration maps a flat screen,
  and a One Euro filter smooths each app's poses with its own settings.
- A dashboard with the QR code, each player's rate and round-trip time, calibration and prompt
  controls, smoothing sliders, and a full-screen test screen with live cursors.
- Join keys in the QR code, so only people who scanned it can take a slot.
- Starting a relay while another is running on the same computer stops the old one and takes over.
- Web pages from other sites can't connect to the app port unless allowed with `--allow-origin`.
- A secure app endpoint, `wss://127.0.0.1:8443/app`, for web builds served over HTTPS. It only
  answers connections from the relay's own computer.
- Testing tools: `--simulate` for fake players, `--record` and `--replay`.

### Phone page

- Tap to start, motion permission on iPhone, `RelativeOrientationSensor` where available and device
  orientation events otherwise.
- Primary and Secondary buttons, Recentre, and two-corner screen calibration. The cursor is hidden
  while a player calibrates, so they aim at the real corners.
- Prompts from apps, vibration on Android, and a screen wake lock.
- An HTTP fallback (POST up, Server-Sent Events down) for browsers that refuse a secure WebSocket
  to a self-signed server.

### Protocol and clients

- Protocol version 0, documented in `docs/protocol.md`, with a conformance suite of recorded
  sessions that every client library replays.
- Client libraries for JavaScript, Unity, Godot (GDScript) and Unreal, each with a cursor sample.

### Known limitations

- Tested so far with an iPhone (Chrome) against a Mac. Safari, Android phones, Windows and Linux
  relays, Unity WebGL builds and Unreal on Windows have not been tested yet.
- Gestures (flick and shake), custom button layouts and OSC output are planned but not yet built.
