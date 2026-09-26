import { describe, expect, test } from "bun:test";
import {
  eulerToQuat, sensorToRig, direction, yawPitch, rollOf, derivePose,
  PointerCalibration, PoseSmoother, DEFAULT_SCREEN, OneEuroFilter, gravityAgreement, qconj, qrotate,
} from "../src/index.js";

const close = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("frames", () => {
  test("flat phone points forward", () => {
    const d = direction(sensorToRig(eulerToQuat(0, 0, 0)));
    close(d[0], 0); close(d[1], 0); close(d[2], 1);
  });
  test("beta tilts the top edge up (pitch up)", () => {
    const { yaw, pitch } = yawPitch(direction(sensorToRig(eulerToQuat(0, 30, 0))));
    close(yaw, 0); close(pitch, 30);
  });
  test("alpha turns anticlockwise from above (yaw left)", () => {
    const { yaw, pitch } = yawPitch(direction(sensorToRig(eulerToQuat(25, 0, 0))));
    close(yaw, -25); close(pitch, 0);
  });
  test("gamma lowers the right edge (roll right)", () => {
    const q = sensorToRig(eulerToQuat(0, 0, 20));
    const { yaw, pitch } = yawPitch(direction(q));
    close(rollOf(q, yaw, pitch), 20);
  });
  test("combined yaw, pitch and roll come back out", () => {
    // Turn right 40, tilt up 15, roll right 10.
    const q = sensorToRig(eulerToQuat(-40, 15, 10));
    const p = derivePose(q, DEFAULT_SCREEN);
    close(p.yaw, 40, 0.01); close(p.pitch, 15, 0.01); close(p.roll, 10, 0.01);
  });
});

describe("calibration", () => {
  test("first sample takes heading but not pitch", () => {
    const c = new PointerCalibration();
    const p = derivePose(c.calibrate(eulerToQuat(70, 10, 0)), c.screen);
    close(p.yaw, 0); close(p.pitch, 10);
    expect(c.kind).toBe("none");
  });
  test("recentre makes the current direction forward", () => {
    const c = new PointerCalibration();
    c.calibrate(eulerToQuat(0, 0, 0));
    c.recentre(eulerToQuat(30, 12, 0));
    const p = derivePose(c.calibrate(eulerToQuat(30, 12, 0)), c.screen);
    close(p.yaw, 0); close(p.pitch, 0);
    expect(p.screen).toEqual([0.5, 0.5]);
    expect(c.kind).toBe("ray");
  });
  test("default screen spans 40 degrees wide", () => {
    const c = new PointerCalibration();
    c.calibrate(eulerToQuat(0, 0, 0));
    const p = derivePose(c.calibrate(eulerToQuat(-20, 0, 0)), c.screen);
    close(p.screen![0], 1); close(p.screen![1], 0.5);
  });
  test("two corners map to 0,0 and 1,1", () => {
    const c = new PointerCalibration();
    const tl = eulerToQuat(15, 8, 0), br = eulerToQuat(-25, -12, 0);
    c.calibrate(tl);
    c.cornerTopLeft(tl);
    expect(c.cornerBottomRight(br)).toBe(true);
    expect(c.kind).toBe("screen");
    const a = derivePose(c.calibrate(tl), c.screen).screen!;
    const b = derivePose(c.calibrate(br), c.screen).screen!;
    close(a[0], 0); close(a[1], 0); close(b[0], 1); close(b[1], 1);
  });
  test("corners the wrong way round are rejected", () => {
    const c = new PointerCalibration();
    c.cornerTopLeft(eulerToQuat(-25, -12, 0));
    expect(c.cornerBottomRight(eulerToQuat(15, 8, 0))).toBe(false);
    expect(c.kind).toBe("none");
  });
  test("recentre keeps a calibrated screen's size", () => {
    const c = new PointerCalibration();
    c.cornerTopLeft(eulerToQuat(20, 10, 0));
    c.cornerBottomRight(eulerToQuat(-20, -10, 0));
    const w = c.screen.right - c.screen.left;
    c.recentre(eulerToQuat(5, 0, 0));
    close(c.screen.right - c.screen.left, w);
    expect(derivePose(c.calibrate(eulerToQuat(5, 0, 0)), c.screen).screen).toEqual([0.5, 0.5]);
    expect(c.kind).toBe("screen");
  });
});

describe("smoothing", () => {
  test("one euro converges on a constant", () => {
    const f = new OneEuroFilter();
    let out = [0];
    f.filter([0], 0);
    for (let i = 1; i < 120; i++) out = f.filter([1], i * 16.7);
    close(out[0], 1, 0.01);
  });
  test("smoother survives a hemisphere flip", () => {
    const s = new PoseSmoother();
    const q = sensorToRig(eulerToQuat(10, 5, 0));
    s.smooth(q, 0);
    const out = s.smooth([-q[0], -q[1], -q[2], -q[3]], 16);
    close(Math.abs(out[3]), Math.abs(q[3]));
  });
});

describe("motion sign", () => {
  // Standard motion data reports the reaction to gravity: +9.81 along the world's up.
  const standardGravity = (alpha: number, beta: number, gamma: number) => {
    const q = eulerToQuat(alpha, beta, gamma);
    const up = qrotate(qconj(q), [0, 0, 1]);
    return { q, g: up.map((v) => v * 9.81) as [number, number, number] };
  };
  const poses: [number, number, number][] = [[0, 0, 0], [40, 20, 0], [0, 70, 10], [120, -30, 45], [0, 10, -80]];
  test("standard motion data agrees with the orientation, however the phone is held", () => {
    for (const p of poses) {
      const { q, g } = standardGravity(...p);
      close(gravityAgreement(q, g)!, 1);
    }
  });
  test("iPhone motion data (every axis flipped) disagrees", () => {
    for (const p of poses) {
      const { q, g } = standardGravity(...p);
      close(gravityAgreement(q, g.map((v) => -v) as [number, number, number])!, -1);
    }
  });
  test("a phone moving hard says nothing", () => {
    expect(gravityAgreement(eulerToQuat(0, 0, 0), [0, 0, 25])).toBeNull();
  });
});
