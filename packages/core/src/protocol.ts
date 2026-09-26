// Message types for the Phone Wand protocol, version 0. docs/protocol.md is the specification;
// these types follow it.

import type { Quat, Vec3 } from "./math.js";
import type { CalibrationKind } from "./pointer.js";
import type { SmoothingOptions } from "./one-euro.js";
import type { ControlValue, Layout } from "./layout.js";

export const PROTOCOL_VERSION = 0;

export type PlayerState = "waiting" | "active" | "paused";
/** A button control's id: "primary" and "secondary" by default, or whatever the app's layout says. */
export type ButtonName = string;
export type CornerStep = "top-left" | "bottom-right";
export type Transport = "ws" | "http";
export type SensorKind = "relative-orientation-sensor" | "deviceorientation";

export interface PlayerInfo {
  id: string;
  slot: number;
  name: string;
  colour: string;
  label: string;
  state: PlayerState;
  calibration: CalibrationKind;
  device: { platform: string; sensor: SensorKind | ""; transport: Transport };
  /** The controls the phone shows. */
  layout: Layout;
  /** Current values of the layout's toggles, sliders, choices and labels, by control id. */
  controls: Record<string, ControlValue>;
}

// ---- relay -> app ----

export interface HelloMessage {
  type: "hello";
  protocol: number;
  relay: string;
  joinUrl: string;
  qrUrl: string;
  maxPlayers: number;
  players: PlayerInfo[];
}
export interface JoinMessage { type: "join"; player: PlayerInfo }
export interface LeaveMessage { type: "leave"; id: string }
export interface PlayerMessage { type: "player"; player: PlayerInfo }
export interface PoseMessage {
  type: "pose";
  id: string;
  seq: number;
  t: number;
  q: Quat;
  yaw: number;
  pitch: number;
  roll: number;
  dir: Vec3;
  screen: [number, number] | null;
  /** The phone's acceleration in m/s^2 (gravity removed), [right, up, forward]; when the phone sends it. */
  accel?: Vec3;
}
export interface ButtonMessage { type: "button"; id: string; button: ButtonName; down: boolean }
export interface ControlMessage { type: "control"; id: string; control: string; value: ControlValue }
export interface CalibratingMessage { type: "calibrating"; id: string; step: CornerStep | "cancelled" }
export interface CalibratedMessage { type: "calibrated"; id: string; calibration: CalibrationKind }
export interface StatsMessage { type: "stats"; id: string; rtt: number; rate: number; dropped: number }
export interface GestureMessage {
  type: "gesture";
  id: string;
  gesture: import("./gestures.js").GestureName;
  strength: number;
  speed: number;
  dir: Vec3;
  duration: number;
  /** Relay time the gesture started. */
  t: number;
  /** Button ids that were held when the gesture started. */
  buttons: string[];
}
/** Sent only to the app whose message the relay could not use, saying why. */
export interface ErrorMessage { type: "error"; message: string }

export type RelayToApp =
  | HelloMessage | JoinMessage | LeaveMessage | PlayerMessage | PoseMessage
  | ButtonMessage | ControlMessage | CalibratingMessage | CalibratedMessage | StatsMessage | ErrorMessage | GestureMessage;

// ---- app -> relay ----

export interface ConfigureMessage {
  type: "configure";
  smoothing?: SmoothingOptions | false;
  /** Gesture sensitivity for this app, or false for no gesture events. */
  gestures?: Partial<import("./gestures.js").GestureOptions> | false;
}
export interface StyleMessage { type: "style"; id: string; colour?: string; label?: string }
export interface PromptMessage { type: "prompt"; id?: string; text: string; duration?: number }
export interface HapticMessage { type: "haptic"; id?: string; pattern: number[] }
export interface CalibrateMessage { type: "calibrate"; id?: string; mode: "screen" | "ray" }
/** Set a phone's layout; omit id for every phone. layout null goes back to the default. */
export interface LayoutMessage { type: "layout"; id?: string; layout: Layout | null }
/** Change a control's value (toggle, slider, choice) or a label's text; omit id for every phone. */
export interface SetMessage { type: "set"; id?: string; control: string; value: ControlValue }

export type AppToRelay =
  | ConfigureMessage | StyleMessage | PromptMessage | HapticMessage | CalibrateMessage | LayoutMessage | SetMessage;

// ---- phone <-> relay ----

export type PhoneToRelay =
  | { type: "hello"; key: string; token?: string; name: string; platform: string; sensor: SensorKind | "" }
  | { type: "ready"; sensor: SensorKind }
  | { type: "pose"; seq: number; ts: number; q: Quat; a?: Vec3 }
  | { type: "button"; button: ButtonName; down: boolean }
  | { type: "control"; control: string; value: ControlValue }
  | { type: "recentre" }
  | { type: "corner"; step: CornerStep; q: Quat }
  | { type: "calibrate-start" }
  | { type: "calibrate-cancel" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "name"; name: string }
  | { type: "pong"; n: number; ts: number };

export type RelayToPhone =
  | { type: "welcome"; id: string; token: string; slot: number; name: string; colour: string; label: string; calibration: CalibrationKind }
  | { type: "rejected"; reason: "full" | "bad-key" }
  | { type: "style"; colour: string; label: string }
  | { type: "prompt"; text: string; duration: number }
  | { type: "haptic"; pattern: number[] }
  | { type: "calibrate"; mode: "screen" | "ray" }
  | { type: "calibration"; calibration: CalibrationKind; step?: CornerStep | "done" | "failed"; ok: boolean }
  | { type: "ping"; n: number }
  | { type: "layout"; layout: Layout; values: Record<string, ControlValue> }
  | { type: "set"; control: string; value: ControlValue };

/** Slot colours: distinct, readable on dark and light backgrounds. */
export const SLOT_COLOURS = [
  "#ff4d6d", "#2ec4ff", "#ffd23f", "#3ddc84",
  "#b98cff", "#ff8c42", "#f0f0f0", "#00d6b4",
  "#ff7ab6", "#9bd13d", "#6c8cff", "#e0a86c",
];
