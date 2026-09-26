# Cursors sample

Draws every player's cursor over the game view: a disc in the player's colour where they point,
their name beside it, a ripple when they press the main button, and an arrow at the edge of the
screen when they point off it.

1. Start the Phone Wand relay (`bun run relay` in the phone-wand repository, or `--simulate 3` to
   try it without phones).
2. Open `Cursors.unity` and press Play, or add the `CursorsSample` component to any GameObject.

`CursorsSample` uses the `PhoneWandClient` on its GameObject, adding one with the default relay
address (`ws://127.0.0.1:8480/app`) if there is none. Everything is drawn with OnGUI, so the
sample needs no canvas or other packages.
