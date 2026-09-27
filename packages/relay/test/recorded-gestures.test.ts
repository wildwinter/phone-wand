import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Session } from "../src/session.js";

// A real session from an iPhone 16 (Chrome), recorded at the relay: each group of gestures was
// marked by pressing Secondary before it. The player did five of each movement and flick, eleven
// twists (alternating left and right), then aimed around the screen for 30 seconds. Every group
// must give its own gesture five times and nothing else, and aiming must give nothing.
const GROUPS: [string, Record<string, number>][] = [
  ["push", { push: 5 }],
  ["pull", { pull: 5 }],
  ["left", { left: 5 }],
  ["right", { right: 5 }],
  ["up", { up: 5 }],
  ["down", { down: 5 }],
  ["flick-left", { "flick-left": 5 }],
  ["flick-right", { "flick-right": 5 }],
  ["flick-up", { "flick-up": 5 }],
  ["flick-down", { "flick-down": 5 }],
  ["twists", { "twist-left": 6, "twist-right": 5 }],
  ["aiming", {}],
];

interface Line { t: number; link: number; open?: "ws" | "http"; close?: boolean; msg?: any }

function replay(threshold?: number): Record<string, number>[] {
  const lines: Line[] = gunzipSync(readFileSync(join(import.meta.dir, "fixtures/gestures-iphone.jsonl.gz")))
    .toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
  let now = 0;
  const gestures: { gesture: string; at: number }[] = [];
  const session = new Session({ maxPlayers: 4, key: "", joinUrl: "", qrUrl: "", version: "test", now: () => now });
  const app = session.addApp({ send: (m: any) => { if (m.type === "gesture") gestures.push({ gesture: m.gesture, at: now }); } });
  if (threshold !== undefined) session.appMessage(app, { type: "configure", gestures: { threshold } } as any);
  const phones = new Map<number, any>();
  const markers: number[] = [];
  let tick = 0;
  for (const l of lines) {
    for (; tick <= l.t; tick += 100) { now = tick; session.tick(); }
    now = l.t;
    if (l.open) phones.set(l.link, session.addPhone({ transport: l.open, send() {}, close() {} }));
    else if (l.close) { const p = phones.get(l.link); if (p) session.phoneClosed(p); }
    else if (l.msg) {
      const p = phones.get(l.link);
      if (l.msg.type === "button" && l.msg.button === "secondary" && l.msg.down) markers.push(l.t);
      session.phoneMessage(p, l.msg);
    }
  }
  return markers.map((from, i) => {
    const to = markers[i + 1] ?? Infinity;
    const counts: Record<string, number> = {};
    for (const g of gestures) if (g.at >= from && g.at < to) counts[g.gesture] = (counts[g.gesture] ?? 0) + 1;
    return counts;
  });
}

for (const threshold of [undefined, 9, 11]) {
  test(`a recorded iPhone session gives the right gestures${threshold ? ` (threshold ${threshold})` : ""}`, () => {
    const found = replay(threshold);
    expect(found.length).toBe(GROUPS.length);
    for (let i = 0; i < GROUPS.length; i++) expect({ group: GROUPS[i][0], found: found[i] }).toEqual({ group: GROUPS[i][0], found: GROUPS[i][1] });
  });
}
