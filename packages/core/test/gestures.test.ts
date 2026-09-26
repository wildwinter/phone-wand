import { describe, expect, test } from "bun:test";
import {
  GestureDetector, type Gesture, type GestureName, type Quat, type Vec3,
  RAD, angularVelocity, qaxis, qmul, yawPitchQuat,
} from "../src/index.js";

const RATE = 60;
const STILL: Vec3 = [0, 0, 0];

/** An orientation from yaw, pitch and roll in degrees (roll positive: right edge down). */
function orient(yaw: number, pitch: number, roll = 0): Quat {
  return qmul(yawPitchQuat(yaw, pitch), qaxis([0, 0, 1], -roll * RAD));
}

/** Run samples at 60 Hz for `seconds`: motion(t) gives the acceleration and orientation at t seconds. */
function run(seconds: number, motion: (t: number) => { a?: Vec3 | null; q?: Quat }): Gesture[] {
  const d = new GestureDetector();
  const out: Gesture[] = [];
  for (let i = 0; i <= seconds * RATE; i++) {
    const t = i / RATE;
    const m = motion(t);
    out.push(...d.update(m.a === undefined ? STILL : m.a, m.q ?? orient(0, 0), 1000 + t * 1000));
  }
  return out;
}

/** A flick along an axis: speed up, then slow down. `stop` > 1 makes the stop harder than the start. */
function flick(axis: number, sign: number, peak = 20, ms = 200, start = 0.2, stop = 1) {
  return (t: number): { a: Vec3 } => {
    const u = (t - start) / (ms / 1000);
    let v = u >= 0 && u <= 1 ? sign * peak * Math.sin(2 * Math.PI * u) : 0;
    if (u > 0.5 && u <= 1) v *= stop;
    const a: Vec3 = [0, 0, 0];
    a[axis] = v;
    return { a };
  };
}

/** Turn smoothly from `from` to `to` (yaw, pitch, roll) between start and start + ms. */
function rotate(from: [number, number, number], to: [number, number, number], ms: number, start = 0.2) {
  return (t: number): { q: Quat } => {
    const u = Math.min(1, Math.max(0, (t - start) / (ms / 1000)));
    const e = (1 - Math.cos(Math.PI * u)) / 2; // ease in and out, like a real wrist
    return { q: orient(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, from[2] + (to[2] - from[2]) * e) };
  };
}

describe("movements", () => {
  const cases: [number, number, GestureName][] = [
    [2, 1, "push"], [2, -1, "pull"], [0, 1, "right"], [0, -1, "left"], [1, 1, "up"], [1, -1, "down"],
  ];
  for (const [axis, sign, name] of cases) {
    test(name, () => {
      const g = run(1, flick(axis, sign));
      expect(g.map((x) => x.gesture)).toEqual([name]);
      expect(g[0].speed).toBeGreaterThan(1);
      expect(Math.abs(g[0].dir[axis])).toBeGreaterThan(0.9);
    });
  }

  test("a flick that starts gently and stops hard still reads the right way", () => {
    // A slow, gentle speed-up (5 m/s^2 over 300 ms, under the threshold) and a short, hard stop
    // (15 m/s^2 over 100 ms): the same change of speed each way, as a real flick that ends at rest.
    // Seeing only the hard stop, the old detector called this left flick "right".
    const g = run(1, (t) => {
      const s = t - 0.2;
      const x = s < 0 ? 0 : s < 0.3 ? -5 * Math.sin((Math.PI * s) / 0.3) : s < 0.4 ? 15 * Math.sin((Math.PI * (s - 0.3)) / 0.1) : 0;
      return { a: [x, 0, 0] };
    });
    expect(g.map((x) => x.gesture)).toEqual(["left"]);
  });

  test("a movement with ordinary wrist rotation in it still counts", () => {
    // A push, a pull and a sideways move, each with the wrist turning up to about 180 degrees per
    // second along the way (under the flick rate): real movements, which 0.6.0 threw away.
    const wobble = (axis: number, sign: number) => (t: number) => {
      const u = Math.min(1, Math.max(0, (t - 0.2) / 0.25));
      const yaw = 12 * Math.sin(Math.PI * u);
      const pitch = 6 * Math.sin(2 * Math.PI * u);
      return { a: flick(axis, sign)(t).a, q: orient(yaw, pitch) };
    };
    expect(run(1, wobble(2, 1)).map((x) => x.gesture)).toEqual(["push"]);
    expect(run(1, wobble(2, -1)).map((x) => x.gesture)).toEqual(["pull"]);
    expect(run(1, wobble(0, -1)).map((x) => x.gesture)).toEqual(["left"]);
  });

  test("an even diagonal is not a named movement", () => {
    expect(run(1, (t) => {
      const a = flick(2, 1)(t).a[2];
      return { a: [a, 0, a] };
    })).toEqual([]);
  });

  test("slow movement is ignored", () => {
    expect(run(2, flick(2, 1, 3, 800))).toEqual([]);
  });

  test("shaking is one shake, not a string of flicks", () => {
    const g = run(2, (t) => ({ a: t > 0.2 && t < 1.2 ? [0, 25 * Math.sin(2 * Math.PI * 5 * (t - 0.2)), 0] : STILL }));
    expect(g.map((x) => x.gesture)).toEqual(["shake"]);
  });
});

describe("flicks and twists", () => {
  test("a fast turn upward is flick-up, and only that", () => {
    const g = run(1, rotate([0, 0, 0], [0, 45, 0], 150));
    expect(g.map((x) => x.gesture)).toEqual(["flick-up"]);
    expect(g[0].angle).toBeGreaterThan(30);
  });

  test("flicks each way", () => {
    expect(run(1, rotate([0, 0, 0], [0, -45, 0], 150)).map((x) => x.gesture)).toEqual(["flick-down"]);
    expect(run(1, rotate([0, 0, 0], [45, 0, 0], 150)).map((x) => x.gesture)).toEqual(["flick-right"]);
    expect(run(1, rotate([0, 0, 0], [-45, 0, 0], 150)).map((x) => x.gesture)).toEqual(["flick-left"]);
  });

  test("a fast turn that also swings the phone gives the flick, not a movement", () => {
    // Turning right fast about the wrist: the phone, 15 cm out, is flung sideways and the motion
    // sensor reads that as a strong movement right, then left as it stops.
    const turn = rotate([0, 0, 0], [60, 0, 0], 180);
    const g = run(1, (t) => {
      const u = (t - 0.2) / 0.18;
      const swing = u >= 0 && u <= 1 ? 30 * Math.sin(2 * Math.PI * u) : 0;
      return { a: [swing, 0, 0], q: turn(t).q };
    });
    expect(g.map((x) => x.gesture)).toEqual(["flick-right"]);
  });

  test("a flick up with some roll in it is still a flick, not a twist", () => {
    expect(run(1, rotate([0, 0, 0], [0, 45, 12], 150)).map((x) => x.gesture)).toEqual(["flick-up"]);
  });

  test("a quick wrist roll is a twist, each way", () => {
    expect(run(1, rotate([0, 0, 0], [0, 0, 80], 150)).map((x) => x.gesture)).toEqual(["twist-right"]);
    expect(run(1, rotate([0, 0, 0], [0, 0, -80], 150)).map((x) => x.gesture)).toEqual(["twist-left"]);
  });

  test("slow turning (ordinary aiming) is nothing", () => {
    expect(run(2, rotate([0, 0, 0], [30, 15, 0], 1500))).toEqual([]);
  });

  test("angular velocity is in the phone's own axes", () => {
    const w = angularVelocity(orient(0, 0), orient(10, 0), 0.1);
    expect(Math.round(w[1])).toBe(100); // turning right is positive about up
    const p = angularVelocity(orient(0, 0), orient(0, 10), 0.1);
    expect(Math.round(p[0])).toBe(-100); // pitching up is negative about right
  });
});
