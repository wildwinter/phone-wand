// Silent drift correction from the phone's compass. The gyroscope drives the pointer, smooth and
// quick, but its heading slowly drifts sideways. The compass doesn't drift, but it wobbles and is
// easily disturbed. So the compass is only a slow reference: the gap between the two headings is
// watched, and when it creeps (drift), the heading is turned back, a fraction of a degree at a time.
//
// The compass is used only while it looks trustworthy: accuracy good enough (where the phone says),
// the phone not pointing steeply up or down, and its readings steady for a moment. Otherwise it is
// ignored and the phone behaves as if there were no compass. The player is never asked to do
// anything. Works in the phone's sensor world (W3C: x east-ish, y north-ish, z up); see frames.ts.

import { type Quat, DEG, RAD, qaxis, qmul, qnormalize, qrotate } from "./math.js";

export type CompassState = "helping" | "ignored" | "none";

export interface CompassStatus {
  /** helping: correcting drift now; ignored: readings arrive but aren't trusted; none: no compass. */
  state: CompassState;
  /** Degrees the heading is currently turned by, clockwise seen from above. */
  correction: number;
}

/** Worse iPhone accuracy than this (degrees), or none reported as valid, and the compass is ignored. */
const MAX_ACCURACY = 25;
/** Pointing further up or down than this (degrees), compass headings are unreliable. */
const MAX_PITCH = 60;
/** Readings must stay within this many degrees of each other over STEADY_MS to count. */
const STEADY_SPREAD = 5;
const STEADY_MS = 1500;
/** The correction follows the compass at most this fast (degrees per second). Real drift is slower. */
const FOLLOW_RATE = 0.3;
/** Readings older than this (ms) are stale. */
const FRESH_MS = 250;
/** "helping" for this long (ms) after the last trusted reading. */
const HELPING_MS = 3000;

/** Heading of the phone's top edge (its pointing direction), clockwise from the world's +y, in degrees. */
export function headingOf(q: Quat): { heading: number; pitch: number } {
  const top = qrotate(q, [0, 1, 0]);
  return {
    heading: Math.atan2(top[0], top[1]) * DEG,
    pitch: Math.atan2(top[2], Math.hypot(top[0], top[1])) * DEG,
  };
}

/** An angle in degrees, wrapped to -180 to 180. */
export function wrap(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

export class CompassHelper {
  /** Offset (compass minus gyro heading) when the compass was first trusted. */
  private reference: number | null = null;
  private correction = 0;
  private recent: { t: number; offset: number }[] = [];
  private lastTrusted = -Infinity;
  private lastReading = -Infinity;
  private lastT: number | null = null;
  private compass: { heading: number; accuracy: number | null; t: number } | null = null;

  /**
   * A compass reading: heading clockwise from north in degrees (of the phone's top edge), with the
   * phone's accuracy estimate in degrees if it gives one (negative means not calibrated).
   */
  reading(heading: number, accuracy: number | null, t: number): void {
    this.compass = { heading, accuracy, t };
    this.lastReading = t;
  }

  /** Correct a gyroscope orientation (device to sensor world) at time t, in ms. */
  correct(q: Quat, t: number): Quat {
    const dt = this.lastT === null ? 0 : Math.min(1, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    const c = this.compass;
    if (c && t - c.t <= FRESH_MS) this.consider(q, c, t, dt);
    if (this.correction === 0) return q;
    // Turning the world anticlockwise about up (z) turns headings clockwise... so the other way.
    return qnormalize(qmul(qaxis([0, 0, 1], -this.correction * RAD), q));
  }

  status(t: number): CompassStatus {
    const state: CompassState = t - this.lastTrusted < HELPING_MS ? "helping" : t - this.lastReading < HELPING_MS ? "ignored" : "none";
    return { state, correction: Math.round(this.correction * 10) / 10 };
  }

  private consider(q: Quat, c: { heading: number; accuracy: number | null }, t: number, dt: number): void {
    const { heading, pitch } = headingOf(q);
    const accurate = c.accuracy === null || (c.accuracy >= 0 && c.accuracy <= MAX_ACCURACY);
    if (!accurate || Math.abs(pitch) > MAX_PITCH || !isFinite(c.heading)) {
      this.recent = [];
      return;
    }
    // Keep the offsets as continuous numbers near the reference, so wrapping never makes a jump.
    const near = this.reference ?? 0;
    const offset = near + wrap(c.heading - heading - near);
    this.recent.push({ t, offset });
    while (this.recent.length && t - this.recent[0].t > STEADY_MS) this.recent.shift();
    if (t - this.recent[0].t < STEADY_MS * 0.8) return; // not enough history yet
    const offsets = this.recent.map((r) => r.offset);
    if (Math.max(...offsets) - Math.min(...offsets) > STEADY_SPREAD) return; // moving about: ignore
    const steady = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    this.lastTrusted = t;
    if (this.reference === null) {
      this.reference = steady;
      return;
    }
    // Drift is how far the gap has crept since the reference; follow it, gently.
    const target = steady - this.reference;
    const step = FOLLOW_RATE * dt;
    this.correction += Math.max(-step, Math.min(step, target - this.correction));
  }
}
