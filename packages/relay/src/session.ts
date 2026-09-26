// The relay's logic, independent of any network: players and slots, calibration, smoothing and
// fan-out to apps. server.ts wires real connections to it; tests and the conformance runner drive
// it directly with a fake clock.

import {
  type AppToRelay, type ButtonName, type CalibrationKind, type PhoneToRelay, type PlayerInfo,
  type PlayerState, type Quat, type RelayToApp, type RelayToPhone, type SensorKind,
  type SmoothingOptions, type Transport, type Layout, type ControlValue,
  DEFAULT_LAYOUT, DEFAULT_SMOOTHING, PointerCalibration, PoseSmoother, PROTOCOL_VERSION, SLOT_COLOURS,
  controlValue, derivePose, layoutValues, validateLayout,
  DEFAULT_GESTURES, GestureDetector, type GestureOptions, qrotate, round,
} from "@phone-wand/core";

export interface PhoneLink {
  transport: Transport;
  send(msg: RelayToPhone): void;
  close(): void;
}

export interface AppLink {
  send(msg: RelayToApp): void;
}

export interface SessionOptions {
  maxPlayers: number;
  /** Required join key, or "" to let anyone join. */
  key: string;
  /** The address the QR code carries. Settable, since it depends on which servers started. */
  joinUrl: string;
  qrUrl: string;
  version: string;
  now?: () => number;
  /** How long a disconnected phone keeps its slot, in ms. */
  reconnectGrace?: number;
  /** No pose for this long marks a player paused, in ms. */
  pauseAfter?: number;
  /** Called for every phone message, for recording. */
  onPhoneMessage?: (linkId: number, msg: PhoneToRelay, t: number) => void;
  /** Called when a phone connection opens or closes, for recording. */
  onPhoneLink?: (linkId: number, event: "open" | "close", transport: Transport, t: number) => void;
  log?: (line: string) => void;
  /** Reconnect token generator. Random by default; conformance runs make it deterministic. */
  makeToken?: () => string;
}

interface App {
  link: AppLink;
  smoothing: SmoothingOptions | false;
  gestures: GestureOptions | false;
}

class Player {
  id: string;
  slot: number;
  name: string;
  colour: string;
  label = "";
  state: PlayerState = "waiting";
  token: string;
  platform = "other";
  sensor: SensorKind | "" = "";
  link: PhoneLink | null = null;
  calibration = new PointerCalibration();
  lastQ: Quat | null = null;
  lastSeq = -1;
  lastPoseAt = 0;
  disconnectedAt = 0;
  paused = false;
  /** Doing two-corner calibration: the cursor is hidden so it does not distract. */
  calibratingScreen = false;
  buttons = new Set<ButtonName>();
  layout: Layout = structuredClone(DEFAULT_LAYOUT);
  values: Record<string, ControlValue> = layoutValues(DEFAULT_LAYOUT);
  smoothers = new Map<App, PoseSmoother>();
  detectors = new Map<App, GestureDetector>();
  /** When each button last went down and up, to tell which were held when a gesture began. */
  buttonTimes = new Map<string, { down: number; up: number | null }>();
  // stats, reset every second
  poses = 0;
  dropped = 0;
  rtt = 0;
  pingN = 0;
  pingSent = new Map<number, number>();

  constructor(id: string, slot: number, token: string) {
    this.id = id;
    this.slot = slot;
    this.token = token;
    this.name = `Player ${slot + 1}`;
    this.colour = SLOT_COLOURS[slot % SLOT_COLOURS.length];
  }

  info(): PlayerInfo {
    return {
      id: this.id, slot: this.slot, name: this.name, colour: this.colour, label: this.label,
      state: this.state, calibration: this.calibration.kind as CalibrationKind,
      device: { platform: this.platform, sensor: this.sensor, transport: this.link?.transport ?? "ws" },
      layout: this.layout,
      controls: { ...this.values },
    };
  }
}

/** One connected phone, before and after it becomes a player. */
export class PhoneConnection {
  player: Player | null = null;
  constructor(readonly linkId: number, readonly link: PhoneLink) {}
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class Session {
  readonly players = new Map<string, Player>();
  private apps = new Set<App>();
  private nextPlayer = 1;
  private nextLink = 1;
  private readonly now: () => number;
  private readonly grace: number;
  private readonly pauseAfter: number;

  constructor(readonly options: SessionOptions) {
    this.now = options.now ?? (() => Date.now());
    this.grace = options.reconnectGrace ?? 60_000;
    this.pauseAfter = options.pauseAfter ?? 500;
  }

  // ---------------------------------------------------------------- apps

  addApp(link: AppLink): App {
    const app: App = { link, smoothing: { ...DEFAULT_SMOOTHING }, gestures: { ...DEFAULT_GESTURES } };
    this.apps.add(app);
    link.send({
      type: "hello", protocol: PROTOCOL_VERSION, relay: this.options.version,
      joinUrl: this.options.joinUrl, qrUrl: this.options.qrUrl,
      maxPlayers: this.options.maxPlayers,
      players: [...this.players.values()].map((p) => p.info()),
    });
    return app;
  }

  removeApp(app: App): void {
    this.apps.delete(app);
    for (const p of this.players.values()) p.smoothers.delete(app);
  }

  appMessage(app: App, msg: AppToRelay): void {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "configure": {
        if (msg.smoothing === false) app.smoothing = false;
        else if (msg.smoothing && typeof msg.smoothing === "object") {
          const cur = app.smoothing || DEFAULT_SMOOTHING;
          app.smoothing = {
            minCutoff: num(msg.smoothing.minCutoff, cur.minCutoff),
            beta: num(msg.smoothing.beta, cur.beta),
            dCutoff: num(msg.smoothing.dCutoff, cur.dCutoff),
          };
        }
        for (const p of this.players.values()) p.smoothers.get(app)?.setOptions(app.smoothing);
        if (msg.gestures === false) app.gestures = false;
        else if (msg.gestures && typeof msg.gestures === "object") {
          const cur = app.gestures || DEFAULT_GESTURES;
          app.gestures = {
            threshold: num(msg.gestures.threshold, cur.threshold),
            minSpeed: num(msg.gestures.minSpeed, cur.minSpeed),
            twistRate: num(msg.gestures.twistRate, cur.twistRate),
          };
        }
        for (const p of this.players.values()) p.detectors.delete(app);
        break;
      }
      case "style": {
        const p = this.players.get(msg.id);
        if (!p) return;
        if (typeof msg.colour === "string" && HEX.test(msg.colour)) p.colour = msg.colour.toLowerCase();
        if (typeof msg.label === "string") p.label = msg.label.slice(0, 40);
        p.link?.send({ type: "style", colour: p.colour, label: p.label });
        this.broadcast({ type: "player", player: p.info() });
        break;
      }
      case "prompt": {
        const text = typeof msg.text === "string" ? msg.text.slice(0, 200) : "";
        const duration = num(msg.duration, 3000);
        for (const p of this.targets(msg.id)) p.link?.send({ type: "prompt", text, duration });
        break;
      }
      case "haptic": {
        const pattern = Array.isArray(msg.pattern) ? msg.pattern.slice(0, 20).map((n) => num(n, 0)) : [];
        for (const p of this.targets(msg.id)) p.link?.send({ type: "haptic", pattern });
        break;
      }
      case "calibrate": {
        const mode = msg.mode === "ray" ? "ray" : "screen";
        for (const p of this.targets(msg.id)) p.link?.send({ type: "calibrate", mode });
        break;
      }
      case "layout": {
        const layout = msg.layout === null ? structuredClone(DEFAULT_LAYOUT) : validateLayout(msg.layout);
        if (typeof layout === "string") return this.error(app, `layout: ${layout}`);
        for (const p of this.targets(msg.id)) this.setLayout(p, structuredClone(layout));
        break;
      }
      case "set": {
        for (const p of this.targets(msg.id)) {
          const control = p.layout.controls.find((c) => c.id === msg.control);
          const value = control ? controlValue(control, msg.value) : undefined;
          if (value === undefined) {
            this.error(app, `set: ${p.id} has no control ${String(msg.control)} that takes ${JSON.stringify(msg.value)}`);
            continue;
          }
          p.values[control!.id] = value;
          p.link?.send({ type: "set", control: control!.id, value });
          this.broadcast({ type: "control", id: p.id, control: control!.id, value });
        }
        break;
      }
    }
  }

  private error(app: App, message: string): void {
    this.options.log?.(`app error: ${message}`);
    app.link.send({ type: "error", message });
  }

  private setLayout(p: Player, layout: Layout): void {
    // Buttons that no longer exist are released, so apps never see one stuck down.
    for (const b of [...p.buttons]) {
      if (!layout.controls.some((c) => c.id === b && c.type === "button")) {
        p.buttons.delete(b);
        this.broadcast({ type: "button", id: p.id, button: b, down: false });
      }
    }
    p.layout = layout;
    p.values = layoutValues(layout);
    p.link?.send({ type: "layout", layout, values: { ...p.values } });
    this.broadcast({ type: "player", player: p.info() });
  }

  private targets(id: string | undefined): Player[] {
    if (id === undefined) return [...this.players.values()];
    const p = this.players.get(id);
    return p ? [p] : [];
  }

  private broadcast(msg: RelayToApp): void {
    for (const app of this.apps) app.link.send(msg);
  }

  // ---------------------------------------------------------------- phones

  addPhone(link: PhoneLink): PhoneConnection {
    const conn = new PhoneConnection(this.nextLink++, link);
    this.options.onPhoneLink?.(conn.linkId, "open", link.transport, this.now());
    return conn;
  }

  phoneMessage(conn: PhoneConnection, msg: PhoneToRelay): void {
    if (!msg || typeof msg !== "object") return;
    const t = this.now();
    this.options.onPhoneMessage?.(conn.linkId, msg, t);
    if (msg.type === "hello") return this.hello(conn, msg);
    const p = conn.player;
    if (!p || p.link !== conn.link) return;

    switch (msg.type) {
      case "ready":
        if (msg.sensor) p.sensor = msg.sensor;
        this.setState(p, "active");
        break;
      case "pose":
        this.pose(p, msg.seq, msg.q, msg.ts, t, msg.a);
        break;
      case "button": {
        if (!p.layout.controls.some((c) => c.id === msg.button && c.type === "button")) return;
        const down = !!msg.down;
        if (down === p.buttons.has(msg.button)) return; // ignore repeats
        if (down) p.buttons.add(msg.button);
        else p.buttons.delete(msg.button);
        if (down) p.buttonTimes.set(msg.button, { down: t, up: null });
        else {
          const bt = p.buttonTimes.get(msg.button);
          if (bt) bt.up = t;
        }
        this.broadcast({ type: "button", id: p.id, button: msg.button, down });
        break;
      }
      case "control": {
        const control = p.layout.controls.find((c) => c.id === msg.control);
        if (!control || control.type === "label" || control.type === "button") return;
        const value = controlValue(control, msg.value);
        if (value === undefined || value === p.values[control.id]) return;
        p.values[control.id] = value;
        this.broadcast({ type: "control", id: p.id, control: control.id, value });
        break;
      }
      case "recentre":
        if (!p.lastQ) return;
        p.calibration.recentre(p.lastQ);
        this.calibrated(p);
        break;
      case "calibrate-start":
        p.calibration.cancelCorners();
        p.calibratingScreen = true;
        this.broadcast({ type: "calibrating", id: p.id, step: "top-left" });
        break;
      case "calibrate-cancel":
        p.calibration.cancelCorners();
        p.calibratingScreen = false;
        this.broadcast({ type: "calibrating", id: p.id, step: "cancelled" });
        break;
      case "corner":
        if (!isQuat(msg.q)) return;
        if (msg.step === "top-left") {
          p.calibration.cornerTopLeft(msg.q);
          p.link.send({ type: "calibration", calibration: p.calibration.kind, step: "top-left", ok: true });
          this.broadcast({ type: "calibrating", id: p.id, step: "bottom-right" });
        } else if (msg.step === "bottom-right") {
          if (p.calibration.cornerBottomRight(msg.q)) {
            this.calibrated(p);
          } else {
            // The phone asks the player to start again from the first corner.
            p.link.send({ type: "calibration", calibration: p.calibration.kind, step: "failed", ok: false });
            this.broadcast({ type: "calibrating", id: p.id, step: "top-left" });
          }
        }
        break;
      case "pause":
        p.paused = true;
        this.releaseButtons(p);
        this.setState(p, "paused");
        break;
      case "resume":
        p.paused = false;
        break;
      case "name":
        if (typeof msg.name === "string") {
          p.name = cleanName(msg.name) || p.name;
          this.broadcast({ type: "player", player: p.info() });
        }
        break;
      case "pong": {
        const sent = p.pingSent.get(msg.n);
        if (sent !== undefined) {
          p.rtt = t - sent;
          p.pingSent.delete(msg.n);
        }
        break;
      }
    }
  }

  private hello(conn: PhoneConnection, msg: Extract<PhoneToRelay, { type: "hello" }>): void {
    if (conn.player) return;
    if (this.options.key && msg.key !== this.options.key) {
      conn.link.send({ type: "rejected", reason: "bad-key" });
      conn.link.close();
      return;
    }
    let p = msg.token ? [...this.players.values()].find((x) => x.token === msg.token) : undefined;
    let joined = false;
    if (p) {
      // Reconnect: take over from any old link.
      if (p.link && p.link !== conn.link) p.link.close();
    } else {
      const slot = this.freeSlot();
      if (slot < 0) {
        conn.link.send({ type: "rejected", reason: "full" });
        conn.link.close();
        return;
      }
      p = new Player(`p${this.nextPlayer++}`, slot, (this.options.makeToken ?? randomToken)());
      this.players.set(p.id, p);
      joined = true;
    }
    conn.player = p;
    p.link = conn.link;
    p.disconnectedAt = 0;
    p.lastSeq = -1;
    p.paused = false;
    p.calibratingScreen = false;
    p.state = "waiting";
    if (typeof msg.name === "string" && cleanName(msg.name)) p.name = cleanName(msg.name);
    p.platform = ["iOS", "Android"].includes(msg.platform) ? msg.platform : "other";
    if (msg.sensor) p.sensor = msg.sensor;
    for (const s of p.smoothers.values()) s.reset();
    conn.link.send({
      type: "welcome", id: p.id, token: p.token, slot: p.slot, name: p.name,
      colour: p.colour, label: p.label, calibration: p.calibration.kind,
    });
    conn.link.send({ type: "layout", layout: p.layout, values: { ...p.values } });
    if (joined) {
      this.options.log?.(`join  ${p.id} slot ${p.slot + 1} "${p.name}" (${p.platform}, ${conn.link.transport})`);
      this.broadcast({ type: "join", player: p.info() });
    } else {
      this.options.log?.(`back  ${p.id} slot ${p.slot + 1} "${p.name}" (${conn.link.transport})`);
      this.broadcast({ type: "player", player: p.info() });
    }
  }

  phoneClosed(conn: PhoneConnection): void {
    this.options.onPhoneLink?.(conn.linkId, "close", conn.link.transport, this.now());
    const p = conn.player;
    if (!p || p.link !== conn.link) return;
    p.link = null;
    p.disconnectedAt = this.now();
    this.releaseButtons(p);
    p.calibration.cancelCorners();
    if (p.calibratingScreen) this.broadcast({ type: "calibrating", id: p.id, step: "cancelled" });
    p.calibratingScreen = false;
    this.options.log?.(`lost  ${p.id} (holding slot ${p.slot + 1} for ${Math.round(this.grace / 1000)} s)`);
    this.setState(p, "paused");
  }

  private pose(p: Player, seq: number, q: Quat, ts: number, t: number, a?: unknown): void {
    if (!isQuat(q) || typeof seq !== "number") return;
    if (seq <= p.lastSeq) {
      p.dropped++; // late or duplicate: newer data already went out
      return;
    }
    if (p.lastSeq >= 0 && seq > p.lastSeq + 1) p.dropped += seq - p.lastSeq - 1;
    p.lastSeq = seq;
    p.lastQ = q;
    p.lastPoseAt = t;
    p.poses++;
    if (!p.paused) this.setState(p, "active");
    const calibrated = p.calibration.calibrate(q);
    const stamp = typeof ts === "number" && isFinite(ts) ? ts : t;
    // The phone's acceleration (gravity removed), from its own axes to the calibrated rig frame:
    // device x, y, z are body right, forward, up.
    const accel = isVec3(a) ? qrotate(calibrated, [a[0], a[2], a[1]]).map((v) => round(v, 3)) as [number, number, number] : null;
    const roll = accel ? derivePose(calibrated, p.calibration.screen).roll : 0;
    for (const app of this.apps) {
      let s = p.smoothers.get(app);
      if (!s) p.smoothers.set(app, (s = new PoseSmoother(app.smoothing)));
      const d = derivePose(s.smooth(calibrated, stamp), p.calibration.screen);
      // No cursor until the player has aimed at least once this run (Recentre or screen
      // calibration), nor while they calibrate: apps show a prompt instead of a misleading cursor.
      if (p.calibratingScreen || p.calibration.kind === "none") d.screen = null;
      app.link.send(accel ? { type: "pose", id: p.id, seq, t, ...d, accel } : { type: "pose", id: p.id, seq, t, ...d });
      if (accel && app.gestures && !p.paused) {
        let g = p.detectors.get(app);
        if (!g) p.detectors.set(app, (g = new GestureDetector(app.gestures)));
        for (const found of g.update(accel, roll, t)) {
          app.link.send({ type: "gesture", id: p.id, ...found, buttons: this.heldAt(p, found.t) });
        }
      }
    }
  }

  /** Buttons that were down at time t: the ones held when a gesture began. */
  private heldAt(p: Player, t: number): string[] {
    const held: string[] = [];
    for (const [id, bt] of p.buttonTimes) if (bt.down <= t && (bt.up === null || bt.up >= t)) held.push(id);
    return held.sort();
  }

  private calibrated(p: Player): void {
    p.calibratingScreen = false;
    for (const s of p.smoothers.values()) s.reset(); // jump straight to the new frame
    const kind = p.calibration.kind;
    this.options.log?.(`calib ${p.id} ${kind}`);
    p.link?.send({ type: "calibration", calibration: kind, step: "done", ok: true });
    this.broadcast({ type: "calibrated", id: p.id, calibration: kind });
    this.broadcast({ type: "player", player: p.info() });
  }

  private releaseButtons(p: Player): void {
    for (const b of p.buttons) this.broadcast({ type: "button", id: p.id, button: b, down: false });
    p.buttons.clear();
  }

  private setState(p: Player, state: PlayerState): void {
    if (p.state === state) return;
    p.state = state;
    this.broadcast({ type: "player", player: p.info() });
  }

  private freeSlot(): number {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let i = 0; i < this.options.maxPlayers; i++) if (!used.has(i)) return i;
    return -1;
  }

  // ---------------------------------------------------------------- time

  /** Call often (every 100 ms or so): pauses silent players and drops expired ones. */
  tick(): void {
    const t = this.now();
    for (const p of [...this.players.values()]) {
      if (!p.link && t - p.disconnectedAt > this.grace) {
        this.players.delete(p.id);
        this.options.log?.(`leave ${p.id} slot ${p.slot + 1}`);
        this.broadcast({ type: "leave", id: p.id });
        continue;
      }
      if (p.state === "active" && t - p.lastPoseAt > this.pauseAfter) {
        this.releaseButtons(p);
        this.setState(p, "paused");
      }
    }
  }

  /** Call once a second: pings phones and sends stats. */
  second(): void {
    const t = this.now();
    for (const p of this.players.values()) {
      if (!p.link) continue;
      const n = ++p.pingN;
      p.pingSent.set(n, t);
      for (const k of p.pingSent.keys()) if (k < n - 5) p.pingSent.delete(k);
      p.link.send({ type: "ping", n });
      this.broadcast({ type: "stats", id: p.id, rtt: Math.round(p.rtt * 10) / 10, rate: p.poses, dropped: p.dropped });
      p.poses = 0;
      p.dropped = 0;
    }
  }

  /** Snapshot for the status endpoint. */
  status() {
    return {
      protocol: PROTOCOL_VERSION,
      relay: this.options.version,
      joinUrl: this.options.joinUrl,
      maxPlayers: this.options.maxPlayers,
      apps: this.apps.size,
      players: [...this.players.values()].map((p) => ({ ...p.info(), rtt: p.rtt, connected: !!p.link })),
    };
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && isFinite(x));
}

function isQuat(q: unknown): q is Quat {
  return Array.isArray(q) && q.length === 4 && q.every((v) => typeof v === "number" && isFinite(v));
}

function cleanName(name: string): string {
  return name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24);
}
