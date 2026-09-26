// Virtual phones: simulated players for testing apps without real phones, and replay of recorded
// sessions. Both talk to the Session exactly as a real phone connection does.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { type PhoneToRelay, type Quat, eulerToQuat } from "@phone-wand/core";
import type { PhoneConnection, PhoneLink, Session } from "./session.js";

class VirtualLink implements PhoneLink {
  readonly transport = "ws" as const;
  closed = false;
  onMessage: ((m: any) => void) | null = null;
  send(msg: any): void {
    this.onMessage?.(msg);
  }
  close(): void {
    this.closed = true;
  }
}

const NAMES = ["Ada", "Bea", "Cy", "Dot", "Eli", "Fen", "Gus", "Hal", "Ivy", "Jo", "Kit", "Lu"];

/** Start `count` simulated players that wander around the screen and click now and then. */
export function simulate(session: Session, count: number, key: string): () => void {
  const timers: ReturnType<typeof setInterval>[] = [];
  for (let i = 0; i < count; i++) {
    const link = new VirtualLink();
    const conn = session.addPhone(link);
    link.onMessage = (m) => {
      if (m.type === "ping") session.phoneMessage(conn, { type: "pong", n: m.n, ts: performance.now() });
    };
    session.phoneMessage(conn, {
      type: "hello", key, name: `${NAMES[i % NAMES.length]} (sim)`, platform: "other", sensor: "deviceorientation",
    });
    session.phoneMessage(conn, { type: "ready", sensor: "deviceorientation" });
    const start = performance.now();
    const phase = i * 1.7;
    let seq = 0;
    let recentred = false;
    let clickUntil = 0;
    let nextClick = start + 1500 + Math.random() * 2000;
    timers.push(
      setInterval(() => {
        const now = performance.now();
        const s = (now - start) / 1000;
        // A slow Lissajous path covering most of the default 40 x 22.5 degree screen.
        const yaw = 17 * Math.sin(s * 0.53 + phase);
        const pitch = 9 * Math.sin(s * 0.71 + phase * 1.3);
        const q = eulerToQuat(-yaw, pitch, 4 * Math.sin(s * 0.3)) as Quat;
        session.phoneMessage(conn, { type: "pose", seq: seq++, ts: now, q });
        if (!recentred) {
          // Recentre while pointing at (0, 0) so the path is centred on the screen.
          session.phoneMessage(conn, { type: "recentre" });
          recentred = true;
        }
        if (clickUntil && now > clickUntil) {
          session.phoneMessage(conn, { type: "button", button: "primary", down: false });
          clickUntil = 0;
        } else if (!clickUntil && now > nextClick) {
          session.phoneMessage(conn, { type: "button", button: "primary", down: true });
          clickUntil = now + 120;
          nextClick = now + 1500 + Math.random() * 3000;
        }
      }, 1000 / 60),
    );
  }
  return () => timers.forEach(clearInterval);
}

// ---------------------------------------------------------------- recording

export type RecordLine =
  | { t: number; link: number; open: "ws" | "http" }
  | { t: number; link: number; close: true }
  | { t: number; link: number; msg: PhoneToRelay };

export class Recorder {
  private start = Date.now();
  constructor(private readonly path: string) {
    writeFileSync(path, "");
  }
  write(line: RecordLine): void {
    const t = Math.round((line.t - this.start) * 10) / 10;
    appendFileSync(this.path, JSON.stringify({ ...line, t }) + "\n");
  }
}

export function readRecording(path: string): RecordLine[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RecordLine);
}

/** Replay a recording in real time, optionally looping. The join key is replaced with `key`. */
export function replay(session: Session, lines: RecordLine[], key: string, loop: boolean): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    const conns = new Map<number, PhoneConnection>();
    const t0 = performance.now();
    let i = 0;
    const step = () => {
      if (stopped) return;
      const elapsed = performance.now() - t0;
      while (i < lines.length && lines[i].t <= elapsed) {
        const line = lines[i++];
        let conn = conns.get(line.link);
        if ("open" in line || (!conn && "msg" in line)) {
          conn = session.addPhone(new VirtualLink());
          conns.set(line.link, conn);
        }
        if ("close" in line && conn) {
          session.phoneClosed(conn);
          conns.delete(line.link);
        }
        if ("msg" in line && conn) {
          const msg = line.msg.type === "hello" ? { ...line.msg, key } : line.msg;
          session.phoneMessage(conn, msg);
        }
      }
      if (i < lines.length) timer = setTimeout(step, 4);
      else {
        for (const c of conns.values()) session.phoneClosed(c);
        if (loop) timer = setTimeout(run, 500);
      }
    };
    step();
  };
  run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
