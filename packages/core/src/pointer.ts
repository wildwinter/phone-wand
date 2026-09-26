// Turns a phone's raw orientation into what apps want: a calibrated orientation, a ray and a
// flat-screen cursor. One PointerCalibration per player (held by the relay); one PoseSmoother per
// player per app, since each app can choose its own smoothing.

import { type Quat, type Vec3, IDENTITY, RAD, qconj, qdot, qmul, qnormalize, qrotate, round, vnormalize } from "./math.js";
import { direction, rollOf, sensorToRig, yawPitch, yawPitchQuat } from "./frames.js";
import { DEFAULT_SMOOTHING, OneEuroFilter, type SmoothingOptions } from "./one-euro.js";

export type CalibrationKind = "none" | "ray" | "screen";

/**
 * A screen rectangle on the plane one unit in front of the player, perpendicular to forward:
 * a direction d lands at (d.right / d.forward, d.up / d.forward). `top` > `bottom`.
 */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The default virtual screen: 40 degrees wide, 16:9, centred on forward. */
export const DEFAULT_SCREEN: ScreenRect = (() => {
  const hx = Math.tan(20 * RAD);
  const hy = (hx * 9) / 16;
  return { left: -hx, top: hy, right: hx, bottom: -hy };
})();

/** Directions closer than this to perpendicular to forward have no screen position. */
const MIN_FORWARD = 0.05;

export interface DerivedPose {
  q: Quat;
  yaw: number;
  pitch: number;
  roll: number;
  dir: Vec3;
  screen: [number, number] | null;
}

export class PointerCalibration {
  kind: CalibrationKind = "none";
  /** Rotation from the rig frame's forward to the player's chosen forward. */
  reference: Quat = IDENTITY;
  screen: ScreenRect = { ...DEFAULT_SCREEN };
  private topLeft: Vec3 | null = null;
  private hasReference = false;

  /** Convert a raw sensor quaternion to the calibrated rig frame. */
  calibrate(sensorQ: Quat): Quat {
    const rig = sensorToRig(sensorQ);
    if (!this.hasReference) this.setForward(rig, false);
    return qnormalize(qmul(qconj(this.reference), rig));
  }

  /**
   * Make the current pointing direction the new forward. With a calibrated screen this means
   * "I am pointing at the middle of the screen", so the screen keeps its size and is re-centred.
   */
  recentre(sensorQ: Quat): void {
    this.setForward(sensorToRig(sensorQ), true);
    if (this.kind === "screen") {
      const cx = (this.screen.left + this.screen.right) / 2;
      const cy = (this.screen.top + this.screen.bottom) / 2;
      this.screen = {
        left: this.screen.left - cx, right: this.screen.right - cx,
        top: this.screen.top - cy, bottom: this.screen.bottom - cy,
      };
    } else {
      this.kind = "ray";
    }
  }

  /** First corner of screen calibration. */
  cornerTopLeft(sensorQ: Quat): void {
    this.topLeft = direction(sensorToRig(sensorQ));
  }

  /** Second corner. Returns false (and changes nothing) if the two corners make no sensible screen. */
  cornerBottomRight(sensorQ: Quat): boolean {
    if (!this.topLeft) return false;
    const tl = this.topLeft;
    const br = direction(sensorToRig(sensorQ));
    this.topLeft = null;
    // Forward is halfway between the corners.
    const mid = vnormalize([tl[0] + br[0], tl[1] + br[1], tl[2] + br[2]]);
    const { yaw, pitch } = yawPitch(mid);
    const reference = yawPitchQuat(yaw, pitch);
    const inv = qconj(reference);
    const p = (d: Vec3) => {
      const c = qrotate(inv, d);
      return c[2] > MIN_FORWARD ? [c[0] / c[2], c[1] / c[2]] : null;
    };
    const a = p(tl), b = p(br);
    if (!a || !b) return false;
    const [left, top] = a;
    const [right, bottom] = b;
    // Corners must be the right way round and at least a couple of degrees apart.
    const minSpan = Math.tan(2 * RAD);
    if (right - left < minSpan || top - bottom < minSpan) return false;
    this.reference = reference;
    this.hasReference = true;
    this.screen = { left, top, right, bottom };
    this.kind = "screen";
    return true;
  }

  cancelCorners(): void {
    this.topLeft = null;
  }

  private setForward(rig: Quat, explicit: boolean): void {
    const { yaw, pitch } = yawPitch(direction(rig));
    // Before anyone has pressed Recentre, only take the heading: gravity already gives a good
    // horizon, and a player who starts with the phone tilted should not get a tilted forward.
    this.reference = yawPitchQuat(yaw, explicit ? pitch : 0);
    this.hasReference = true;
  }
}

/** Everything an app sees, from a calibrated quaternion and a screen rectangle. */
export function derivePose(q: Quat, screen: ScreenRect): DerivedPose {
  const d = direction(q);
  const { yaw, pitch } = yawPitch(d);
  const roll = rollOf(q, yaw, pitch);
  let pos: [number, number] | null = null;
  if (d[2] > MIN_FORWARD) {
    const px = d[0] / d[2], py = d[1] / d[2];
    pos = [
      round((px - screen.left) / (screen.right - screen.left)),
      round((py - screen.top) / (screen.bottom - screen.top)),
    ];
  }
  return {
    q: q.map((v) => round(v)) as Quat,
    yaw: round(yaw, 3),
    pitch: round(pitch, 3),
    roll: round(roll, 3),
    dir: d.map((v) => round(v)) as Vec3,
    screen: pos,
  };
}

/** Per-app smoothing of a player's calibrated quaternion. */
export class PoseSmoother {
  private filter: OneEuroFilter | null;
  private last: Quat | null = null;

  constructor(options: SmoothingOptions | false = DEFAULT_SMOOTHING) {
    this.filter = options ? new OneEuroFilter({ ...options }) : null;
  }

  setOptions(options: SmoothingOptions | false): void {
    this.filter = options ? new OneEuroFilter({ ...options }) : null;
    this.last = null;
  }

  reset(): void {
    this.filter?.reset();
    this.last = null;
  }

  smooth(q: Quat, t: number): Quat {
    // q and -q are the same rotation; keep consecutive samples in the same hemisphere so the
    // filter does not average across the flip.
    if (this.last && qdot(this.last, q) < 0) q = [-q[0], -q[1], -q[2], -q[3]];
    this.last = q;
    if (!this.filter) return q;
    return qnormalize(this.filter.filter(q, t) as Quat);
  }
}
