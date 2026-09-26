// Gestures from phone movement: quick pushes and pulls, sideways and up-and-down flicks, shakes
// and wrist twists. The phone reports its acceleration (gravity removed); the relay turns it into
// the calibrated rig frame, so "pull" is always towards the player, and runs one detector per
// player per app, since each app can choose its own sensitivity. See docs/gestures.md.
//
// A phone measures acceleration, not position, so this finds deliberate movements, not distances.
// A flick is a burst of acceleration: speeding up in one direction, then slowing down. Integrating
// the acceleration over the burst gives the velocity, whose largest value points the way the phone
// moved. Many reversals within one burst make a shake.

import { type Vec3, round } from "./math.js";

export type GestureName =
  | "push" | "pull" | "left" | "right" | "up" | "down" | "shake" | "twist-left" | "twist-right";

export interface Gesture {
  gesture: GestureName;
  /** 0 to 1: how vigorous, relative to a strong flick (or shake, or twist). */
  strength: number;
  /** Peak speed of the movement in m/s (movements and shakes; 0 for twists). */
  speed: number;
  /** Unit direction of the movement [right, up, forward] (movements only; zeros otherwise). */
  dir: Vec3;
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
  /** Roll rate (degrees per second) that makes a twist. */
  twistRate: number;
}

export const DEFAULT_GESTURES: GestureOptions = { threshold: 7, minSpeed: 0.35, twistRate: 360 };

/** Movements must mostly go one way: the main axis carries at least this share of the speed (within about 40 degrees). */
const DOMINANCE = 0.75;
/** A burst ends when acceleration stays below this share of the threshold for END_HOLD ms. */
const END_SHARE = 0.4;
const END_HOLD = 70;
/** Longer bursts without enough reversals are sustained movement (walking, turning): ignored. */
const MAX_FLICK = 600;
const MAX_SHAKE = 3000;
/** Strong reversals within one burst that make a shake. */
const SHAKE_REVERSALS = 4;
/** Nothing new for this long after a gesture, so its own wobble isn't read as another. */
const COOLDOWN = 250;
/** Speeds (m/s) and roll (degrees) counted as full strength. */
const STRONG_SPEED = 2.5;
const STRONG_TWIST = 120;

const AXES: [GestureName, GestureName][] = [["right", "left"], ["up", "down"], ["push", "pull"]];

export class GestureDetector {
  options: GestureOptions;
  private burst: {
    start: number;
    /** Last time acceleration was above END_SHARE of the threshold: the burst is still going. */
    lastActive: number;
    v: Vec3;
    peak: Vec3;
    peakSpeed: number;
    reversals: number;
    sign: number;
    axis: number;
  } | null = null;
  private lastT = -1;
  private cooldownUntil = -Infinity;
  private twist: { start: number; roll: number; lastRoll: number; dir: number } | null = null;
  private lastRoll: number | null = null;

  constructor(options: Partial<GestureOptions> = {}) {
    this.options = { ...DEFAULT_GESTURES, ...options };
  }

  reset(): void {
    this.burst = null;
    this.twist = null;
    this.lastT = -1;
    this.lastRoll = null;
  }

  /**
   * Feed one sample: acceleration in the rig frame (m/s^2, gravity removed), the calibrated roll in
   * degrees, and the time in ms. Returns any gestures that completed.
   */
  update(accel: Vec3, roll: number, t: number): Gesture[] {
    const out: Gesture[] = [];
    const dt = this.lastT < 0 ? 0 : (t - this.lastT) / 1000;
    this.lastT = t;
    if (!(dt >= 0) || dt > 0.25) {
      // First sample, or a gap (the phone paused): start afresh.
      this.burst = null;
      this.twist = null;
      this.lastRoll = roll;
      return out;
    }
    this.movement(accel, t, dt, out);
    this.rotation(roll, t, dt, out);
    return out;
  }

  private movement(a: Vec3, t: number, dt: number, out: Gesture[]): void {
    const { threshold, minSpeed } = this.options;
    const mag = Math.hypot(a[0], a[1], a[2]);
    if (!this.burst) {
      if (mag < threshold || t < this.cooldownUntil) return;
      this.burst = { start: t, lastActive: t, v: [0, 0, 0], peak: [0, 0, 0], peakSpeed: 0, reversals: 0, sign: 0, axis: -1 };
    }
    const b = this.burst;
    b.v = [b.v[0] + a[0] * dt, b.v[1] + a[1] * dt, b.v[2] + a[2] * dt];
    const speed = Math.hypot(b.v[0], b.v[1], b.v[2]);
    if (speed > b.peakSpeed) {
      b.peakSpeed = speed;
      b.peak = [...b.v];
    }
    if (mag >= threshold * END_SHARE) b.lastActive = t;
    if (mag >= threshold) {
      // Count reversals of strong acceleration along its main axis.
      const axis = mainAxis(a);
      const sign = Math.sign(a[axis]);
      if (b.axis === axis && b.sign !== 0 && sign !== b.sign) b.reversals++;
      b.axis = axis;
      b.sign = sign;
    }

    const age = t - b.start;
    const ended = t - b.lastActive >= END_HOLD;
    if (b.reversals >= SHAKE_REVERSALS && (ended || age > MAX_SHAKE)) {
      out.push({
        gesture: "shake", strength: clamp01(b.peakSpeed / STRONG_SPEED), speed: round(b.peakSpeed, 3),
        dir: [0, 0, 0], duration: Math.round(age), t: round(b.start, 1),
      });
      this.finish(t);
      return;
    }
    if (!ended) {
      if (age > MAX_SHAKE) this.finish(t);
      return;
    }
    // A flick: one clear direction, fast enough, short enough, and not a half-finished shake.
    const s = b.peakSpeed;
    const axis = mainAxis(b.peak);
    if (age <= MAX_FLICK && b.reversals < SHAKE_REVERSALS && s >= minSpeed && Math.abs(b.peak[axis]) >= DOMINANCE * s) {
      out.push({
        gesture: AXES[axis][b.peak[axis] > 0 ? 0 : 1],
        strength: clamp01(s / STRONG_SPEED),
        speed: round(s, 3),
        dir: b.peak.map((x) => round(x / s, 4)) as Vec3,
        duration: Math.round(age),
        t: round(b.start, 1),
      });
      this.finish(t);
    } else {
      this.burst = null;
    }
  }

  private rotation(roll: number, t: number, dt: number, out: Gesture[]): void {
    const last = this.lastRoll;
    this.lastRoll = roll;
    if (last === null || dt <= 0) return;
    let d = roll - last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    const rate = d / dt;
    const { twistRate } = this.options;
    if (!this.twist) {
      if (Math.abs(rate) < twistRate || t < this.cooldownUntil) return;
      this.twist = { start: t, roll: 0, lastRoll: roll, dir: Math.sign(rate) };
    }
    const tw = this.twist;
    tw.roll += d;
    if (Math.sign(rate) === tw.dir && Math.abs(rate) >= twistRate * 0.3) {
      if (t - tw.start > 500) this.twist = null; // a slow roll, not a twist
      return;
    }
    // The twist slowed or reversed: it's over. Count it if it turned far enough.
    if (Math.abs(tw.roll) >= 40) {
      out.push({
        gesture: tw.roll > 0 ? "twist-right" : "twist-left",
        strength: clamp01(Math.abs(tw.roll) / STRONG_TWIST),
        speed: 0, dir: [0, 0, 0], duration: Math.round(t - tw.start), t: round(tw.start, 1),
      });
      this.cooldownUntil = t + COOLDOWN;
      this.burst = null; // a twist shakes the phone too; don't also call that a flick
    }
    this.twist = null;
  }

  private finish(t: number): void {
    this.burst = null;
    this.cooldownUntil = t + COOLDOWN;
  }
}

function mainAxis(v: Vec3): number {
  const x = Math.abs(v[0]), y = Math.abs(v[1]), z = Math.abs(v[2]);
  return x >= y && x >= z ? 0 : y >= z ? 1 : 2;
}

function clamp01(x: number): number {
  return round(Math.min(1, Math.max(0, x)), 3);
}
