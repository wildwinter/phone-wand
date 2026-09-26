// Message types for the Phone Wand protocol, version 0. docs/protocol.md is the specification;
// these types follow it.

import type { Quat, Vec3 } from "./math.js";
import type { CalibrationKind } from "./pointer.js";
import type { SmoothingOptions } from "./one-euro.js";

export const PROTOCOL_VERSION = 0;

export type PlayerState = "waiting" | "active" | "paused";
export type ButtonName = "primary" | "secondary";
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
}
export interface ButtonMessage { type: "button"; id: string; button: ButtonName; down: boolean }
export interface CalibratingMessage { type: "calibrating"; id: string; step: CornerStep | "cancelled" }
export interface CalibratedMessage { type: "calibrated"; id: string; calibration: CalibrationKind }
export interface StatsMessage { type: "stats"; id: string; rtt: number; rate: number; dropped: number }

export type RelayToApp =
  | HelloMessage | JoinMessage | LeaveMessage | PlayerMessage | PoseMessage
  | ButtonMessage | CalibratingMessage | CalibratedMessage | StatsMessage;

// ---- app -> relay ----

export interface ConfigureMessage { type: "configure"; smoothing?: SmoothingOptions | false }
export interface StyleMessage { type: "style"; id: string; colour?: string; label?: string }
export interface PromptMessage { type: "prompt"; id?: string; text: string; duration?: number }
export interface HapticMessage { type: "haptic"; id?: string; pattern: number[] }
export interface CalibrateMessage { type: "calibrate"; id?: string; mode: "screen" | "ray" }

export type AppToRelay = ConfigureMessage | StyleMessage | PromptMessage | HapticMessage | CalibrateMessage;

// ---- phone <-> relay ----

export type PhoneToRelay =
  | { type: "hello"; key: string; token?: string; name: string; platform: string; sensor: SensorKind | "" }
  | { type: "ready"; sensor: SensorKind }
  | { type: "pose"; seq: number; ts: number; q: Quat }
  | { type: "button"; button: ButtonName; down: boolean }
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
  | { type: "ping"; n: number };

/** Slot colours: distinct, readable on dark and light backgrounds. */
export const SLOT_COLOURS = [
  "#ff4d6d", "#2ec4ff", "#ffd23f", "#3ddc84",
  "#b98cff", "#ff8c42", "#f0f0f0", "#00d6b4",
  "#ff7ab6", "#9bd13d", "#6c8cff", "#e0a86c",
];
