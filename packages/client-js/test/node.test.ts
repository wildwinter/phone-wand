import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PhoneWand } from "../src/index.js";
import { startRelay, type ManagedRelay } from "../src/node.js";

// Runs the relay from source with Bun, standing in for a shipped binary.
const relaySource = join(import.meta.dir, "../../relay/src/main.ts");
const url = "ws://127.0.0.1:18581/app";
const dataDir = join(tmpdir(), `phone-wand-test-${process.pid}`);
let relay: ManagedRelay | null = null;

async function answering(): Promise<boolean> {
  try {
    return (await fetch("http://127.0.0.1:18581/status.json")).ok;
  } catch {
    return false;
  }
}

afterAll(async () => {
  await relay?.stop();
});

test("starts a relay, reuses a running one, and stops what it started", async () => {
  relay = await startRelay({
    executable: process.execPath,
    execArgs: [relaySource],
    url,
    args: ["--port", "18543", "--no-landing", "--data-dir", dataDir, "--simulate", "1"],
  });
  expect(relay.started).toBe(true);

  const wand = new PhoneWand({ url });
  const joined = await new Promise<string>((resolve) => wand.on("join", (p) => resolve(p.name)));
  expect(joined).toContain("(sim)");
  wand.close();

  // A second call finds the running relay and leaves it alone.
  const again = await startRelay({ executable: process.execPath, execArgs: [relaySource], url });
  expect(again.started).toBe(false);

  await relay.stop();
  expect(await answering()).toBe(false);
}, 20000);

test("only starts a relay on this computer", async () => {
  const r = await startRelay({ url: "ws://192.0.2.1:8480/app", executable: "/nonexistent" });
  expect(r.started).toBe(false);
});
