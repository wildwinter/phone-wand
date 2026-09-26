# JavaScript and TypeScript client

For web pages and for Node 22+, Bun and Deno. No dependencies.

## Getting it

Pick one:

- **From the relay.** A page on the same computer can load
  `<script src="http://127.0.0.1:8480/phone-wand.js"></script>`, which defines a global `PhoneWand`.
- **From a release.** `phone-wand-js-<version>.zip` on the
  [releases page](https://github.com/wildwinter/phone-wand/releases) contains:
  - `phone-wand.mjs`: an ES module, for `import` in browsers, bundlers and Node,
  - `phone-wand.min.js`: the same for a plain `<script>` tag (global `PhoneWand`),
  - `phone-wand.d.ts`: TypeScript types,
  - `examples/`: a cursor page and a Node logger.

(An npm package will follow.)

## Quick start

```js
import { PhoneWand, toPixels } from "./phone-wand.mjs";

const wand = new PhoneWand();            // connects to ws://127.0.0.1:8480/app

wand.on("connected", (hello) => {
  console.log(`Phones join at ${hello.joinUrl}`);
  qrImage.src = hello.qrUrl;             // a PNG of the join QR code
});

wand.on("join", (player) => console.log(`${player.name} joined in slot ${player.slot}`));

wand.on("button", (e, player) => {
  if (e.button === "primary" && e.down) shootAt(player.pose?.screen);
});

function draw() {
  for (const player of wand.list) {      // players in slot order
    const pos = toPixels(player.pose?.screen ?? null, canvas.width, canvas.height);
    if (pos) drawCursor(pos, player.colour, player.state !== "active");
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
```

With the `<script>` build, use `new PhoneWand()` and `PhoneWand.toPixels(...)`.

## API

### `new PhoneWand(options?)`

| Option | Default | |
|---|---|---|
| `url` | `ws://127.0.0.1:8480/app` | The relay's app address. |
| `reconnect` | `true` | Reconnect when the relay goes away (backing off up to 5 seconds). |
| `smoothing` | relay default | `{ minCutoff, beta, dCutoff }`, or `false` for raw poses. |
| `autoConnect` | `true` | Connect straight away. Otherwise call `connect()`. |

### Properties

- `players`: a `Map` of player id to player.
- `list`: players sorted by slot.
- `connected`: whether the relay has said hello.
- `hello`: the relay's hello (`relay` version, `joinUrl`, `qrUrl`, `maxPlayers`), or `null`.

A **player** has `id`, `slot`, `name`, `colour` (`#rrggbb`), `label`, `state` (`waiting`, `active`
or `paused`), `calibration` (`none`, `ray` or `screen`), `device`, and:

- `pose`: the latest pose, or `null`,
- `buttons`: a `Set` of held buttons (`"primary"`, `"secondary"`),
- `stats`: the latest `{ rtt, rate, dropped }`, or `null`,
- `calibrating`: `"top-left"` or `"bottom-right"` while the player is calibrating, else `null`.

A **pose** has `seq`, `t` (relay time, ms since the epoch), `q` (orientation `[x, y, z, w]`), `yaw`,
`pitch`, `roll` (degrees), `dir` (`[right, up, forward]`) and `screen` (`[x, y]` from 0 to 1, or
`null`). See the [protocol](../protocol.md#frames-and-units) for the frames.

### Events

Subscribe with `on(event, listener)`, which returns a function that unsubscribes. `off` also works.

| Event | Arguments |
|---|---|
| `connected` | `hello` |
| `disconnected` | |
| `join` | `player` |
| `leave` | `player` |
| `player` | `player` (state, name, colour, label or calibration changed) |
| `pose` | `pose, player` |
| `button` | `{ id, button, down }, player` |
| `calibrating` | `step` (`top-left`, `bottom-right` or `cancelled`), `player` |
| `calibrated` | `calibration`, `player` |
| `stats` | `{ id, rtt, rate, dropped }, player` |

When the relay goes away, every player gets a `leave`, then `disconnected` fires. When it comes back,
`connected` and a `join` for each player fire again.

### Methods

| Method | |
|---|---|
| `connect()`, `close()` | Open or close the connection. |
| `configure({ smoothing })` | Change this app's smoothing, or pass `false` for raw. |
| `style(id, { colour, label })` | Change a player's colour (`#rrggbb`) and label, on the phone too. |
| `prompt(text, { id, duration })` | Show text on one phone, or all when `id` is omitted. `duration` in ms, `0` to keep it. |
| `haptic(pattern, { id })` | Vibrate (Android only). A number or an on/off pattern in ms. |
| `calibrate(mode, { id })` | Ask players to calibrate: `"screen"` or `"ray"`. |
| `handle(message)` | Feed a decoded relay message in directly, for tests and replays. |

### Helpers

- `toPixels(screen, width, height)`: a normalised screen position to pixels, or `null`.
- `toRightHanded(dir)` and `quatToRightHanded(q)`: rig frame to the right-handed, `-z` forward frame
  used by Three.js, Babylon.js (right-handed mode) and WebXR.

## Pages served over HTTPS

A page served from an `https://` address may not be allowed to connect to `ws://127.0.0.1`, because
browsers block "mixed content". Chrome and Firefox treat `127.0.0.1` and `localhost` as secure and
allow it; Safari may not. Either serve your page from `http://localhost`, or connect securely:

```js
const wand = new PhoneWand({ url: "wss://127.0.0.1:8443/app" });
```

That endpoint uses the relay's own certificate, so the browser must trust it: open
`https://127.0.0.1:8443/` once in that browser and accept the warning, or install the relay's
certificate (`~/.phone-wand/ca.crt.pem`) on the computer. A page from another site also needs the
relay started with `--allow-origin` (see [the relay](../relay.md#which-apps-may-connect)).

## Examples

- `examples/cursors.html`: coloured cursors and click rings on a full-window canvas.
- `examples/log.mjs`: logs joins, clicks and calibration in a terminal (`node examples/log.mjs`).
- The relay's dashboard (`packages/dashboard` in the repository) is a larger example.
