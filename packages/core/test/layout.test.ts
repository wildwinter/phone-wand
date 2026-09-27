import { describe, expect, test } from "bun:test";
import { type Layout, arrange, layoutButtons, validateLayout } from "../src/index.js";

const B = (id: string) => ({ id, type: "button" as const });
const valid = (raw: unknown): Layout => {
  const l = validateLayout(raw);
  if (typeof l === "string") throw new Error(l);
  return l;
};
/** The arrangement as types per line, and the sizes: easy to compare. */
const shape = (raw: unknown) => {
  const a = arrange(valid(raw));
  return { columns: a.columns, lines: a.lines.map((l) => l.map((c) => c.type)), sizes: a.sizes };
};

describe("the fixed templates are rows presets", () => {
  test("primary is one pad", () => {
    expect(shape({ template: "primary", controls: [B("go")] })).toEqual({ columns: false, lines: [["pad"]], sizes: [1] });
  });
  test("primary-secondary is a pad, then a space and the smaller control towards the palm", () => {
    expect(shape({ template: "primary-secondary", controls: [B("a"), B("b")] }))
      .toEqual({ columns: false, lines: [["pad"], ["space", "button"]], sizes: [3, 1] });
  });
  test("primary-row is a pad over a row", () => {
    expect(shape({ template: "primary-row", controls: [B("a"), B("b"), B("c"), B("d")] }))
      .toEqual({ columns: false, lines: [["pad"], ["button", "button", "button"]], sizes: [3, 1] });
  });
  test("pair is one row of two", () => {
    expect(shape({ template: "pair", controls: [B("a"), B("b")] })).toEqual({ columns: false, lines: [["button", "button"]], sizes: [1] });
  });
  test("grid is rows of two, with a space to even out the last", () => {
    expect(shape({ template: "grid", controls: [B("a"), B("b"), B("c")] }))
      .toEqual({ columns: false, lines: [["button", "button"], ["button", "space"]], sizes: [1, 1] });
  });
  test("a d-pad as the primary control stays a d-pad", () => {
    expect(shape({ template: "primary", controls: [{ id: "m", type: "dpad" }] }).lines).toEqual([["dpad"]]);
  });
});

describe("rows, columns, pads and spaces", () => {
  test("rows and columns keep their counts and sizes", () => {
    expect(shape({ template: "rows", rows: [1, 2], heights: [2, 1], controls: [B("a"), { type: "space" }, B("b")] }))
      .toEqual({ columns: false, lines: [["button"], ["space", "button"]], sizes: [2, 1] });
    expect(shape({ template: "columns", columns: [2, 1], controls: [B("a"), B("b"), { id: "p", type: "pad" }] }))
      .toEqual({ columns: true, lines: [["button", "button"], ["pad"]], sizes: [1, 1] });
  });
  test("a pad is a button; a space has no buttons and needs no id", () => {
    const l = valid({ template: "rows", rows: [3], controls: [{ id: "fire", type: "pad" }, { type: "space" }, { type: "space" }] });
    expect(layoutButtons(l)).toEqual(["fire"]);
    expect(l.controls[1]).toEqual({ type: "space" });
  });
  test("a space's id, if it has one, must be unique", () => {
    expect(validateLayout({ template: "pair", controls: [B("a"), { id: "a", type: "space" }] })).toContain("space id a");
  });
});
