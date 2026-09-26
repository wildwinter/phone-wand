// Gestures from phone movement. Two kinds:
//
//   Movements (push, pull, left, right, up, down, shake): the whole phone moves. Found from its
//   acceleration (gravity removed), turned into the calibrated rig frame, so "pull" is always
//   towards the player.
//   Rotations (flick-up, flick-down, flick-left, flick-right, twist-left, twist-right): the phone
//   turns quickly, the way a wrist flick aims the cursor. Found from the orientation itself.
//
// A phone held out in the hand swings around the wrist when it rotates, and its motion sensor reads
// that swing as movement. So a fast rotation suppresses movement gestures: one action, one gesture.
//
// A phone measures acceleration, not position, so movements are found as bursts of acceleration:
// speeding up, then slowing down. Integrating the acceleration over the burst gives the velocity,
// whose largest value points the way the phone moved. The burst includes the gentle start that led
// up to it, so a flick that stops harder than it started still reads the right way. Many reversals
// within one burst make a shake. See docs/gestures.md.

import { type Quat, type Vec3, DEG, qconj, qdot, qmul, round } from "./math.js";

export type GestureName =
  | "push" | "pull" | "left" | "right" | "up" | "down" | "shake"
  | "flick-up" | "flick-down" | "flick-left" | "flick-right"
  | "twist-left" | "twist-right";

export interface Gesture {
  gesture: GestureName;
  /** 0 to 1: how vigorous, relative to a strong movement, shake, flick or twist. */
  strength: number;
  /** Movements and shakes: peak speed in m/s. 0 for rotations. */
  speed: number;
  /** Movements: unit direction [right, up, forward]. Zeros otherwise. */
  dir: Vec3;
  /** Flicks and twists: how far the phone turned, in degrees. 0 for movements. */
  angle: number;
  /** How long the gesture took, in ms. */
  duration: number;
  /** Relay time the gesture started, ms. */
  t: number;
}

export interface GestureOptions {
  /** Acceleration (m/s^2) that starts a movement. Lower is more sensitive. */
  threshold: number;
  /** Peak speed (m/s) a movement must reach to count. */
  minSpeed: number;
  /** Turning speed (degrees per second) that makes a flick. */
  flickRate: number;
  /** Rolling speed (degrees per second) that makes a twist. */
  twistRate: number;
}

export const DEFAULT_GESTURES: GestureOptions = { threshold: 7, minSpeed: 0.35, flickRate: 250, twistRate: 360 };

/** The main axis must carry at least this share of a movement's speed or a rotation's angle. */
const DOMINANCE = 0.75;
/** A movement burst ends when acceleration stays below this share of the threshold for END_HOLD ms. */
const END_SHARE = 0.4;
const END_HOLD = 70;
/** How far back the start of a movement is looked for, and how gentle that start may be. */
const LEAD_IN = 300;
const LEAD_SHARE = 0.2;
/** Quiet samples the look-back may step over (the zero crossing mid-flick). */
const LEAD_GAP = 2;
/** Longer bursts without enough reversals are sustained movement (walking, turning): ignored. */
const MAX_FLICK = 600;
const MAX_SHAKE = 3000;
/** Strong reversals within one burst that make a shake. */
const SHAKE_REVERSALS = 4;
/** Turning faster than this (degrees per second) means movement readings are the swing, not real. */
const SWING = 150;
/** Nothing new for this long after a gesture, so its own wobble isn't read as another. */
const COOLDOWN = 250;
/** Rotation bursts end when turning stays below this share of the lower rate for ROT_HOLD ms. */
const ROT_END_SHARE = 0.3;
const ROT_HOLD = 60;
const MAX_ROTATION = 700;
/** Smallest turn that counts, in degrees. */
const MIN_FLICK_ANGLE = 20;
const MIN_TWIST_ANGLE = 40;
/** Full strength. */
const STRONG_SPEED = 2.5;
const STRONG_FLICK = 90;
const STRONG_TWIST = 120;

const MOVES: [GestureName, GestureName][] = [["right", "left"], ["up", "down"], ["push", "pull"]];

interface Sample {
  a: Vec3;
  dt: number;
  t: number;
  /** Turning speed, degrees per second. */
  turn: number;
}

export class GestureDetector {
  options: GestureOptions;
  private history: Sample[] = [];
  private move: {
    start: number;
    lastActive: number;
    v: Vec3;
    peak: Vec3;
    peakSpeed: number;
    reversals: number;
    sign: number;
    axis: number;
    maxTurn: number;
  } | null = null;
  private turn: { start: number; lastActive: number; angle: Vec3; peakRate: Vec3 } | null = null;
  private lastQ: Quat | null = null;
  private lastT = -1;
  private cooldownUntil = -Infinity;

  constructor(options: Partial<GestureOptions> = {}) {
    this.options = { ...DEFAULT_GESTURES, ...options };
  }

  reset(): void {
    this.move = null;
    this.turn = null;
    this.history = [];
    this.lastQ = null;
    this.lastT = -1;
  }

  /**
   * Feed one sample: acceleration in the rig frame (m/s^2, gravity removed; null if the phone sent
   * none), the calibrated orientation (body to rig), and the time in ms. Returns finished gestures.
   */
  update(accel: Vec3 | null, q: Quat, t: number): Gesture[] {
    const out: Gesture[] = [];
    const dt = this.lastT < 0 ? 0 : (t - this.lastT) / 1000;
    const prevQ = this.lastQ;
    this.lastT = t;
    this.lastQ = q;
    if (!prevQ || !(dt > 0) || dt > 0.25) {
      // First sample, or a gap (the phone paused): start afresh.
      this.move = null;
      this.turn = null;
      this.history = [];
      return out;
    }
    const w = angularVelocity(prevQ, q, dt);
    const turn = Math.hypot(w[0], w[1], w[2]);
    this.rotation(w, turn, dt, t, out);
    if (accel) this.movement(accel, dt, t, turn, out);
    return out;
  }

  // ---------------------------------------------------------------- rotations

  private rotation(w: Vec3, turn: number, dt: number, t: number, out: Gesture[]): void {
    const { flickRate, twistRate } = this.options;
    const start = Math.min(flickRate, twistRate);
    if (!this.turn) {
      if (turn < start || t < this.cooldownUntil) return;
      this.turn = { start: t - dt * 1000, lastActive: t, angle: [0, 0, 0], peakRate: [0, 0, 0] };
    }
    const r = this.turn;
    r.angle = [r.angle[0] + w[0] * dt, r.angle[1] + w[1] * dt, r.angle[2] + w[2] * dt];
    for (let i = 0; i < 3; i++) if (Math.abs(w[i]) > Math.abs(r.peakRate[i])) r.peakRate[i] = w[i];
    if (turn >= start * ROT_END_SHARE) r.lastActive = t;
    const age = t - r.start;
    if (t - r.lastActive < ROT_HOLD && age < MAX_ROTATION) return;

    // Finished: which way did it mostly turn? Body axes: x right (pitch), y up (yaw), z forward (roll).
    this.turn = null;
    const total = Math.hypot(r.angle[0], r.angle[1], r.angle[2]);
    const axis = mainAxis(r.angle);
    if (age >= MAX_ROTATION || Math.abs(r.angle[axis]) < DOMINANCE * total) return;
    const angle = Math.abs(r.angle[axis]);
    const rate = Math.abs(r.peakRate[axis]);
    let gesture: GestureName;
    let strength: number;
    if (axis === 2) {
      if (angle < MIN_TWIST_ANGLE || rate < twistRate) return;
      // Positive rotation about forward lifts the right edge: anticlockwise from behind.
      gesture = r.angle[2] > 0 ? "twist-left" : "twist-right";
      strength = angle / STRONG_TWIST;
    } else {
      if (angle < MIN_FLICK_ANGLE || rate < flickRate) return;
      // Positive rotation about right tips the pointing direction down; about up, to the right.
      gesture = axis === 0 ? (r.angle[0] > 0 ? "flick-down" : "flick-up") : r.angle[1] > 0 ? "flick-right" : "flick-left";
      strength = angle / STRONG_FLICK;
    }
    out.push({
      gesture, strength: clamp01(strength), speed: 0, dir: [0, 0, 0], angle: round(angle, 1),
      duration: Math.round(age), t: round(r.start, 1),
    });
    this.finish(t);
  }

  // ---------------------------------------------------------------- movements

  private movement(a: Vec3, dt: number, t: number, turn: number, out: Gesture[]): void {
    const { threshold, minSpeed } = this.options;
    const mag = magnitude(a);
    this.history.push({ a, dt, t, turn });
    while (this.history.length && t - this.history[0].t > LEAD_IN) this.history.shift();

    if (!this.move) {
      if (mag < threshold || t < this.cooldownUntil || this.turn) return;
      // Start from the gentle beginning: walk back while the acceleration was building, stepping
      // over the moment it passes through zero between speeding up and slowing down.
      let first = this.history.length - 1;
      let quiet = 0;
      for (let i = this.history.length - 2; i >= 0; i--) {
        if (magnitude(this.history[i].a) >= threshold * LEAD_SHARE) {
          first = i;
          quiet = 0;
        } else if (++quiet > LEAD_GAP) break;
      }
      this.move = {
        start: this.history[first].t - this.history[first].dt * 1000, lastActive: t, v: [0, 0, 0],
        peak: [0, 0, 0], peakSpeed: 0, reversals: 0, sign: 0, axis: -1, maxTurn: 0,
      };
      for (let i = first; i < this.history.length - 1; i++) this.integrate(this.history[i], threshold);
    }
    this.integrate(this.history[this.history.length - 1], threshold);

    const m = this.move;
    if (mag >= threshold * END_SHARE) m.lastActive = t;
    const age = t - m.start;
    const ended = t - m.lastActive >= END_HOLD;
    // Turning fast means these readings are the phone swinging around the wrist: not a movement.
    const swung = m.maxTurn > SWING;
    if (m.reversals >= SHAKE_REVERSALS && (ended || age > MAX_SHAKE)) {
      if (!swung) {
        out.push({
          gesture: "shake", strength: clamp01(m.peakSpeed / STRONG_SPEED), speed: round(m.peakSpeed, 3),
          dir: [0, 0, 0], angle: 0, duration: Math.round(age), t: round(m.start, 1),
        });
        this.finish(t);
      } else this.move = null;
      return;
    }
    if (!ended) {
      if (age > MAX_SHAKE) this.move = null;
      return;
    }
    const s = m.peakSpeed;
    const axis = mainAxis(m.peak);
    if (!swung && age <= MAX_FLICK && m.reversals < SHAKE_REVERSALS && s >= minSpeed && Math.abs(m.peak[axis]) >= DOMINANCE * s) {
      out.push({
        gesture: MOVES[axis][m.peak[axis] > 0 ? 0 : 1],
        strength: clamp01(s / STRONG_SPEED),
        speed: round(s, 3),
        dir: m.peak.map((x) => round(x / s, 4)) as Vec3,
        angle: 0,
        duration: Math.round(age),
        t: round(m.start, 1),
      });
      this.finish(t);
    } else {
      this.move = null;
    }
  }

  private integrate(sample: Sample, threshold: number): void {
    const m = this.move!;
    const { a, dt } = sample;
    m.maxTurn = Math.max(m.maxTurn, sample.turn);
    m.v = [m.v[0] + a[0] * dt, m.v[1] + a[1] * dt, m.v[2] + a[2] * dt];
    const speed = magnitude(m.v);
    if (speed > m.peakSpeed) {
      m.peakSpeed = speed;
      m.peak = [...m.v];
    }
    if (magnitude(a) >= threshold) {
      // Count reversals of strong acceleration along its main axis.
      const axis = mainAxis(a);
      const sign = Math.sign(a[axis]);
      if (m.axis === axis && m.sign !== 0 && sign !== m.sign) m.reversals++;
      m.axis = axis;
      m.sign = sign;
    }
  }

  private finish(t: number): void {
    this.move = null;
    this.turn = null;
    this.cooldownUntil = t + COOLDOWN;
  }
}

/**
 * Angular velocity in degrees per second, in the phone's own axes [right, up, forward], from two
 * orientations (body to rig) dt seconds apart.
 */
export function angularVelocity(from: Quat, to: Quat, dt: number): Vec3 {
  let d = qmul(qconj(from), to);
  if (qdot(d, [0, 0, 0, 1]) < 0) d = [-d[0], -d[1], -d[2], -d[3]]; // the short way round
  const s = Math.hypot(d[0], d[1], d[2]);
  if (s < 1e-9 || !(dt > 0)) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, d[3]) * DEG;
  const k = angle / s / dt;
  return [d[0] * k, d[1] * k, d[2] * k];
}

function magnitude(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function mainAxis(v: Vec3): number {
  const x = Math.abs(v[0]), y = Math.abs(v[1]), z = Math.abs(v[2]);
  return x >= y && x >= z ? 0 : y >= z ? 1 : 2;
}

function clamp01(x: number): number {
  return round(Math.min(1, Math.max(0, x)), 3);
}
