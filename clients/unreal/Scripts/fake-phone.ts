// A scripted phone for the PhoneWand.Live.Layouts automation test. It joins a relay over the phone
// link (ws://<relay>:<http port>/phone), allows motion, sends poses and answers pings. When its
// layout gains a "fire" button it presses and releases it, then moves the "power" slider to 0.7.
// It prints every layout and set it receives, and exits once the layout goes back to the default
// after that (or after --seconds).
//
//   bun clients/unreal/Scripts/fake-phone.ts ws://127.0.0.1:8080/phone [--seconds 120] [--key k]

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "ws://127.0.0.1:8080/phone";
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const seconds = Number(opt("seconds", "120"));
const key = opt("key", "");

const log = (...parts: unknown[]) => console.log(`[fake-phone ${new Date().toISOString().slice(11, 23)}]`, ...parts);
const seen = { layouts: [] as string[], sets: [] as string[], acted: false, reset: false };

const ws = new WebSocket(url);
let seq = 0;
let poses: ReturnType<typeof setInterval> | undefined;
const send = (msg: object) => ws.send(JSON.stringify(msg));

function finish(code: number) {
  if (poses) clearInterval(poses);
  log("summary", JSON.stringify(seen));
  try {
    ws.close();
  } catch {}
  setTimeout(() => process.exit(code), 100);
}

ws.onopen = () => {
  log("connected to", url);
  send({ type: "hello", key, name: "Fake", platform: "other", sensor: "deviceorientation" });
};

ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data));
  switch (msg.type) {
    case "welcome":
      log("welcome", msg.id, "slot", msg.slot);
      send({ type: "ready", sensor: "deviceorientation" });
      poses = setInterval(() => send({ type: "pose", seq: seq++, ts: performance.now(), q: [0, 0, 0, 1] }), 33);
      break;
    case "rejected":
      log("rejected", msg.reason);
      finish(1);
      break;
    case "ping":
      send({ type: "pong", n: msg.n, ts: performance.now() });
      break;
    case "layout": {
      const ids = (msg.layout?.controls ?? []).map((c: { id: string; type: string }) => `${c.id}:${c.type}`);
      const summary = `${msg.layout?.template} [${ids.join(", ")}] values=${JSON.stringify(msg.values)}`;
      log("layout", summary);
      seen.layouts.push(summary);
      const hasFire = (msg.layout?.controls ?? []).some((c: { id: string }) => c.id === "fire");
      if (hasFire && !seen.acted) {
        seen.acted = true;
        setTimeout(() => {
          log("pressing fire, moving power to 0.7");
          send({ type: "button", button: "fire", down: true });
          setTimeout(() => {
            send({ type: "button", button: "fire", down: false });
            send({ type: "control", control: "power", value: 0.7 });
          }, 80);
        }, 200);
      } else if (seen.acted && msg.layout?.template === "primary-secondary") {
        seen.reset = true;
        log("back to the default layout; done");
        setTimeout(() => finish(0), 500);
      }
      break;
    }
    case "set":
      log("set", msg.control, JSON.stringify(msg.value));
      seen.sets.push(`${msg.control}=${JSON.stringify(msg.value)}`);
      break;
  }
};

ws.onclose = () => {
  log("closed");
  if (!seen.reset) finish(1);
};

setTimeout(() => {
  log(`gave up after ${seconds} s`);
  finish(seen.reset ? 0 : 1);
}, seconds * 1000);
