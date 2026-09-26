# Roadmap

What's planned, and what's known to be missing. Real-device testing decides the order: a problem
found on phones matters more than any new feature. Suggestions and reports are welcome in
[the issues](https://github.com/wildwinter/phone-wand/issues).

## Testing still to do

- **Phones and browsers:** iPad, and Android phones with Chrome. (Safari and Chrome on iPhone are
  tested.)
- **Relay platforms:** the Windows relay and tray app, and the Linux relay, including starting the
  relay from a game on each.
- **Lag:** the goal is under 40 ms from phone to app on local Wi-Fi. It hasn't been measured on
  real networks yet, especially over the HTTP fallback.
- **Long sessions:** battery use and heat on phones.
- **Engines:** Unity WebGL builds, and Unreal on Windows.

## Planned features

- **Gestures.** The phone spots a flick (to throw) or a shake from its motion sensors, and apps get
  a `gesture` event with its strength and direction.
- **Custom button layouts.** An app tells phones which buttons to show, with labels and colours,
  instead of the fixed Primary and Secondary.
- **OSC output.** The relay also sends pointers, buttons and players as
  [Open Sound Control](https://opensoundcontrol.stanford.edu/) messages, so tools such as
  TouchDesigner, Max, Pure Data and lighting desks can use phones with no code.
- **Compass mode.** Optional headings from the phone's compass: no sideways drift, so no need to
  recentre, at the cost of wobble near metal and electronics.
- **Package registries.** The JavaScript client on npm, the Unity package on OpenUPM, and the Godot
  addon in the Asset Library. For now everything comes from GitHub Releases.
- **A faster transport.** A compact binary format, or UDP, between the relay and apps, if lag
  measurements show it's needed.

## Known limitations

- **Direction only.** Phones know which way they point, not where they are. Screen calibration
  assumes players stay roughly where they calibrated. See [Calibration](calibration.md).
- **Drift.** Gyroscopes drift slowly sideways; Recentre fixes it.
- **Precision.** Good for targets the size of a button or a character, not for fine selection.
- **Certificate warning.** Phones see a warning once unless the relay's certificate is installed or
  a real certificate is used. See [Phones and certificates](phones.md).
- **Same network.** Phones and the relay must be on one network that lets devices reach each
  other.
- **Relay size.** Each relay program is about 100 MB, because it carries its own JavaScript engine.
- **Unsigned on Windows.** SmartScreen asks users to confirm the first run.
- **Protocol version 0.** It may change before 1.0; the [changelog](../CHANGELOG.md) lists every
  change.
