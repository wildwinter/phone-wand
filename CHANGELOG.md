# Changelog

All notable changes to Phone Wand are listed here. The relay, the phone page and every client
library share one version number. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may change
the protocol.

## [Unreleased]

### Added

- The relay: a single program for macOS, Windows and Linux that serves the phone page over HTTPS
  with its own local certificate authority, assigns player slots, keeps a slot for 60 seconds while a
  phone reconnects, and passes everything to apps over a localhost WebSocket.
- The phone page: tap to start, motion permission on iPhone, `RelativeOrientationSensor` where
  available and device orientation events otherwise, Primary and Secondary buttons, Recentre, two-corner
  screen calibration, prompts, vibration on Android, and a screen wake lock.
- A welcome page, opened by the QR code over plain HTTP, that explains the certificate warning
  before the phone shows it and says which buttons to tap on that browser. Phones that already
  trust the relay skip it.
- While a player does screen calibration, their cursor is hidden (poses have no screen position),
  and the phone says clearly to aim at the physical corners.
- An HTTP fallback (POST up, Server-Sent Events down) for browsers that refuse a secure WebSocket to
  a self-signed server.
- Calibration and cursor maths in the relay: Recentre sets forward, two-corner calibration maps a flat
  screen, and a One Euro filter smooths each app's poses with its own settings.
- The dashboard: QR code, players with rate and round-trip time, calibration and prompt controls,
  smoothing sliders, and a full-screen test screen with live cursors.
- Protocol version 0, documented in `docs/protocol.md`, with a conformance suite of recorded
  sessions that every client library replays.
- Client libraries for JavaScript, Unity, Godot (GDScript) and Unreal, each with a cursor sample.
- A secure app endpoint, `wss://127.0.0.1:8443/app`, for web builds served over HTTPS. It only
  answers connections from the relay's own computer.
- Web pages from other sites can't connect to the relay's app port unless allowed with
  `--allow-origin`.
- Testing tools in the relay: `--simulate` for fake players, `--record` and `--replay`.
