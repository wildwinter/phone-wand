// Gestures from phone movement. Two kinds:
//
//   Movements (push, pull, left, right, up, down, shake): the whole phone moves. Found from its
//   acceleration (gravity removed), turned into the calibrated rig frame, so "pull" is always
//   towards the player.
//   Rotations (flick-up, flick-down, flick-left, flick-right, twist-left, twist-right): the phone
//   turns quickly, the way a wrist flick aims the cursor. Found from the orientation itself.
//
// A flick or twist is one fast, far turn about one of the phone's axes, usually followed by a slower
// turn back. Movements wobble the wrist too, but only a little, so the turn must be both far and fast
// on average (not just a brief spike), and the turn back afterwards is ignored.
//
// A phone held out in the hand swings around the wrist when it rotates, and its motion sensor reads
// that swing as movement. So a movement is held back briefly before it's reported, and dropped if a
// flick or twist happened at the same time: one action, one gesture. Ordinary wrist motion during a
// push or a sideways move doesn't make a flick, so those movements still count.
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

/** The main axis must carry at least this share of a movement's speed. */
const DOMINANCE = 0.75;
/** A movement burst ends when acceleration stays below END_ACCEL (m/s^2) for END_HOLD ms. */
const END_ACCEL = 2.8;
const END_HOLD = 70;
/** How far back (ms) the start of a movement is looked for, and how gentle (m/s^2) that start may be. */
const LEAD_IN = 450;
const LEAD_ACCEL = 1.4;
/** Quiet samples the look-back may step over (the zero crossing mid-flick). */
const LEAD_GAP = 2;
/** Longer bursts without enough reversals are sustained movement (walking, turning): ignored. */
const MAX_MOVE = 1600;
const MAX_SHAKE = 3000;
/** Strong reversals within one burst that make a shake. */
const SHAKE_REVERSALS = 4;
/** A movement waits this long (ms) before it's reported, in case a flick or twist overlaps it. */
const HOLD = 120;
/** How close (ms) a rotation gesture must come to a movement to count as the same action. */
const OVERLAP = 250;
/** Nothing new for this long after a gesture, so its own wobble isn't read as another. */
const COOLDOWN = 250;
/** Turning slower than this (degrees per second) is not part of a flick or twist. */
const LOBE_FLOOR = 90;
/** A lobe ends when turning stays under LOBE_FLOOR this long (ms), or turns the other way. */
const LOBE_GAP = 50;
/** Smallest turn that counts, in degrees, and the average speed it must have (degrees per second). */
const MIN_FLICK_ANGLE = 50;
/** A wrist bends down less far than it turns other ways, so a flick down may be smaller. */
const MIN_FLICK_DOWN_ANGLE = 40;
const MIN_TWIST_ANGLE = 60;
const MIN_MEAN_RATE = 240;
/** How long (ms) to wait for a bigger turn about another axis, made at the same time. */
const COLLECT = 100;
const MAX_ROTATION = 700;
/** Turning that starts this soon (ms) after a flick or twist is part of it. */
const QUIET = 150;
/** Turning back the other way this soon (ms) after a flick or twist is the phone coming back. */
const RETURN = 450;
/** Samples closer together than this (ms) are merged: angular speed from them is mostly noise. */
const MIN_DT = 5;
/** Full strength. */
const STRONG_SPEED = 2.5;
const STRONG_FLICK = 90;
const STRONG_TWIST = 120;

const MOVES: [GestureName, GestureName][] = [["right", "left"], ["up", "down"], ["push", "pull"]];

interface Lobe {
  axis: number;
  sign: number;
  start: number;
  /** Time of the last sample in it. */
  last: number;
  /** Degrees turned, signed. */
  angle: number;
  /** Fastest turning in it, degrees per second. */
  peak: number;
  /** Part of a gesture already reported. */
  ignored: boolean;
}

interface Sample {
  a: Vec3;
  dt: number;
  t: number;
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
  } | null = null;
  /** A movement found and waiting out HOLD, in case a rotation gesture overlaps it. */
  private pending: { gesture: Gesture; decidedAt: number; end: number } | null = null;
  /** When the last flick or twist happened, to drop movements that were really its swing. */
  private lastRotation: { start: number; end: number } | null = null;
  private lobes: (Lobe | null)[] = [null, null, null];
  /** The biggest qualifying turn so far, waiting COLLECT ms for a bigger one. */
  private candidate: Lobe | null = null;
  private turnQuietUntil = -Infinity;
  /** The last flick or twist, to ignore the phone being brought back afterwards. */
  private lastTurn: { axis: number; sign: number; end: number } | null = null;
  private lastQ: Quat | null = null;
  private lastT = -1;
  /** No new movement, or no new rotation, until these times (so a gesture's wobble isn't another). */
  private moveCooldownUntil = -Infinity;

  constructor(options: Partial<GestureOptions> = {}) {
    this.options = { ...DEFAULT_GESTURES, ...options };
  }

  reset(): void {
    this.move = null;
    this.lobes = [null, null, null];
    this.candidate = null;
    this.pending = null;
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
    if (this.lastT >= 0 && t >= this.lastT && t - this.lastT < MIN_DT) return out;
    const dt = this.lastT < 0 ? 0 : (t - this.lastT) / 1000;
    const prevQ = this.lastQ;
    this.lastT = t;
    this.lastQ = q;
    if (!prevQ || !(dt > 0) || dt > 0.25) {
      // First sample, or a gap (the phone paused): start afresh.
      this.move = null;
      this.lobes = [null, null, null];
      this.candidate = null;
      this.history = [];
      return out;
    }
    const w = angularVelocity(prevQ, q, dt);
    this.rotation(w, dt, t, out);
    if (accel) this.movement(accel, dt, t);
    // Report a held movement once it has waited, unless a rotation is still under way (it might yet
    // turn out to be a flick that explains the movement).
    const p = this.pending;
    if (p && t - p.decidedAt >= HOLD && (!this.turning() || t - p.decidedAt > MAX_ROTATION)) {
      out.push(p.gesture);
      this.pending = null;
    }
    return out;
  }

  // ---------------------------------------------------------------- rotations

  // Each body axis is followed separately. A lobe is a stretch of turning one way about one axis,
  // faster than LOBE_FLOOR. A wrist flick is one fast lobe (the flick) followed by a slower one the
  // other way (bringing the phone back); a movement's wobble makes only small lobes.
  private rotation(w: Vec3, dt: number, t: number, out: Gesture[]): void {
    for (let k = 0; k < 3; k++) {
      const rate = w[k];
      const sign = Math.abs(rate) >= LOBE_FLOOR ? Math.sign(rate) : 0;
      let l = this.lobes[k];
      if (l && ((sign !== 0 && sign !== l.sign) || (sign === 0 && t - l.last > LOBE_GAP))) {
        this.lobeEnded(l);
        l = this.lobes[k] = null;
      }
      if (sign === 0) continue;
      if (!l) {
        const start = t - dt * 1000;
        // A new lobe during a gesture, or straight after one, is part of it (the phone coming back).
        const r = this.lastTurn;
        const back = !!r && r.axis === k && r.sign !== sign && start < r.end + RETURN;
        const quiet = back || start < this.turnQuietUntil || this.lobes.some((o) => o?.ignored);
        l = this.lobes[k] = { axis: k, sign, start, last: t, angle: 0, peak: 0, ignored: quiet };
      }
      l.angle += rate * dt;
      l.last = t;
      if (Math.abs(rate) > l.peak) l.peak = Math.abs(rate);
    }
    // Decide once the other axes have had a moment to finish a bigger turn made at the same time.
    const c = this.candidate;
    if (!c || t - c.last < COLLECT) return;
    if (this.lobes.some((o) => o && !o.ignored && Math.abs(o.angle) > Math.abs(c.angle) && t - c.last < MAX_ROTATION)) return;
    this.candidate = null;
    const angle = Math.abs(c.angle);
    let gesture: GestureName;
    let strength: number;
    if (c.axis === 2) {
      // Positive rotation about forward lifts the right edge: anticlockwise from behind.
      gesture = c.angle > 0 ? "twist-left" : "twist-right";
      strength = angle / STRONG_TWIST;
    } else {
      // Positive rotation about right tips the pointing direction down; about up, to the right.
      gesture = c.axis === 0 ? (c.angle > 0 ? "flick-down" : "flick-up") : c.angle > 0 ? "flick-right" : "flick-left";
      strength = angle / STRONG_FLICK;
    }
    out.push({
      gesture, strength: clamp01(strength), speed: 0, dir: [0, 0, 0], angle: round(angle, 1),
      duration: Math.round(c.last - c.start), t: round(c.start, 1),
    });
    // Any movement at the same time was the phone swinging around the wrist: drop it.
    this.lastRotation = { start: c.start, end: c.last };
    if (this.pending && this.overlapsRotation(this.pending.gesture.t, this.pending.end)) this.pending = null;
    // Whatever is turning now is the same action: the phone coming back, or wobble.
    for (const o of this.lobes) if (o) o.ignored = true;
    this.turnQuietUntil = c.last + QUIET;
    this.lastTurn = { axis: c.axis, sign: c.sign, end: c.last };
  }

  /** A lobe finished: keep it if it was a fast, far turn, and bigger than any other found with it. */
  private lobeEnded(l: Lobe): void {
    if (l.ignored) return;
    const { flickRate, twistRate } = this.options;
    const angle = Math.abs(l.angle);
    const mean = angle / Math.max(0.001, (l.last - l.start) / 1000);
    const twist = l.axis === 2;
    // Positive rotation about right tips the pointing direction down.
    const least = twist ? MIN_TWIST_ANGLE : l.axis === 0 && l.sign > 0 ? MIN_FLICK_DOWN_ANGLE : MIN_FLICK_ANGLE;
    if (angle < least || l.peak < (twist ? twistRate : flickRate) || mean < MIN_MEAN_RATE) return;
    if (!this.candidate || angle > Math.abs(this.candidate.angle)) this.candidate = l;
  }

  /** A rotation that might still become a flick or twist. */
  private turning(): boolean {
    return !!this.candidate || this.lobes.some((o) => o && !o.ignored && Math.abs(o.angle) >= MIN_FLICK_ANGLE / 2);
  }

  private overlapsRotation(start: number, end: number): boolean {
    const r = this.lastRotation;
    return !!r && start <= r.end + OVERLAP && end >= r.start - OVERLAP;
  }

  // ---------------------------------------------------------------- movements

  private movement(a: Vec3, dt: number, t: number): void {
    const { threshold, minSpeed } = this.options;
    const mag = magnitude(a);
    this.history.push({ a, dt, t });
    while (this.history.length && t - this.history[0].t > LEAD_IN) this.history.shift();

    if (!this.move) {
      if (mag < threshold || t < this.moveCooldownUntil || this.pending) return;
      // Start from the gentle beginning: walk back while the acceleration was building, stepping
      // over the moment it passes through zero between speeding up and slowing down.
      let first = this.history.length - 1;
      let quiet = 0;
      for (let i = this.history.length - 2; i >= 0; i--) {
        if (magnitude(this.history[i].a) >= LEAD_ACCEL) {
          first = i;
          quiet = 0;
        } else if (++quiet > LEAD_GAP) break;
      }
      this.move = {
        start: this.history[first].t - this.history[first].dt * 1000, lastActive: t, v: [0, 0, 0],
        peak: [0, 0, 0], peakSpeed: 0, reversals: 0, sign: 0, axis: -1,
      };
      for (let i = first; i < this.history.length - 1; i++) this.integrate(this.history[i], threshold);
    }
    this.integrate(this.history[this.history.length - 1], threshold);

    const m = this.move;
    if (mag >= END_ACCEL) m.lastActive = t;
    const age = t - m.start;
    const ended = t - m.lastActive >= END_HOLD;
    if (m.reversals >= SHAKE_REVERSALS && (ended || age > MAX_SHAKE)) {
      this.hold({
        gesture: "shake", strength: clamp01(m.peakSpeed / STRONG_SPEED), speed: round(m.peakSpeed, 3),
        dir: [0, 0, 0], angle: 0, duration: Math.round(age), t: round(m.start, 1),
      }, t);
      return;
    }
    if (!ended) {
      if (age > MAX_SHAKE) this.move = null;
      return;
    }
    const s = m.peakSpeed;
    const axis = mainAxis(m.peak);
    if (age <= MAX_MOVE && m.reversals < SHAKE_REVERSALS && s >= minSpeed && Math.abs(m.peak[axis]) >= DOMINANCE * s) {
      this.hold({
        gesture: MOVES[axis][m.peak[axis] > 0 ? 0 : 1],
        strength: clamp01(s / STRONG_SPEED),
        speed: round(s, 3),
        dir: m.peak.map((x) => round(x / s, 4)) as Vec3,
        angle: 0,
        duration: Math.round(age),
        t: round(m.start, 1),
      }, t);
    } else {
      this.move = null;
    }
  }

  /** A movement was found: hold it back briefly, unless a rotation already explains it. */
  private hold(gesture: Gesture, t: number): void {
    const start = this.move!.start;
    this.move = null;
    this.moveCooldownUntil = t + COOLDOWN;
    if (this.overlapsRotation(start, t)) return;
    this.pending = { gesture, decidedAt: t, end: t };
  }

  private integrate(sample: Sample, threshold: number): void {
    const m = this.move!;
    const { a, dt } = sample;
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
