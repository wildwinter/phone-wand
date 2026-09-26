# Gestures

Besides pointing, players can move the phone to do things: flick it towards the screen to throw,
pull it back like a bowstring, shake it, or twist their wrist. Phone Wand spots these movements and
sends your app a `gesture` event.

Two kinds. **Movements** of the whole phone:

| Gesture | The movement |
|---|---|
| `push` | A quick movement towards the screen |
| `pull` | A quick movement back towards the player |
| `left`, `right` | A quick sideways movement |
| `up`, `down` | A quick movement up or down |
| `shake` | Several quick movements back and forth |

And **fast rotations**, the way a flick of the wrist whips the cursor across:

| Gesture | The rotation |
|---|---|
| `flick-up`, `flick-down`, `flick-left`, `flick-right` | The pointing direction turned quickly that way |
| `twist-left`, `twist-right` | A quick roll of the wrist (right is clockwise, seen from behind) |

A fast rotation also swings the phone around your wrist, which its motion sensor reads as movement.
Phone Wand knows that, so a flick gives a flick and not a push or a sideways movement as well: one
action, one gesture.

Directions follow the player's calibration: "push" is always towards the screen, however they
hold the phone.

## What each gesture tells you

| Field | Meaning |
|---|---|
| `gesture` | Which one, from the table above |
| `strength` | 0 to 1: how vigorous, relative to a strong flick (or shake, or twist) |
| `speed` | Movements: peak speed in m/s |
| `dir` | Movements: the exact direction, `[right, up, forward]`, for aiming a throw |
| `angle` | Flicks and twists: how far the phone turned, in degrees |
| `duration` | How long it took, in ms |
| `buttons` | Which buttons were held when it started |

`buttons` makes combinations easy. "Hold Primary and pull back" is a `pull` whose `buttons`
include `primary`:

```js
wand.on("gesture", (g, player) => {
  if (g.gesture === "pull" && g.buttons.includes("primary")) drawBow(player, g.strength);
  if (g.gesture === "push") throwAt(player.pose?.screen, g.strength);
  if (g.gesture === "shake") shuffle(player);
});
```

Each client library has the same event; see its page.

## What works, and what doesn't

A phone measures how fast it's speeding up or slowing down, not where it is. So Phone Wand finds
**deliberate, quick movements**. It can't tell you how far the phone moved, and it ignores slow
movements, so walking about or gently repositioning doesn't trigger anything.

Turning the phone at an ordinary pace moves the cursor; it isn't a gesture. Turning it fast is a
flick. If your players aim fast and you don't want flicks, raise `flickRate` (or ignore the flick
events).

## Sensitivity

Each app chooses its own:

```js
wand.configure({ gestures: { threshold: 9 } }); // needs a firmer flick (default 7)
wand.configure({ gestures: false });            // no gesture events at all
```

| Setting | Default | Meaning |
|---|---|---|
| `threshold` | 7 | Acceleration in m/s² that starts a movement. Lower is more sensitive. |
| `minSpeed` | 0.35 | Peak speed in m/s a movement must reach. |
| `flickRate` | 250 | Turning speed in degrees per second that makes a flick. |
| `twistRate` | 360 | Rolling speed in degrees per second that makes a twist. |

The dashboard's **Gestures** section has a sensitivity slider, and shows every gesture on the test
screen as it happens: an arrow for movements, its name, and any held buttons. Try it with a phone
in your hand to find a setting that suits your game.

## Raw motion

If you'd rather recognise movements yourself, every pose carries `accel`: the phone's acceleration
in m/s², gravity removed, as `[right, up, forward]` in the same frame as `dir`.

## Phones

Gestures need motion data, which iPhones ask permission for together with orientation when the
player taps **Tap to start**. If a player refuses it, pointing still works but gestures don't.
