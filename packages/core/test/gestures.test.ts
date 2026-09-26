import { describe, expect, test } from "bun:test";
import { GestureDetector, type Gesture, type GestureName, type Vec3 } from "../src/index.js";

const RATE = 60;

/** Run samples at 60 Hz: accel(t) and roll(t) with t in seconds from 0 to seconds. */
function run(seconds: number, accel: (t: number) => Vec3, roll: (t: number) => number = () => 0): Gesture[] {
  const d = new GestureDetector();
  const out: Gesture[] = [];
  for (let i = 0; i <= seconds * RATE; i++) {
    const t = i / RATE;
    out.push(...d.update(accel(t), roll(t), 1000 + t * 1000));
  }
  return out;
}

/** A flick along an axis: speed up then slow down, over `ms`, peaking at `peak` m/s^2. */
function flick(axis: number, sign: number, peak = 20, ms = 200, start = 0.2) {
  return (t: number): Vec3 => {
    const u = (t - start) / (ms / 1000);
    const a = u >= 0 && u <= 1 ? sign * peak * Math.sin(2 * Math.PI * u) : 0;
    const v: Vec3 = [0, 0, 0];
    v[axis] = a;
    return v;
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
      expect(g[0].strength).toBeGreaterThan(0.3);
    });
  }

  test("a diagonal flick counts in its main direction when that direction dominates", () => {
    const g = run(1, (t) => {
      const push = flick(2, 1)(t)[2];
      return [push * 0.4, 0, push];
    });
    expect(g.map((x) => x.gesture)).toEqual(["push"]);
  });

  test("an even diagonal is not a named movement", () => {
    const g = run(1, (t) => {
      const a = flick(2, 1)(t)[2];
      return [a, 0, a];
    });
    expect(g).toEqual([]);
  });

  test("slow movement is ignored", () => {
    expect(run(2, flick(2, 1, 3, 800))).toEqual([]);
  });

  test("two flicks in a row are two gestures", () => {
    const a = flick(0, 1, 20, 200, 0.2), b = flick(0, -1, 20, 200, 1.0);
    const g = run(2, (t) => (t < 0.8 ? a(t) : b(t)));
    expect(g.map((x) => x.gesture)).toEqual(["right", "left"]);
  });
});

describe("shake and twist", () => {
  test("shaking is one shake, not a string of flicks", () => {
    const g = run(2, (t) => (t > 0.2 && t < 1.2 ? [0, 25 * Math.sin(2 * Math.PI * 5 * (t - 0.2)), 0] : [0, 0, 0]));
    expect(g.map((x) => x.gesture)).toEqual(["shake"]);
  });

  test("a quick wrist roll is a twist, each way", () => {
    const ramp = (deg: number) => (t: number) => (t < 0.2 ? 0 : t < 0.35 ? (deg * (t - 0.2)) / 0.15 : deg);
    expect(run(1, () => [0, 0, 0], ramp(80)).map((x) => x.gesture)).toEqual(["twist-right"]);
    expect(run(1, () => [0, 0, 0], ramp(-80)).map((x) => x.gesture)).toEqual(["twist-left"]);
  });

  test("a slow roll is not a twist", () => {
    expect(run(2, () => [0, 0, 0], (t) => t * 60)).toEqual([]);
  });
});
