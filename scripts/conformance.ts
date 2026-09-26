// Conformance suite generator and checker.
//
//   bun scripts/conformance.ts           # regenerate conformance/ from the scripted sessions
//   bun scripts/conformance.ts --check   # fail if anything in conformance/ would change
//
// Each scripted session is a sequence of phone messages (and app commands) with timestamps. The
// relay's Session replays it with a fake clock, producing the exact app stream; the reference JS
// client then turns that stream into a canonical event log and a final state. Every client library
// replays conformance/app/<name>.jsonl and must produce the same events and state.
// See conformance/README.md.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type PhoneToRelay, type Quat, type RelayToApp, type SmoothingOptions,
  eulerToQuat, qrotate, round, FORWARD,
} from "@phone-wand/core";
import { PhoneWand, type Player } from "phone-wand";
import { Session } from "../packages/relay/src/session.js";

const root = join(import.meta.dir, "..");
const dir = join(root, "conformance");

// ------------------------------------------------------------------ session scripts

interface SessionConfig {
  maxPlayers: number;
  key: string;
  smoothing: SmoothingOptions | false | null; // null = relay default
}

type Line =
  | { config: SessionConfig }
  | { t: number; link: number; open: "ws" | "http" }
  | { t: number; link: number; close: true }
  | { t: number; link: number; msg: PhoneToRelay }
  | { t: number; app: object }
  | { t: number; end: true };

class Script {
  lines: Line[] = [];
  t = 0;
  private seqs = new Map<number, number>();
  constructor(config: SessionConfig) {
    this.lines.push({ config });
  }
  wait(ms: number): this {
    this.t += ms;
    return this;
  }
  open(link: number, transport: "ws" | "http" = "ws"): this {
    this.lines.push({ t: this.t, link, open: transport });
    this.seqs.set(link, 0);
    return this;
  }
  close(link: number): this {
    this.lines.push({ t: this.t, link, close: true });
    return this;
  }
  send(link: number, msg: PhoneToRelay): this {
    this.lines.push({ t: this.t, link, msg });
    return this;
  }
  app(msg: object): this {
    this.lines.push({ t: this.t, app: msg });
    return this;
  }
  join(link: number, name: string, extra: Partial<Extract<PhoneToRelay, { type: "hello" }>> = {}): this {
    return this.open(link)
      .send(link, { type: "hello", key: "k", name, platform: "iOS", sensor: "deviceorientation", ...extra })
      .send(link, { type: "ready", sensor: "deviceorientation" });
  }
  /** Poses at 30 Hz along a path of W3C Euler angles (alpha, beta, gamma) over `ms`. */
  move(link: number, ms: number, path: (u: number) => [number, number, number]): this {
    const steps = Math.round(ms / 33.3);
    for (let i = 0; i < steps; i++) {
      const [a, b, g] = path(i / Math.max(1, steps - 1));
      const seq = this.seqs.get(link) ?? 0;
      this.seqs.set(link, seq + 1);
      this.send(link, { type: "pose", seq, ts: 1000 + this.t, q: q(a, b, g) });
      this.wait(33.3);
    }
    return this;
  }
  /**
   * Poses at 60 Hz with the phone's acceleration, for gestures: path(seconds) gives W3C Euler angles
   * and the acceleration in the phone's own axes (x right edge, y top edge, z out of the screen).
   */
  motion(link: number, ms: number, path: (s: number) => { angles: [number, number, number]; a: [number, number, number] }): this {
    const steps = Math.round(ms / 16.7);
    for (let i = 0; i < steps; i++) {
      const { angles, a } = path(i * 0.0167);
      const seq = this.seqs.get(link) ?? 0;
      this.seqs.set(link, seq + 1);
      this.send(link, { type: "pose", seq, ts: 1000 + this.t, q: q(...angles), a: a.map((v) => round(v, 3)) as [number, number, number] });
      this.wait(16.7);
    }
    return this;
  }
  end(): Line[] {
    this.lines.push({ t: this.t, end: true });
    return this.lines;
  }
}

const q = (alpha: number, beta: number, gamma: number): Quat =>
  eulerToQuat(alpha, beta, gamma).map((v) => round(v, 6)) as Quat;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

const DEFAULT = { maxPlayers: 4, key: "k", smoothing: null };

const SESSIONS: Record<string, () => Line[]> = {
  // One player: join, wander, recentre, buttons, rename, pause and resume.
  basic: () => {
    const s = new Script(DEFAULT).join(1, "Ada");
    s.move(1, 600, (u) => [lerp(40, 30, u), lerp(0, 10, u), lerp(0, 5, u)]);
    s.send(1, { type: "recentre" });
    s.move(1, 800, (u) => [lerp(30, 5, u), lerp(10, 0, u), lerp(5, -10, u)]);
    s.send(1, { type: "button", button: "primary", down: true });
    s.move(1, 200, () => [5, 0, -10]);
    s.send(1, { type: "button", button: "primary", down: true }); // repeat: ignored
    s.send(1, { type: "button", button: "primary", down: false });
    s.send(1, { type: "button", button: "secondary", down: true });
    s.move(1, 200, (u) => [lerp(5, -10, u), 0, -10]);
    s.send(1, { type: "button", button: "secondary", down: false });
    s.send(1, { type: "name", name: "Ada2" });
    s.send(1, { type: "pause" });
    s.wait(300);
    s.send(1, { type: "resume" });
    s.move(1, 300, (u) => [lerp(-10, 0, u), lerp(0, -5, u), 0]);
    return s.end();
  },

  // Two-corner calibration, one failed attempt first.
  "screen-calibration": () => {
    const s = new Script(DEFAULT).join(1, "Bea");
    s.move(1, 300, () => [0, 0, 0]);
    s.send(1, { type: "calibrate-start" });
    s.send(1, { type: "corner", step: "top-left", q: q(-20, -10, 0) });
    s.send(1, { type: "corner", step: "bottom-right", q: q(20, 10, 0) }); // wrong way round
    s.send(1, { type: "calibrate-start" });
    s.send(1, { type: "corner", step: "top-left", q: q(20, 9, 0) });
    s.move(1, 200, (u) => [lerp(20, -20, u), lerp(9, -9, u), 0]);
    s.send(1, { type: "corner", step: "bottom-right", q: q(-20, -9, 0) });
    s.move(1, 600, (u) => [lerp(20, -20, u), lerp(9, -9, u), 0]);
    s.send(1, { type: "calibrate-start" });
    s.send(1, { type: "calibrate-cancel" });
    // Recentre with a calibrated screen keeps its size.
    s.move(1, 200, () => [3, 1, 0]);
    s.send(1, { type: "recentre" });
    s.move(1, 400, (u) => [lerp(3, -17, u), 1, 0]);
    return s.end();
  },

  // Three phones and two slots: full, bad key, reconnect within the grace period, and leaving.
  players: () => {
    const s = new Script({ maxPlayers: 2, key: "k", smoothing: null });
    s.join(1, "Cy");
    s.join(2, "Dot");
    s.open(3).send(3, { type: "hello", key: "k", name: "Eli", platform: "Android", sensor: "" });
    s.open(4).send(4, { type: "hello", key: "wrong", name: "Fen", platform: "Android", sensor: "" });
    s.move(1, 300, () => [0, 0, 0]);
    s.move(2, 300, () => [10, 0, 0]);
    s.send(2, { type: "button", button: "primary", down: true });
    s.close(2); // lost with a button held: the relay releases it
    s.move(1, 1000, () => [0, 0, 0]);
    s.open(5, "http").send(5, { type: "hello", key: "k", token: "token-2", name: "Dot", platform: "iOS", sensor: "deviceorientation" });
    s.move(5, 300, () => [10, 2, 0]);
    s.close(1);
    s.move(5, 1000, () => [10, 2, 0]);
    s.wait(60_000); // past the grace period: player 1 leaves
    s.move(5, 100, () => [10, 2, 0]);
    return s.end();
  },

  // App commands, and a player going quiet (paused by timeout).
  "app-commands": () => {
    const s = new Script(DEFAULT).join(1, "Gus");
    s.move(1, 200, () => [0, 0, 0]);
    s.app({ type: "style", id: "p1", colour: "#00C2FF", label: "Blue team" });
    s.app({ type: "style", id: "p1", colour: "not-a-colour" });
    s.app({ type: "style", id: "nobody", colour: "#ffffff" });
    s.app({ type: "prompt", text: "Hello" });
    s.app({ type: "haptic", id: "p1", pattern: [40] });
    s.app({ type: "calibrate", mode: "screen" });
    s.move(1, 200, () => [0, 0, 0]);
    s.wait(800); // no poses: paused
    s.move(1, 200, () => [0, 0, 0]);
    return s.end();
  },

  // Layouts: custom controls, values from the phone and the app, invalid input, and a layout
  // change releasing a held button.
  layouts: () => {
    const s = new Script(DEFAULT).join(1, "Ivy").join(2, "Jo");
    s.move(1, 100, () => [0, 0, 0]);
    s.app({
      type: "layout", id: "p1",
      layout: {
        template: "grid",
        controls: [
          { id: "fire", type: "button", label: "Fire" },
          { id: "shield", type: "toggle", label: "Shield" },
          { id: "power", type: "slider", label: "Power", value: 0.25 },
          { id: "throttle", type: "slider", orientation: "vertical", spring: 0.5 },
          { id: "weapon", type: "choice", options: ["Bow", "Sling", "Net"], value: 1 },
          { id: "score", type: "label", label: "Score", text: "0" },
        ],
      },
    });
    s.send(1, { type: "button", button: "fire", down: true });
    s.send(1, { type: "button", button: "fire", down: false });
    s.send(1, { type: "button", button: "primary", down: true }); // not in this layout: ignored
    s.send(1, { type: "control", control: "shield", value: true });
    s.send(1, { type: "control", control: "shield", value: true }); // unchanged: no event
    s.send(1, { type: "control", control: "power", value: 0.8 });
    s.send(1, { type: "control", control: "power", value: 7 }); // clamped to 1
    s.send(1, { type: "control", control: "weapon", value: 2 });
    s.send(1, { type: "control", control: "weapon", value: 9 }); // no such option: ignored
    s.send(1, { type: "control", control: "score", value: "999" }); // labels are the app's: ignored
    s.app({ type: "set", id: "p1", control: "score", value: "10" });
    s.app({ type: "set", id: "p1", control: "shield", value: "yes" }); // wrong type: error
    s.app({ type: "layout", id: "p1", layout: { template: "primary", controls: [{ id: "x", type: "toggle" }] } }); // error
    s.move(1, 100, () => [0, 0, 0]);
    // Everyone gets a primary-row layout while player 2 holds the default primary button.
    s.send(2, { type: "button", button: "primary", down: true });
    s.app({
      type: "layout",
      layout: {
        template: "primary-row",
        controls: [
          { id: "shoot", type: "button", label: "Shoot", colour: "#00FF88" },
          { id: "reload", type: "button" },
          { id: "zoom", type: "toggle", value: true },
        ],
      },
    });
    s.send(2, { type: "control", control: "zoom", value: false });
    s.app({ type: "set", control: "zoom", value: true });
    s.app({ type: "layout", id: "p2", layout: null }); // back to the default
    s.send(2, { type: "button", button: "secondary", down: true });
    s.send(2, { type: "button", button: "secondary", down: false });
    return s.end();
  },

  // Gestures from the phone's motion: flicks each way, one while a button is held, a shake, a
  // twist of the wrist, and slow movement that must not count.
  gestures: () => {
    const s = new Script(DEFAULT).join(1, "Kit");
    s.move(1, 200, () => [0, 0, 0]);
    s.send(1, { type: "recentre" });
    const still = { angles: [0, 0, 0] as [number, number, number], a: [0, 0, 0] as [number, number, number] };
    // A flick along one of the phone's axes: speed up, then slow down, over 200 ms.
    const flick = (axis: number, sign: number, peak = 20) => (t: number) => {
      const u = t / 0.2;
      const v = u <= 1 ? sign * peak * Math.sin(2 * Math.PI * u) : 0;
      const a: [number, number, number] = [0, 0, 0];
      a[axis] = v;
      return { angles: [0, 0, 0] as [number, number, number], a };
    };
    s.motion(1, 400, flick(1, 1)); // top edge forwards: push
    s.motion(1, 400, () => still);
    s.motion(1, 400, flick(0, -1)); // left edge first: left
    s.motion(1, 400, () => still);
    s.motion(1, 400, flick(2, 1)); // out of the screen: up
    s.motion(1, 400, () => still);
    s.send(1, { type: "button", button: "primary", down: true });
    s.motion(1, 400, flick(1, -1)); // pull, with Primary held
    s.send(1, { type: "button", button: "primary", down: false });
    s.motion(1, 400, () => still);
    s.motion(1, 1000, (t) => ({ angles: [0, 0, 0], a: [25 * Math.sin(2 * Math.PI * 5 * t), 0, 0] })); // shake
    s.motion(1, 500, () => still);
    s.motion(1, 500, (t) => ({ angles: [0, 0, t < 0.15 ? (80 * t) / 0.15 : 80], a: [0, 0, 0] })); // twist
    s.motion(1, 1200, (t) => ({ angles: [0, 0, 80 * (1 - t / 1.2)], a: [0, 0, 0] })); // back, slowly
    // A wrist flick upward (beta is the top edge tipping up): a flick, not a twist or a movement.
    const ease = (u: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;
    s.motion(1, 500, (t) => ({ angles: [0, 45 * ease(t / 0.15), 0], a: [0, 0, 0] }));
    s.motion(1, 1200, (t) => ({ angles: [0, 45 * (1 - t / 1.2), 0], a: [0, 0, 0] })); // back, slowly
    // A fast turn right (alpha turns left, so it goes negative), with the swing around the wrist
    // picked up as strong sideways motion: a flick-right and nothing else.
    s.motion(1, 500, (t) => {
      const u = t / 0.18;
      const swing = u <= 1 ? 30 * Math.sin(2 * Math.PI * u) : 0;
      return { angles: [-60 * ease(u), 0, 0], a: [swing, 0, 0] };
    });
    s.motion(1, 1500, (t) => ({ angles: [-60 * (1 - t / 1.5), 0, 0], a: [0, 0, 0] })); // back, slowly
    s.motion(1, 1200, (t) => ({ angles: [0, 0, 0], a: [0, 3 * Math.sin(Math.PI * t), 0] })); // slow: nothing
    return s.end();
  },

  // The same wandering as basic, with smoothing off, so raw calibrated values are pinned too.
  raw: () => {
    const s = new Script({ maxPlayers: 4, key: "k", smoothing: false }).join(1, "Hal");
    s.move(1, 500, (u) => [lerp(-30, 30, u), lerp(-20, 20, u), lerp(-15, 15, u)]);
    s.send(1, { type: "recentre" });
    s.move(1, 500, (u) => [lerp(30, -30, u), lerp(20, -20, u), lerp(15, -15, u)]);
    return s.end();
  },
};

// ------------------------------------------------------------------ running a session

function runSession(lines: Line[]): RelayToApp[] {
  const config = (lines[0] as { config: SessionConfig }).config;
  let now = 0;
  let tokens = 0;
  const out: RelayToApp[] = [];
  const session = new Session({
    maxPlayers: config.maxPlayers, key: config.key,
    joinUrl: "https://relay.test:8443/?k=k", qrUrl: "http://127.0.0.1:8480/qr.png", version: "conformance",
    now: () => now,
    makeToken: () => `token-${++tokens}`,
  });
  const app = session.addApp({ send: (m) => out.push(structuredClone(m)) });
  if (config.smoothing !== null) session.appMessage(app, { type: "configure", smoothing: config.smoothing });

  const conns = new Map<number, ReturnType<Session["addPhone"]>>();
  let nextTick = 100;
  for (const line of lines.slice(1)) {
    const t = (line as { t: number }).t;
    while (nextTick <= t) {
      now = nextTick;
      session.tick();
      nextTick += 100;
    }
    now = t;
    if ("open" in line) {
      const transport = line.open;
      conns.set(line.link, session.addPhone({ transport, send() {}, close() {} }));
    } else if ("close" in line) {
      const c = conns.get(line.link);
      if (c) session.phoneClosed(c);
    } else if ("msg" in line) {
      const c = conns.get(line.link);
      if (c) session.phoneMessage(c, line.msg);
    } else if ("app" in line) {
      session.appMessage(app, line.app as never);
    }
  }
  return out;
}

// ------------------------------------------------------------------ reference client output

function clientTrace(stream: RelayToApp[]): { events: string[]; state: object } {
  const events: string[] = [];
  const wand = new PhoneWand({ autoConnect: false });
  wand.on("connected", (h) => events.push(`connected protocol=${h.protocol} max=${h.maxPlayers}`));
  wand.on("join", (p) => events.push(`join ${p.id} slot=${p.slot} name=${p.name} colour=${p.colour}`));
  wand.on("player", (p) => events.push(`player ${p.id} state=${p.state} calibration=${p.calibration} name=${p.name} colour=${p.colour} transport=${p.device.transport}`));
  wand.on("leave", (p) => events.push(`leave ${p.id}`));
  wand.on("pose", (pose) => events.push(`pose ${pose.id} seq=${pose.seq} screen=${pose.screen ? "yes" : "no"}`));
  wand.on("button", (e) => events.push(`button ${e.id} ${e.button} ${e.down ? "down" : "up"}`));
  wand.on("control", (e) => events.push(`control ${e.id} ${e.control}`));
  wand.on("gesture", (g) => events.push(`gesture ${g.id} ${g.gesture} buttons=${g.buttons.join(",") || "-"}`));
  wand.on("error", () => {}); // errors are for the app's developer, not part of the log
  wand.on("calibrating", (step, p) => events.push(`calibrating ${p.id} ${step}`));
  wand.on("calibrated", (c, p) => events.push(`calibrated ${p.id} ${c}`));
  wand.on("stats", (s) => events.push(`stats ${s.id}`));
  for (const m of stream) wand.handle(structuredClone(m));
  const state = {
    players: wand.list.map((p: Player) => ({
      id: p.id, slot: p.slot, name: p.name, colour: p.colour, label: p.label,
      state: p.state, calibration: p.calibration, transport: p.device.transport,
      buttons: [...p.buttons].sort(),
      template: p.layout.template,
      controls: Object.fromEntries(Object.entries(p.controls).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      pose: p.pose && {
        seq: p.pose.seq, yaw: p.pose.yaw, pitch: p.pose.pitch, roll: p.pose.roll,
        q: p.pose.q, dir: p.pose.dir, screen: p.pose.screen,
      },
    })),
  };
  return { events, state };
}

// ------------------------------------------------------------------ frame conversions

function conversions() {
  const cases: object[] = [];
  const angles: [number, number, number][] = [
    [0, 0, 0], [30, 0, 0], [0, 25, 0], [0, 0, 40], [-50, 20, -15], [120, -35, 60], [0, 80, 0],
  ];
  for (const [yaw, pitch, roll] of angles) {
    // Build the rig quaternion from W3C angles through the same path a phone takes.
    const rig = eulerToQuat(-yaw, pitch, roll);
    const qr: Quat = [-rig[0], -rig[2], -rig[1], rig[3]];
    const d = qrotate(qr, FORWARD);
    const up = qrotate(qr, [0, 1, 0]);
    const r5 = (v: number[]) => v.map((x) => round(x, 6));
    cases.push({
      rig: { q: r5(qr), dir: r5(d), up: r5(up) },
      unity: { q: r5(qr), dir: r5(d), up: r5(up) },
      godot: { q: r5([-qr[0], -qr[1], qr[2], qr[3]]), dir: r5([d[0], d[1], -d[2]]), up: r5([up[0], up[1], -up[2]]) },
      unreal: { q: r5([qr[2], qr[0], qr[1], qr[3]]), dir: r5([d[2], d[0], d[1]]), up: r5([up[2], up[0], up[1]]) },
    });
  }
  return {
    description:
      "Rig-frame orientation and the matching engine-frame values. q is [x, y, z, w]; rotating the " +
      "engine's own forward and up by the engine q must give dir and up (Unity forward +z, Godot -z, Unreal +x).",
    cases,
  };
}

// ------------------------------------------------------------------ main

export function generate(): Map<string, string> {
  const files = new Map<string, string>();
  const jsonl = (items: unknown[]) => items.map((x) => JSON.stringify(x)).join("\n") + "\n";
  for (const [name, make] of Object.entries(SESSIONS)) {
    const lines = make();
    const stream = runSession(lines);
    const { events, state } = clientTrace(stream);
    files.set(`sessions/${name}.jsonl`, jsonl(lines));
    files.set(`app/${name}.jsonl`, jsonl(stream));
    files.set(`app/${name}.events.txt`, events.join("\n") + "\n");
    files.set(`app/${name}.state.json`, JSON.stringify(state, null, 2) + "\n");
  }
  files.set("conversions.json", JSON.stringify(conversions(), null, 2) + "\n");
  files.set("index.json", JSON.stringify({ protocol: 0, sessions: Object.keys(SESSIONS) }, null, 2) + "\n");
  return files;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const files = generate();
  let stale = 0;
  for (const [rel, content] of files) {
    const path = join(dir, rel);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === content) continue;
    if (check) {
      console.error(`conformance: ${rel} is out of date`);
      stale++;
    } else {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content);
      console.log(`wrote conformance/${rel}`);
    }
  }
  if (check) {
    const known = new Set(files.keys());
    for (const sub of ["sessions", "app"]) {
      for (const f of existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)) : []) {
        if (!known.has(`${sub}/${f}`)) {
          console.error(`conformance: ${sub}/${f} is not generated by any session`);
          stale++;
        }
      }
    }
    if (stale) {
      console.error("Run `bun scripts/conformance.ts` and commit the result if the change is intended.");
      process.exit(1);
    }
    console.log(`conformance: ${files.size} files up to date`);
  }
}
