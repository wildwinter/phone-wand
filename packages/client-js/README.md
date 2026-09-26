# Phone Wand for JavaScript

A client for [Phone Wand](https://github.com/wildwinter/phone-wand), which turns phones into shared
pointers for a screen. Works in browsers and in Node 22+, Bun and Deno.

```js
import { PhoneWand, toPixels } from "./phone-wand.mjs";

const wand = new PhoneWand(); // ws://127.0.0.1:8480/app
wand.on("pose", (pose, player) => {
  const pos = toPixels(pose.screen, innerWidth, innerHeight);
  // draw player.colour at pos
});
wand.on("button", (e, player) => {
  if (e.button === "primary" && e.down) console.log(`${player.name} clicked`);
});
```

Without a bundler, load `phone-wand.min.js` (or `http://127.0.0.1:8480/phone-wand.js`, which the
relay serves) with a `<script>` tag and use the global `PhoneWand`.

Full documentation: https://github.com/wildwinter/phone-wand/blob/main/docs/clients/js.md
