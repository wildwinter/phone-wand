# Calibration and precision

A phone knows which way it's pointing, but not where it is or where the screen is. Calibration
tells the relay what "straight ahead" means, and optionally where the screen's edges are.

## What apps receive

For every orientation sample, each app gets:

- **a ray**: `yaw` (degrees, positive to the right), `pitch` (positive up) and `roll`, plus a unit
  direction vector and a full orientation quaternion. Everything is relative to the player's
  "forward".
- **a screen position**: `[x, y]` with `[0, 0]` at the top-left of the screen and `[1, 1]` at the
  bottom-right. Values outside 0 to 1 mean the player is pointing off the screen.

Use the screen position for a single flat screen. Use the ray for surround rigs, projection domes,
or anything where your app decides what the player is pointing at (intersect the ray with your
screens or scene from where the player stands).

## Before calibration

A player who has just joined has no cursor: their poses have no screen position until they have
aimed once, because until then the relay doesn't know where the screen is. Straight after **Tap to
start**, the phone asks them to **Set up your aim**, with **Calibrate screen** as the main choice and
a quicker "point at the middle of the screen and tap" (a Recentre) as the other. Apps should show
something like "Player 2: set up your aim on your phone" meanwhile; the dashboard and the samples do.

After a Recentre alone, the screen position assumes a screen 40 degrees wide and 22.5 degrees high
(16:9) centred on forward. That's roughly a large TV from a sofa, so it's usable straight away.

## Recentre

Pressing **Recentre** (the button in the phone's top bar) makes the direction the phone points right now the new forward, including its
up or down tilt. Point at the middle of the screen (or, for a surround rig, the middle of the centre
screen) and press it.

Use Recentre whenever the cursor has drifted: phone gyroscopes drift slowly sideways over the
course of minutes. Apps can ask players to recentre with the `calibrate` message in `ray` mode,
which shows a prompt on the phone.

## Screen calibration

For a single monitor or projection, the two-corner calibration makes the cursor land where the
player points:

1. Show your app (or the dashboard's test screen) full screen.
2. On the phone, open **Settings** and press **Calibrate screen** (or have your app send
   `calibrate` in `screen` mode).
3. Point at the top-left corner and tap anywhere on the phone. Then the bottom-right corner, and tap.

While the player calibrates, the relay stops sending their screen position, so apps hide their
cursor: players aim at the physical corners, not at a cursor. The ray is still sent.

The relay works out the screen's size and position from those two directions, so it handles any
screen size at any distance. Apps get a `calibrating` message at each step, and can draw markers
in the corners to help.

After screen calibration, **Recentre** means "I'm pointing at the middle of the screen": the relay
keeps the screen's size and moves it, which is a quick fix for drift.

Calibration assumes the player stays where they stood when calibrating, and faces the screen
roughly square on. If players move around a lot, calibrate from the usual standing position, or use
the ray and your own geometry.

## Smoothing

Raw phone orientation is slightly noisy. The relay smooths each app's poses with a
[One Euro filter](https://gery.casiez.net/1euro/), which is steady when the phone is still and quick
when it moves. Each app chooses its own settings:

| Setting | Default | Effect |
|---|---|---|
| `minCutoff` | 1.0 | Lower is steadier when still, but lags more on slow movements. |
| `beta` | 5.0 | Higher follows fast movements more quickly, with a little more jitter. |
| `dCutoff` | 1.0 | Rarely needs changing. |

Or turn smoothing off entirely and filter in your app. Tune with the dashboard's sliders on a real
phone, then use the same numbers in your app.

## Designing for phone pointing

A phone is a good-enough pointer, not a precise one.

- **Size targets generously.** Aim for targets at least a twentieth of the screen width (about
  2 degrees of the player's view). Buttons and characters are fine; small text links are not.
- **Show the cursor.** Players correct their aim by watching it. Give each player a distinct colour.
- **Reward pointing, not pixel accuracy.** Snap to the nearest target within a radius, or highlight
  what the cursor is over before the click.
- **Expect drift.** Remind players about Recentre, or send a `calibrate` prompt between rounds.
- **Mind the click.** Pressing a touchscreen button jolts the phone a little. The smoothing hides
  most of it; for precise moments, use the position from just before the button went down.
- **Paused means frozen.** When a player's state isn't `active`, grey out their cursor.
