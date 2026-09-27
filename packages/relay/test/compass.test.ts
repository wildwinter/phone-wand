import { expect, test } from "bun:test";
import { Session } from "../src/session.js";

function setup() {
  const sent: any[] = [];
  const session = new Session({ maxPlayers: 4, key: "", joinUrl: "", qrUrl: "", version: "test", now: () => 0 });
  session.addApp({ send: (m: any) => sent.push(m) });
  const phone = session.addPhone({ transport: "ws", send() {}, close() {} });
  session.phoneMessage(phone, { type: "hello", key: "", name: "Kit", platform: "iOS", sensor: "deviceorientation" });
  const stats = () => {
    sent.length = 0;
    session.second();
    return sent.find((m) => m.type === "stats");
  };
  return { session, phone, stats };
}

test("stats carry what the phone says about its compass", () => {
  const { session, phone, stats } = setup();
  expect(stats().compass).toBeUndefined(); // the phone hasn't said yet
  session.phoneMessage(phone, { type: "compass", state: "helping", correction: 2.345 });
  expect(stats().compass).toEqual({ state: "helping", correction: 2.3 });
});

test("a malformed compass report is ignored", () => {
  const { session, phone, stats } = setup();
  session.phoneMessage(phone, { type: "compass", state: "lost", correction: 1 } as any);
  session.phoneMessage(phone, { type: "compass", state: "helping", correction: Infinity } as any);
  expect(stats().compass).toBeUndefined();
});
