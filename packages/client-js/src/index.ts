// Phone Wand client for JavaScript and TypeScript, in browsers and Node 22+ (or Bun, or Deno).
// Connects to a running relay and tracks every player's pose and buttons.
//
//   import { PhoneWand } from "phone-wand";
//   const wand = new PhoneWand();
//   wand.on("pose", (pose, player) => draw(player.colour, pose.screen));
//   wand.on("button", (e, player) => { if (e.button === "primary" && e.down) fire(player); });

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Calibration = "none" | "ray" | "screen";
/** A button's id: "primary" and "secondary" by default, or the ids in your layout. */
export type ButtonName = string;

export type Template = "primary" | "primary-secondary" | "pair" | "primary-row" | "grid";
export type ControlValue = boolean | number | string;
export type Control =
  | { id: string; type: "button"; label?: string; colour?: string }
  | { id: string; type: "toggle"; label?: string; colour?: string; value?: boolean }
  | { id: string; type: "slider"; label?: string; colour?: string; value?: number; orientation?: "horizontal" | "vertical"; spring?: number | null }
  | { id: string; type: "choice"; label?: string; colour?: string; options: string[]; value?: number }
  | { id: string; type: "label"; label?: string; colour?: string; text?: string };
export interface Layout {
  template: Template;
  controls: Control[];
}

export interface PlayerInfo {
  id: string;
  slot: number;
  name: string;
  colour: string;
  label: string;
  state: "waiting" | "active" | "paused";
  calibration: Calibration;
  device: { platform: string; sensor: string; transport: "ws" | "http" };
  /** The controls this player's phone shows. */
  layout: Layout;
  /** Current values of the layout's toggles, sliders, choices and labels, by control id. */
  controls: Record<string, ControlValue>;
}

export interface Pose {
  id: string;
  seq: number;
  /** Relay receive time, ms since the Unix epoch. */
  t: number;
  /** Orientation in the rig frame [x, y, z, w]. */
  q: Quat;
  yaw: number;
  pitch: number;
  roll: number;
  /** Unit pointing direction [right, up, forward]. */
  dir: Vec3;
  /** Normalised screen position ([0,0] top-left, [1,1] bottom-right), or null. */
  screen: [number, number] | null;
}

export interface ButtonEvent { id: string; button: ButtonName; down: boolean }
export interface ControlEvent { id: string; control: string; value: ControlValue }
export interface Stats { id: string; rtt: number; rate: number; dropped: number }
export interface Smoothing { minCutoff: number; beta: number; dCutoff: number }

export interface Hello {
  protocol: number;
  relay: string;
  joinUrl: string;
  qrUrl: string;
  maxPlayers: number;
}

/** Everything known about one player. */
export interface Player extends PlayerInfo {
  pose: Pose | null;
  buttons: Set<ButtonName>;
  stats: Stats | null;
  /** Current corner being calibrated, if any. */
  calibrating: "top-left" | "bottom-right" | null;
}

export interface PhoneWandEvents {
  connected: [hello: Hello];
  disconnected: [];
  join: [player: Player];
  leave: [player: Player];
  player: [player: Player];
  pose: [pose: Pose, player: Player];
  button: [event: ButtonEvent, player: Player];
  control: [event: ControlEvent, player: Player];
  /** The relay could not use something this app sent; the message says why. */
  error: [message: string];
  calibrating: [step: "top-left" | "bottom-right" | "cancelled", player: Player];
  calibrated: [calibration: Calibration, player: Player];
  stats: [stats: Stats, player: Player];
}

export interface PhoneWandOptions {
  /** Relay app endpoint. Default ws://127.0.0.1:8480/app. */
  url?: string;
  /** Reconnect automatically when the relay goes away. Default true. */
  reconnect?: boolean;
  /** Smoothing for this app's poses, or false for raw. Default: the relay's default. */
  smoothing?: Partial<Smoothing> | false;
  /** Connect in the constructor. Default true. */
  autoConnect?: boolean;
}

export const PROTOCOL_VERSION = 0;
export const DEFAULT_URL = "ws://127.0.0.1:8480/app";

type Listener<A extends unknown[]> = (...args: A) => void;

export class PhoneWand {
  /** Players by id. */
  readonly players = new Map<string, Player>();
  /** The relay's hello, once connected. */
  hello: Hello | null = null;
  readonly url: string;

  private ws: WebSocket | null = null;
  private listeners = new Map<keyof PhoneWandEvents, Set<Listener<any>>>();
  private closed = false;
  private retry = 500;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: PhoneWandOptions = {}) {
    this.url = options.url ?? DEFAULT_URL;
    if (options.autoConnect !== false) this.connect();
  }

  get connected(): boolean {
    return this.hello !== null;
  }

  /** Players sorted by slot. */
  get list(): Player[] {
    return [...this.players.values()].sort((a, b) => a.slot - b.slot);
  }

  on<K extends keyof PhoneWandEvents>(event: K, fn: Listener<PhoneWandEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => this.off(event, fn);
  }

  off<K extends keyof PhoneWandEvents>(event: K, fn: Listener<PhoneWandEvents[K]>): void {
    this.listeners.get(event)?.delete(fn);
  }

  connect(): void {
    this.closed = false;
    if (this.ws) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 500;
      if (this.options.smoothing !== undefined) this.configure({ smoothing: this.options.smoothing });
    };
    ws.onmessage = (e) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof e.data === "string" ? e.data : String(e.data));
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      const was = this.hello !== null;
      this.hello = null;
      for (const p of this.players.values()) this.emit("leave", p);
      this.players.clear();
      if (was) this.emit("disconnected");
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows and handles it
    };
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close();
  }

  // ---------------------------------------------------------------- app -> relay

  configure(options: { smoothing?: Partial<Smoothing> | false }): void {
    this.send({ type: "configure", ...options });
  }

  style(id: string, style: { colour?: string; label?: string }): void {
    this.send({ type: "style", id, ...style });
  }

  /** Show text on a phone (or every phone when id is omitted). duration 0 keeps it up. */
  prompt(text: string, options: { id?: string; duration?: number } = {}): void {
    this.send({ type: "prompt", text, ...options });
  }

  /** Vibrate (Android only). pattern alternates on and off milliseconds. */
  haptic(pattern: number[] | number, options: { id?: string } = {}): void {
    this.send({ type: "haptic", pattern: Array.isArray(pattern) ? pattern : [pattern], ...options });
  }

  calibrate(mode: "screen" | "ray" = "screen", options: { id?: string } = {}): void {
    this.send({ type: "calibrate", mode, ...options });
  }

  /**
   * Choose the controls a phone shows (or every phone when id is omitted); null goes back to the
   * default Primary and Secondary. See docs/layouts.md.
   */
  layout(layout: Layout | null, options: { id?: string } = {}): void {
    this.send({ type: "layout", layout, ...options });
  }

  /** Change a toggle, slider or choice's value, or a label's text, on a phone (or every phone). */
  set(control: string, value: ControlValue, options: { id?: string } = {}): void {
    this.send({ type: "set", control, value, ...options });
  }

  private send(msg: object): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  // ---------------------------------------------------------------- relay -> app

  private emit<K extends keyof PhoneWandEvents>(event: K, ...args: PhoneWandEvents[K]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        fn(...args);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private upsert(info: PlayerInfo): Player {
    let p = this.players.get(info.id);
    if (!p) {
      p = { ...info, pose: null, buttons: new Set(), stats: null, calibrating: null };
      this.players.set(info.id, p);
    } else {
      Object.assign(p, info);
    }
    return p;
  }

  /** Handle one decoded relay message. Public so recorded sessions can be replayed through it. */
  handle(msg: any): void {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "hello": {
        const { type: _t, players, ...hello } = msg;
        this.hello = hello;
        this.emit("connected", hello);
        for (const info of players ?? []) this.emit("join", this.upsert(info));
        break;
      }
      case "join":
        this.emit("join", this.upsert(msg.player));
        break;
      case "player": {
        const p = this.upsert(msg.player);
        if (p.state !== "active") p.buttons.clear();
        this.emit("player", p);
        break;
      }
      case "leave": {
        const p = this.players.get(msg.id);
        if (!p) return;
        this.players.delete(msg.id);
        this.emit("leave", p);
        break;
      }
      case "pose": {
        const p = this.players.get(msg.id);
        if (!p) return;
        const { type: _t, ...pose } = msg;
        p.pose = pose;
        this.emit("pose", pose, p);
        break;
      }
      case "button": {
        const p = this.players.get(msg.id);
        if (!p) return;
        if (msg.down) p.buttons.add(msg.button);
        else p.buttons.delete(msg.button);
        this.emit("button", { id: msg.id, button: msg.button, down: !!msg.down }, p);
        break;
      }
      case "control": {
        const p = this.players.get(msg.id);
        if (!p) return;
        p.controls = { ...p.controls, [msg.control]: msg.value };
        this.emit("control", { id: msg.id, control: msg.control, value: msg.value }, p);
        break;
      }
      case "error":
        if (this.listeners.get("error")?.size) this.emit("error", String(msg.message));
        else console.warn(`phone-wand: ${msg.message}`);
        break;
      case "calibrating": {
        const p = this.players.get(msg.id);
        if (!p) return;
        p.calibrating = msg.step === "cancelled" ? null : msg.step;
        this.emit("calibrating", msg.step, p);
        break;
      }
      case "calibrated": {
        const p = this.players.get(msg.id);
        if (!p) return;
        p.calibration = msg.calibration;
        p.calibrating = null;
        this.emit("calibrated", msg.calibration, p);
        break;
      }
      case "stats": {
        const p = this.players.get(msg.id);
        if (!p) return;
        const { type: _t, ...stats } = msg;
        p.stats = stats;
        this.emit("stats", stats, p);
        break;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.options.reconnect === false || this.closed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retry);
    this.retry = Math.min(this.retry * 2, 5000);
  }
}

// ---------------------------------------------------------------- helpers

/** Normalised screen position to pixels. Returns null when there is no position. */
export function toPixels(screen: [number, number] | null, width: number, height: number): [number, number] | null {
  return screen ? [screen[0] * width, screen[1] * height] : null;
}

/** Rig direction to a right-handed, -z forward frame (Three.js, Babylon right-handed, WebXR). */
export function toRightHanded(dir: Vec3): Vec3 {
  return [dir[0], dir[1], -dir[2]];
}

/** Rig quaternion to a right-handed, -z forward frame (Three.js and friends). */
export function quatToRightHanded(q: Quat): Quat {
  return [-q[0], -q[1], q[2], q[3]];
}
