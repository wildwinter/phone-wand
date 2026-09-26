# The relay

The relay is one program that runs on the computer driving the display. It:

- serves the phone page over HTTPS (phones only give orientation to secure pages),
- accepts phone connections, over WebSocket or an HTTP fallback, and assigns player slots,
- turns each phone's orientation into a calibrated direction and a screen position,
- sends everything to apps on this computer over a plain WebSocket at `ws://127.0.0.1:8480/app`,
- serves a dashboard at `http://127.0.0.1:8480/`.

Several apps can connect at once, for example your game plus the dashboard.

## Options

Run `phone-wand --help` for this list.

| Option | Default | Meaning |
|---|---|---|
| `--port <n>` | 8443 | HTTPS port phones connect to. |
| `--host <name>` | this machine's LAN address | The address or name put in the QR code. Use it when the relay picks the wrong network, or with a real certificate for a name. |
| `--max-players <n>` | 4 | Player slots. |
| `--key <text>` | a saved random key | Join key carried in the QR code. Phones without it are turned away. |
| `--no-key` | | Let any phone on the network join without the QR code. |
| `--landing-port <n>` | 8080 | Port for the welcome page the QR code opens (see below). |
| `--no-landing` | | Point the QR code straight at the secure page. This is the default with `--tls-cert`. |
| `--http-port <n>` | off | Also serve phones over plain HTTP on this port (see [Phones](phones.md#android-over-usb)). |
| `--tls-cert <file>` | | Use this PEM certificate instead of the relay's own. |
| `--tls-key <file>` | | The private key for `--tls-cert`. |
| `--app-port <n>` | 8480 | Port for apps and the dashboard. |
| `--app-host <addr>` | 127.0.0.1 | Address apps connect on. `0.0.0.0` lets apps on other computers connect. |
| `--allow-origin <url>` | | Let web pages from this origin connect as apps, for example `https://mygame.example.com`. Repeat it for more, or use `*` for any. |
| `--simulate <n>` | | Add simulated players. |
| `--record <file>` | | Record every phone message to a `.jsonl` file. |
| `--replay <file>` | | Replay a recording as virtual phones. |
| `--loop` | | Repeat the replay forever. |
| `--data-dir <dir>` | `~/.phone-wand` | Where certificates and settings are kept. |
| `--no-open` | | Don't open the dashboard in a browser. |
| `--quiet` | | Print only errors. |
| `-v`, `--version` | | Print the version. |

## The dashboard

`http://127.0.0.1:8480/` shows:

- the QR code and join address,
- each player with their state, platform, connection type, update rate, round-trip time and dropped
  samples,
- buttons to start calibration, buzz a phone or send it a message,
- smoothing sliders (these apply to the dashboard's own cursors; each app sets its own),
- a test screen with live cursors, click ripples and calibration corner markers. Press **F** or
  **Full screen** to fill the display, then calibrate phones against it.

## Endpoints on the app port

| Address | What |
|---|---|
| `ws://127.0.0.1:8480/app` | The app WebSocket. See the [protocol](protocol.md). |
| `http://127.0.0.1:8480/` | The dashboard. |
| `http://127.0.0.1:8480/qr.png?size=512` | The join QR code as a PNG, for showing in your app. |
| `http://127.0.0.1:8480/qr.svg` | The same as SVG. |
| `http://127.0.0.1:8480/status.json` | Current players and settings. |
| `http://127.0.0.1:8480/phone-wand.js` | The JavaScript client, for a `<script>` tag. |
| `wss://127.0.0.1:8443/app` | The app WebSocket over TLS, on the phone port, for web pages served over HTTPS. Only answers connections from this computer. |

## Which apps may connect

Native apps (Unity, Unreal and Godot desktop builds, Node) can always connect. Web pages can connect
only when they come from this computer (`localhost`, `127.0.0.1`, or a local file), so a website
open in a browser can't read your players or send them messages. To let a page served from somewhere
else connect, for example a web build hosted online, start the relay with
`--allow-origin https://that.site`. The relay prints a line whenever it refuses a page.

## The welcome page

Phones warn about the relay's own certificate the first time they open the secure page, and the
warning looks alarming. So the QR code opens a plain-HTTP welcome page first (port 8080), which has
no warning. It checks whether the phone already trusts the relay: if so, it goes straight on;
otherwise it explains that a warning is coming, why it's safe, and exactly which buttons to tap on
that phone's browser, with a **Continue** button.

If port 8080 is taken, the relay says so and the QR code points straight at the secure page. Pick
another port with `--landing-port`, or turn the page off with `--no-landing`.

## Join keys

The QR code carries a short key, so people on the same network who haven't scanned the code can't
take a slot. The key is saved in the data folder and stays the same between runs, so phones can
reconnect after a restart and a printed QR code keeps working. Choose your own with `--key`, or turn
the check off with `--no-key`.

## Players, slots and reconnecting

Players get the lowest free slot, numbered from 1 on the phone and from 0 in the protocol. Each slot
has a colour.

If a phone loses its connection (it slept, the browser was switched away, the Wi-Fi dropped), its
player shows as **paused** and keeps its slot, colour and calibration for 60 seconds. When the phone
comes back it carries on as the same player. After 60 seconds the player leaves and the slot is free.

A player also shows as paused if its phone stops sending orientation for half a second, for example
when the player switches to another app. Apps should treat paused players' cursors as frozen.

## Networking

- Phones and the relay must be on the same local network, and the network must let devices talk to
  each other. Some guest and event networks isolate clients; a dedicated Wi-Fi router for the rig is
  the easy fix, and gives the lowest lag.
- If the computer has several network connections, the relay picks the most likely one and lists the
  others. Use `--host` to choose.
- On Windows, allow the relay through the firewall on private networks. If the network is marked as
  public, either change it to private in Windows settings or allow the relay on public networks.
- On macOS, the relay may ask to accept incoming connections the first time. Allow it.
- Lag: the dashboard shows each phone's round-trip time. On a busy network it may spike; a
  dedicated router helps.
