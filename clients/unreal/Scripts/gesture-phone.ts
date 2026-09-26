// A scripted phone for the PhoneWand.Live.Gestures automation test. It joins a relay over the phone
// link (ws://<relay>:<http port>/phone), allows motion, presses Recentre, then sends 60 poses a
// second whose acceleration is still, except for a flick towards the screen every 1.5 s: 200 ms of
// 20 sin(2 pi u) m/s^2 along the phone's y axis, which the relay should report as a "push". The
// Primary button is held from just before each flick until just after it. Exits after --seconds.
//
//   bun clients/unreal/Scripts/gesture-phone.ts ws://127.0.0.1:8080/phone [--seconds 60] [--key k]

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "ws://127.0.0.1:8080/phone";
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const seconds = Number(opt("seconds", "60"));
const key = opt("key", "");

const log = (...parts: unknown[]) => console.log(`[gesture-phone ${new Date().toISOString().slice(11, 23)}]`, ...parts);

const PERIOD = 1500; // ms between flicks
const FLICK = 200; // ms a flick lasts
const START = 600; // ms into each period the flick starts

const ws = new WebSocket(url);
const send = (msg: object) => ws.send(JSON.stringify(msg));
let seq = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let begun = 0;
let held = false;
let flicks = 0;

function finish(code: number) {
  if (timer) clearInterval(timer);
  log(`sent ${flicks} flicks`);
  try {
    ws.close();
  } catch {}
  setTimeout(() => process.exit(code), 100);
}

function tick() {
  const now = performance.now();
  const inPeriod = (now - begun) % PERIOD;
  const u = (inPeriod - START) / FLICK;
  const a = u >= 0 && u <= 1 ? 20 * Math.sin(2 * Math.PI * u) : 0;
  const wantHeld = inPeriod >= START - 100 && inPeriod <= START + FLICK + 150;
  if (wantHeld !== held) {
    held = wantHeld;
    send({ type: "button", button: "primary", down: held });
    if (held) {
      flicks++;
      log("flick", flicks, "holding primary");
    }
  }
  send({ type: "pose", seq: seq++, ts: now, q: [0, 0, 0, 1], a: [0, a, 0] });
}

ws.onopen = () => {
  log("connected to", url);
  send({ type: "hello", key, name: "Flicker", platform: "other", sensor: "deviceorientation" });
};

ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data));
  switch (msg.type) {
    case "welcome":
      log("welcome", msg.id, "slot", msg.slot);
      send({ type: "ready", sensor: "deviceorientation" });
      // A few still poses first, so Recentre has an orientation to use.
      begun = performance.now();
      timer = setInterval(tick, 1000 / 60);
      setTimeout(() => send({ type: "recentre" }), 200);
      break;
    case "rejected":
      log("rejected", msg.reason);
      finish(1);
      break;
    case "ping":
      send({ type: "pong", n: msg.n, ts: performance.now() });
      break;
  }
};

ws.onclose = () => {
  log("closed");
  finish(1);
};

setTimeout(() => finish(0), seconds * 1000);
