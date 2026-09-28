# Changelog

All notable changes to Phone Wand are listed here. The relay, the phone page and every client
library share one version number. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may change
the protocol.

## [Unreleased]

### Added

- Silent compass drift correction. Phone gyroscopes drift slowly sideways; where a phone has a
  compass that seems trustworthy (calibrated, steady, and the phone not pointing steeply up or
  down), the phone page uses it as a slow reference and turns the heading back, never faster than
  0.3 degrees a second. Otherwise it's ignored: nobody is asked to wave their phone. Nothing changes
  for apps; the dashboard shows each player's compass state and correction, and `stats` messages
  carry it.

### Fixed

- On a computer connected to both a wired network and Wi-Fi, the QR code could carry the wired
  address, which phones on the Wi-Fi can't reach: scanning it gave a blank page that never loaded.
  The relay now prefers the Wi-Fi address.

## [0.8.0] - 2026-09-27

### Added

- Two layout templates for dividing the phone your own way:
  - **rows**: say how many controls go in each row, such as `rows: [1, 3]` for one wide control in
    the front half and three behind, with optional relative `heights`.
  - **columns**: the same side by side, with optional `widths`.

  Up to 4 rows or columns of up to 4 controls, 8 in all, and any control in any position. A crawl
  pad fits a half-height row well. Every client library has builders for them, and the dashboard's
  layout menu has samples.
- Two controls: **pad**, a big round button like the default Primary, whose presses arrive as
  button events; and **space**, an empty cell (it needs no id) to leave a gap.

### Changed

- The phone draws every layout as rows or columns. The fixed templates (`primary`,
  `primary-secondary`, `pair`, `primary-row`, `grid`) are now presets: shortcuts for particular
  rows, documented as such, and they work as before. The one visible change: in
  `primary-secondary` (the default) the smaller control is half the width instead of 62%.

### Fixed

- A slider's knob hung half off the end of its track at 0 and 1. Now the knob is a rounded bar
  across the track, like a fader cap, and stays inside it, always in the rounded end of the fill,
  so both ends look alike.

## [0.7.0] - 2026-09-27

### Added

- Two navigation controls for layouts, which fit in any block of any template:
  - **dpad**: four arrows. The thumb can slide from one to the next without lifting.
  - **crawl**: dungeon-crawler keys: turn left, forward, turn right, step left, back, step right.

  Each direction is an ordinary button named `<id>.<direction>` (`move.up`, `walk.turn-left`), so
  button events, held buttons and gestures work with them unchanged. Either can be the big control
  of a `primary` template. Every client library has builders for them and names for the
  directions, and the dashboard's layout menu has samples to try on phones.

## [0.6.1] - 2026-09-27

### Fixed

- Gestures rebuilt and tested against a real, labelled session recorded on an iPhone, now part of
  the relay's tests: five each of every movement and flick, eleven twists and 30 seconds of aiming
  all come out right, with nothing while aiming.
  - 0.6.0 hardly ever reported push, pull, left, right, up or down: it threw away any movement made
    while the wrist turned faster than 150 degrees per second, which most real movements do, and
    ignored movements that took longer than 600 ms (real ones take up to about 1.2 s). Now a
    movement is dropped only if a flick or twist actually happened at the same time.
  - Movements with the wrist turning briefly fast along the way no longer come out as flicks, and
    moving between calibration corners no longer gives stray flicks: a flick or twist must now turn
    at least 50 degrees (60 for a twist), fast on average, not just in a brief spike.
  - A flick down needs to turn only 40 degrees: a wrist bends down less far than it turns other
    ways, and flicks down were read as plain `down` movements.
  - No gestures until the player has aimed (Recentre or screen calibration): moving between the
    calibration corners gave stray gestures.
  - Bringing the phone back after a flick or twist no longer counts as a flick or twist the other way.
  - Turning speeds are worked out from the phone's own timestamps, not from when poses reach the
    relay, which often arrive in bunches and made turning look far faster than it was.
- After the relay restarted, the phone kept its "ready" screen while the relay (and the game)
  wanted the player to aim first. The phone now shows the aiming step whenever the relay says the
  player hasn't aimed yet.

## [0.6.0] - 2026-09-26

### Added

- **Flicks**: `flick-up`, `flick-down`, `flick-left` and `flick-right`, for turning the phone fast,
  found from its orientation. Gestures carry `angle` (degrees turned) for flicks and twists, and
  apps can set `flickRate`.

### Fixed

- Fast rotations no longer also produce push, pull or sideways gestures: turning the phone swings it
  around the wrist, which its motion sensor reads as movement, so movement gestures are ignored
  while the phone turns fast.
- A flick upward could also give a twist; twists now need the roll to clearly dominate.
- A sideways flick that started gently and stopped hard could read the wrong way round; movements
  now include their gentle start.

## [0.5.1] - 2026-09-26

### Fixed

- On iPhone (Safari and Chrome), every movement gesture came out backwards (push as pull, left as
  right, up as down), because iPhones report motion with every axis flipped compared with the
  standard. The phone page now checks the direction of gravity against its orientation and
  corrects the motion data whichever convention the browser uses. Twists were unaffected.

## [0.5.0] - 2026-09-26

### Added

- **Gestures**: push, pull, left, right, up, down, shake, twist-left and twist-right, detected by
  the relay from the phone's motion, in the calibrated frame, with strength, speed, direction and
  the buttons held when they started ("hold Primary and pull"). Each app sets its own sensitivity
  with `configure`. See `docs/gestures.md`.
- Poses carry `accel`, the phone's acceleration without gravity, for apps that recognise their own
  movements.
- The dashboard shows gestures on the test screen, with a sensitivity slider.

### Tested

- The 0.4.0 layouts, settings and Recentre placement on a real phone, right- and left-handed.

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
