// Frame conversions between the phone's sensor world and the rig frame.
//
// The phone reports a quaternion that rotates DEVICE vectors (x right edge, y top edge, z out of the
// screen; W3C DeviceOrientation) into its sensor WORLD (x east-ish, y north-ish, z up; right-handed,
// with an arbitrary heading because the orientation is gyro-relative).
//
// The rig frame is [right, up, forward]. The phone BODY frame uses the same names: right = device x,
// up = device z (out of the screen), forward = device y (the pointing direction). Both mappings are
// the same axis swap M (y <-> z), which is a reflection, so conjugating a rotation by it negates the
// vector part after swapping: q_rig = (-x, -z, -y, w). See docs/protocol.md for the full derivation.

import { type Quat, type Vec3, DEG, RAD, qaxis, qconj, qmul, qnormalize, qrotate } from "./math.js";

/** Convert a sensor-world device quaternion into the (uncalibrated) rig frame. */
export function sensorToRig(q: Quat): Quat {
  return qnormalize([-q[0], -q[2], -q[1], q[3]]);
}

/**
 * W3C DeviceOrientation Euler angles (degrees) to a device-to-world quaternion.
 * The spec's rotation order is intrinsic Z (alpha), X' (beta), Y'' (gamma).
 */
export function eulerToQuat(alpha: number, beta: number, gamma: number): Quat {
  const x = beta * RAD, y = gamma * RAD, z = alpha * RAD;
  const cX = Math.cos(x / 2), cY = Math.cos(y / 2), cZ = Math.cos(z / 2);
  const sX = Math.sin(x / 2), sY = Math.sin(y / 2), sZ = Math.sin(z / 2);
  return [
    sX * cY * cZ - cX * sY * sZ,
    cX * sY * cZ + sX * cY * sZ,
    cX * cY * sZ + sX * sY * cZ,
    cX * cY * cZ - sX * sY * sZ,
  ];
}

export const FORWARD: Vec3 = [0, 0, 1];
export const UP: Vec3 = [0, 1, 0];
export const RIGHT: Vec3 = [1, 0, 0];

/** Pointing direction of a rig-frame body quaternion. */
export function direction(q: Quat): Vec3 {
  return qrotate(q, FORWARD);
}

/** Yaw (positive right) and pitch (positive up) of a direction, in degrees. */
export function yawPitch(d: Vec3): { yaw: number; pitch: number } {
  return {
    yaw: Math.atan2(d[0], d[2]) * DEG,
    pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])) * DEG,
  };
}

/** The rotation that turns FORWARD into the given yaw and pitch (degrees), with no roll. */
export function yawPitchQuat(yaw: number, pitch: number): Quat {
  // Positive rotation about +y turns forward to the right; positive rotation about +x turns
  // forward downwards, so pitching up is a negative x rotation.
  return qmul(qaxis(UP, yaw * RAD), qaxis(RIGHT, -pitch * RAD));
}

/** Roll in degrees, positive when the phone turns clockwise seen from behind (right edge down). */
export function rollOf(q: Quat, yaw: number, pitch: number): number {
  const r = qmul(qconj(yawPitchQuat(yaw, pitch)), q);
  // What remains is a rotation about forward (z). Positive z rotation lifts the right edge.
  let angle = 2 * Math.atan2(r[2], r[3]) * DEG;
  if (angle > 180) angle -= 360;
  if (angle < -180) angle += 360;
  return -angle;
}

/**
 * How well a phone's reported gravity matches its orientation: +1 when the motion data follows the
 * standard (a phone lying flat reports +9.8 on z), -1 when every axis is flipped (Safari and Chrome
 * on iPhone). q is the device-to-world orientation, g the acceleration including gravity in the
 * phone's own axes. Null when the phone is moving too much to tell.
 */
export function gravityAgreement(q: Quat, g: Vec3): number | null {
  const len = Math.hypot(g[0], g[1], g[2]);
  if (len < 8 || len > 11.5) return null;
  const up = qrotate(qconj(q), [0, 0, 1]); // the world's up, in the phone's axes
  return (g[0] * up[0] + g[1] * up[1] + g[2] * up[2]) / len;
}
