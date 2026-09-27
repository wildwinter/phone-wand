# Layouts: choosing the phone's controls

By default every phone shows a big **Primary** button and a smaller **Secondary** one. Your app can
change that, for everyone or for each player separately: pick a template, and list the controls
to put in it. The phone places them for the player's thumb.

## Why templates

People hold the phone like a torch or a TV remote, screen up, pointing the top edge at the screen,
with the thumb resting around the middle of the screen, much as on a Wii Remote. So the templates
put the most important control (the big **primary**) where the thumb rests and smaller controls
where it can reach them easily, and they mirror for left-handed players. You choose what goes on
the phone; Phone Wand takes care of where.

| Template | Controls | What it looks like |
|---|---|---|
| `primary` | 1 | One big button. |
| `primary-secondary` | 2 | A big button where the thumb rests, and a smaller control below it, towards the palm. The default. |
| `pair` | 2 | Two equal controls side by side. |
| `primary-row` | 1 to 4 | A big button, with up to three smaller controls in a row below. |
| `grid` | 1 to 6 | Two columns. |

In the `primary` templates, the first control is the big one: a button, a d-pad or a crawl pad.

## Controls

| Type | What the player does | What your app gets |
|---|---|---|
| **button** | Presses and releases | `button` events with your id, `down` and up |
| **toggle** | Taps to switch on or off | `control` events with `true` or `false` |
| **slider** | Drags along a track, horizontal or vertical. Optionally springs back when let go (a throttle). | `control` events with 0 to 1, about 30 times a second while dragging |
| **choice** | Taps one of 2 to 4 options | `control` events with the option's index |
| **label** | Nothing: it shows text, such as a score or a role | Your app sets the text |
| **dpad** | Four arrows. The thumb can slide from one to the next without lifting, like a real d-pad; one direction at a time. | `button` events for `<id>.up`, `<id>.down`, `<id>.left` and `<id>.right` |
| **crawl** | Dungeon-crawler movement: turn left, forward and turn right on top, step left, back and step right below | `button` events for `<id>.forward`, `<id>.back`, `<id>.step-left`, `<id>.step-right`, `<id>.turn-left` and `<id>.turn-right` |

Every control has an `id` (your name for it, 1 to 32 letters, digits, `_`, `.` or `-`), and
optionally a `label` and a `colour` (`#rrggbb`; the player's own colour when left out).

A d-pad or crawl pad is sized to fit whatever block it's in, so it works in any template. It's
easiest to use as the big control of a `primary` template, or in `pair`; in the smaller blocks of
`primary-row` and `grid` its keys get small. Their directions are ordinary buttons, so everything
that works with buttons works with them: held buttons in gestures, and each client library's
button events and "is it held" checks. Every client library has names for the directions, so you
don't have to type them.

Your app can set any value too: turn a toggle on, move a slider, pick an option, or change a
label's text. The relay remembers each player's layout and values, so a phone that reconnects
(after sleeping, say) comes back exactly as it was.

## Example

In JavaScript (each client library has the same two calls; see its page):

```js
// A shooter: a big Shoot button, then Reload, a Zoom toggle and an ammo count below.
wand.layout({
  template: "primary-row",
  controls: [
    { id: "shoot", type: "button", label: "Shoot" },
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

A dungeon crawler: the crawl pad as the big control, and a Use button below.

```js
wand.layout({
  template: "primary-secondary",
  controls: [
    { id: "walk", type: "crawl" },
    { id: "use", type: "button", label: "Use" },
  ],
});

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
you can try the templates and controls on real phones before writing any code. Control changes
and button presses (such as `move.up`) show briefly at the top of the test screen.
