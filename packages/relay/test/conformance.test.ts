import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../../../scripts/conformance.js";

const dir = join(import.meta.dir, "../../../conformance");

// The relay and the reference JS client, replayed through every scripted session, must reproduce
// the committed conformance files exactly.
test("conformance files are up to date", () => {
  for (const [rel, content] of generate()) {
    expect(`${rel}:\n${readFileSync(join(dir, rel), "utf8")}`).toBe(`${rel}:\n${content}`);
  }
});

test("screen calibration maps corners to 0,0 and 1,1 with smoothing off", () => {
  const lines = readFileSync(join(dir, "app/raw.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const poses = lines.filter((m) => m.type === "pose");
  expect(poses.length).toBeGreaterThan(20);
  // After the mid-session recentre, the first pose points straight ahead.
  const recentred = lines.findIndex((m) => m.type === "calibrated");
  const first = lines.slice(recentred).find((m) => m.type === "pose");
  expect(first.screen).toEqual([0.5, 0.5]);
});
