# Layouts: choosing the phone's controls

By default every phone shows a big **Primary** button and a smaller **Secondary** one. Your app can
change that, for everyone or for each player separately: say how to divide the phone into rows (or
columns), and list the controls to put in them. The phone sizes and places them.

## Rows and columns

People hold the phone like a torch or a TV remote, screen up, pointing the top edge at the screen,
with the thumb resting around the middle of the screen, much as on a Wii Remote. So a layout is a
stack of rows from the pointing end down towards the palm, and the controls in each row share it
evenly. They mirror for left-handed players.

`rows` lists how many controls go in each row, from the top of the phone (the end that points at
the screen) to the bottom: 1 to 4 rows of 1 to 4 controls, adding up to the number of controls.
Controls fill the rows in order. `heights` optionally gives the rows' relative heights; they're
equal when left out.

```js
wand.layout({
  template: "rows",
  rows: [1, 3],          // one wide control in front, three behind
  heights: [3, 2],       // optional
  controls: [
    { id: "walk", type: "crawl" },
    { id: "attack", type: "button", label: "Attack" },
    { id: "use", type: "button", label: "Use" },
    { id: "map", type: "toggle", label: "Map" },
  ],
});
```

| Layout | What it looks like |
|---|---|
| `rows: [1, 2]` | One wide control in the front half, two in the back half. |
| `rows: [1, 3]` | One wide control in front, three behind. |
| `rows: [2, 1]`, `rows: [3, 1]` | The same, the other way round. |
| `rows: [1, 1, 3], heights: [1, 4, 2]` | A thin strip (a status label, say), a big middle control, and three below. |

`columns` is the same, side by side: `columns` counts the controls in each column from left to
right, and `widths` sizes them. `columns: [1, 3], widths: [1, 2]` puts a tall, narrow control (a
vertical slider) beside three stacked ones.

Use a **pad** for the one control the thumb rests on, and a **space** to leave a gap: `rows: [1, 2]`
with a pad, then a space and a button, puts the smaller button towards the palm, out of the thumb's
way. For left-handed players the controls in each row, and the columns, swap sides, gaps included.

## Presets

Five layouts have names of their own, as shortcuts. Each is one of the arrangements above.

| Template | Controls | The same as |
|---|---|---|
| `primary` | 1 | `rows: [1]`, the control a pad. |
| `primary-secondary` | 1 or 2 | `rows: [1, 2], heights: [3, 1]`: a pad, then a space and the second control towards the palm. The default. |
| `primary-row` | 1 to 4 | `rows: [1, 3], heights: [3, 1]`: a pad over up to three controls. |
| `pair` | 1 or 2 | `rows: [2]`. |
| `grid` | 1 to 6 | Rows of two, with a space to even out the last. |

In the `primary` presets the first control is the big one. It must be a button (drawn as a pad), a
pad, a d-pad or a crawl pad.

## Controls

| Type | What the player does | What your app gets |
|---|---|---|
| **button** | Presses and releases | `button` events with your id, `down` and up |
| **pad** | The same, on a big round pad: the control the thumb rests on | `button` events, as for a button |
| **toggle** | Taps to switch on or off | `control` events with `true` or `false` |
| **slider** | Drags along a track, horizontal or vertical. Optionally springs back when let go (a throttle). | `control` events with 0 to 1, about 30 times a second while dragging |
| **choice** | Taps one of 2 to 4 options | `control` events with the option's index |
| **label** | Nothing: it shows text, such as a score or a role | Your app sets the text |
| **dpad** | Four arrows. The thumb can slide from one to the next without lifting, like a real d-pad; one direction at a time. | `button` events for `<id>.up`, `<id>.down`, `<id>.left` and `<id>.right` |
| **crawl** | Dungeon-crawler movement: turn left, forward and turn right on top, step left, back and step right below | `button` events for `<id>.forward`, `<id>.back`, `<id>.step-left`, `<id>.step-right`, `<id>.turn-left` and `<id>.turn-right` |
| **space** | Nothing: an empty cell, to leave a gap | Nothing |

Every control but a space has an `id` (your name for it, 1 to 32 letters, digits, `_`, `.` or `-`),
and optionally a `label` and a `colour` (`#rrggbb`; the player's own colour when left out).

A d-pad or crawl pad is sized to fit whatever block it's in, so it works in any layout. A crawl pad
is wider than it is tall, so a half-height row suits it well; in small blocks the keys get small. Their directions are ordinary buttons, so everything
that works with buttons works with them: held buttons in gestures, and each client library's
button events and "is it held" checks. Every client library has names for the directions, so you
don't have to type them.

Your app can set any value too: turn a toggle on, move a slider, pick an option, or change a
label's text. The relay remembers each player's layout and values, so a phone that reconnects
(after sleeping, say) comes back exactly as it was.

## Example

In JavaScript (each client library has the same two calls; see its page):

```js
// A shooter: a big Shoot pad, then Reload, a Zoom toggle and an ammo count below.
wand.layout({
  template: "rows",
  rows: [1, 3],
  heights: [3, 1],
  controls: [
    { id: "shoot", type: "pad", label: "Shoot" },
    { id: "reload", type: "button", label: "Reload" },
    { id: "zoom", type: "toggle", label: "Zoom" },
    { id: "ammo", type: "label", label: "Ammo", text: "12" },
  ],
});

wand.on("button", (e, player) => {
  if (e.button === "shoot" && e.down) shoot(player);
  if (e.button === "reload" && e.down) reload(player);
});
wand.on("control", (e, player) => {
  if (e.control === "zoom") setZoom(player, e.value);
});

// Later, for one player:
wand.set("ammo", "11", { id: player.id });
```

The dungeon crawler from the top of the page gets its crawl pad's directions as buttons:

```js
wand.on("button", (e, player) => {
  if (!e.down) return;
  if (e.button === "walk.forward") stepForward(player);
  if (e.button === "walk.turn-left") turnLeft(player);
  // ...and walk.back, walk.step-left, walk.step-right, walk.turn-right
});
```

Send a layout to one player with `{ id }`, or to everyone without it. `wand.layout(null)` goes back
to the default.

Different players can have different layouts, for example different roles in a co-op game.

## Mistakes

If a layout or value doesn't fit (an unknown template, too many controls, a toggle set to a
number), the relay changes nothing and sends your app an `error` message saying why. The client
libraries print it, or pass it to your error handler.

## On the phone

Whatever layout your app chooses, the top bar keeps two buttons of Phone Wand's own: **Recentre**,
in the corner nearest the thumb, and a small settings button in the other corner. **Settings** has
which hand the player holds the phone in (this mirrors the layout, and swaps the two top corners),
**Calibrate screen**, and their name.

## Trying layouts

The dashboard's **Layout on every phone** menu sends sample layouts to every connected phone, so
you can try layouts and controls on real phones before writing any code. Control changes
and button presses (such as `move.up`) show briefly at the top of the test screen.
