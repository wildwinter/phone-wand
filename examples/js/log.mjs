// Logs players, clicks and calibration from a running relay. Node 22+, Bun or Deno.
//
//   node examples/log.mjs          (from the release zip)
//   bun examples/js/log.mjs        (from the repository)

const { PhoneWand } = await import("../phone-wand.mjs").catch(() => import("../../packages/client-js/src/index.ts"));

const wand = new PhoneWand({ url: process.argv[2] ?? "ws://127.0.0.1:8480/app" });

wand.on("connected", (hello) => console.log(`connected to relay ${hello.relay}; phones join at ${hello.joinUrl}`));
wand.on("disconnected", () => console.log("relay went away; reconnecting..."));
wand.on("join", (p) => console.log(`${p.name} joined as player ${p.slot + 1}`));
wand.on("leave", (p) => console.log(`${p.name} left`));
wand.on("button", (e, p) => {
  if (!e.down) return;
  const where = p.pose?.screen ? `at ${p.pose.screen.map((v) => v.toFixed(2)).join(", ")}` : "off screen";
  console.log(`${p.name} pressed ${e.button} ${where}`);
});
wand.on("calibrated", (kind, p) => console.log(`${p.name} calibrated: ${kind}`));
