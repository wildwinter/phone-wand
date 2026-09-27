import { describe, expect, test } from "bun:test";
import { CompassHelper, type Quat, RAD, headingOf, qaxis, wrap } from "../src/index.js";

const RATE = 60;

/** A phone lying level, its top edge pointing `heading` degrees clockwise from the world's +y. */
const facing = (heading: number): Quat => qaxis([0, 0, 1], -heading * RAD);

/**
 * Run `seconds` at 60 Hz. The phone really faces trueHeading(t); the gyroscope reports that plus
 * drift(t); compass(t) gives the compass reading (or null). Returns the corrected headings' error
 * from the truth at the end, the helper, and the largest change of correction in any one second.
 */
function run(
  seconds: number,
  opts: {
    trueHeading?: (t: number) => number;
    drift?: (t: number) => number;
    compass?: (t: number, truth: number) => { heading: number; accuracy: number | null } | null;
  },
) {
  const helper = new CompassHelper();
  const truth = opts.trueHeading ?? ((t) => 20 * Math.sin(t / 7));
  const drift = opts.drift ?? (() => 0);
  let error = 0;
  const corrections: number[] = [];
  for (let i = 0; i <= seconds * RATE; i++) {
    const t = i / RATE;
    const ms = t * 1000;
    const c = opts.compass?.(t, truth(t));
    if (c) helper.reading(c.heading, c.accuracy, ms);
    const out = helper.correct(facing(truth(t) + drift(t)), ms);
    error = wrap(headingOf(out).heading - truth(t));
    corrections.push(helper.status(ms).correction);
  }
  let fastest = 0;
  for (let i = RATE; i < corrections.length; i++) fastest = Math.max(fastest, Math.abs(corrections[i] - corrections[i - RATE]));
  return { error, helper, fastest, end: seconds * 1000 };
}

// Drift of 6 degrees a minute, from the start: 30 degrees after five minutes.
const drifting = (t: number) => (6 * t) / 60;
// A true compass with a little wobble.
const good = (t: number, truth: number) => ({ heading: truth + Math.sin(t * 13) * 1, accuracy: 10 });

describe("compass drift correction", () => {
  test("with a good compass, drift is taken out", () => {
    const r = run(300, { drift: drifting, compass: good });
    // Error is measured from where the compass was first trusted (about 1.5 s of drift in).
    expect(Math.abs(r.error)).toBeLessThan(2);
    expect(r.helper.status(r.end).state).toBe("helping");
  });

  test("without a compass nothing changes", () => {
    const r = run(300, { drift: drifting });
    expect(r.error).toBeCloseTo(30, 0);
    expect(r.helper.status(r.end)).toEqual({ state: "none", correction: 0 });
  });

  test("an uncalibrated iPhone compass is ignored: no prompt, no correction", () => {
    const r = run(120, { drift: drifting, compass: (t, truth) => ({ heading: truth + 40, accuracy: -1 }) });
    expect(r.helper.status(r.end)).toEqual({ state: "ignored", correction: 0 });
  });

  test("a wildly wobbling compass is ignored", () => {
    const r = run(120, { drift: drifting, compass: (t, truth) => ({ heading: truth + 25 * Math.sin(t * 5), accuracy: null }) });
    expect(r.helper.status(r.end).correction).toBe(0);
  });

  test("a passing disturbance only nudges the heading, slowly", () => {
    // No drift; the compass is pulled 40 degrees off for 3 seconds (walking past a speaker).
    const r = run(60, {
      compass: (t, truth) => ({ heading: truth + (t > 30 && t < 33 ? 40 : 0), accuracy: 10 }),
    });
    expect(Math.abs(r.error)).toBeLessThan(1);
    expect(r.fastest).toBeLessThanOrEqual(0.41); // 0.3 a second, as reported to 0.1 of a degree
  });

  test("corrections never jump: at most a fraction of a degree a second", () => {
    // The compass suddenly and steadily disagrees by 30 degrees (a big, lasting disturbance).
    const r = run(60, { compass: (t, truth) => ({ heading: truth + (t > 5 ? 30 : 0), accuracy: 10 }) });
    expect(r.fastest).toBeLessThanOrEqual(0.41); // 0.3 a second, as reported to 0.1 of a degree
  });

  test("pointing steeply up, the compass is not used", () => {
    const helper = new CompassHelper();
    const up: Quat = qaxis([1, 0, 0], 80 * RAD); // top edge tipped up 80 degrees
    for (let i = 0; i < 600; i++) {
      helper.reading(90, 5, i * 16);
      helper.correct(up, i * 16);
    }
    expect(helper.status(600 * 16).state).toBe("ignored");
  });
});
