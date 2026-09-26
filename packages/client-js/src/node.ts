// Starting the relay from a Node (or Bun or Deno) program: see docs/shipping.md. Kept apart from
// the main client because browsers can't start programs.
//
//   import { startRelay } from "./phone-wand-node.mjs";
//   const relay = await startRelay({ folder: "./phone-wand-relay" });
//   const wand = new PhoneWand();
//   ...
//   await relay.stop();

import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface StartRelayOptions {
  /** The phone-wand-relay folder (holding macos, windows-x64 and so on). Default ./phone-wand-relay. */
  folder?: string;
  /** The relay program itself, instead of looking in `folder`. */
  executable?: string;
  /** Arguments before the relay's own, e.g. to run the relay's source with Bun. */
  execArgs?: string[];
  /** The app URL the client will use. Default ws://127.0.0.1:8480/app. */
  url?: string;
  /** Extra relay options, e.g. ["--max-players", "8"]. */
  args?: string[];
  /** Where the relay writes its output. Default phone-wand-relay.log in the temporary folder. */
  log?: string;
}

export interface ManagedRelay {
  /** True if this call started a relay; false if one was already running (or none could start). */
  started: boolean;
  /** The relay process, when started. */
  process: ChildProcess | null;
  /** Stop the relay if this call started it. */
  stop(): Promise<void>;
}

/** The folder name for this computer inside phone-wand-relay/. */
export function relayPlatform(): string | null {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return process.arch === "x64" ? "windows-x64" : null;
  if (process.platform === "linux") return process.arch === "arm64" ? "linux-arm64" : process.arch === "x64" ? "linux-x64" : null;
  return null;
}

async function relayAnswers(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/status.json`, { signal: AbortSignal.timeout(1000) });
    const status = (await r.json()) as { relay?: unknown };
    return typeof status.relay === "string";
  } catch {
    return false;
  }
}

/**
 * Start a relay for this program unless one is already running, following docs/shipping.md: only
 * for a relay on this computer, hidden, with no browser, and stopping when this program stops.
 */
export async function startRelay(options: StartRelayOptions = {}): Promise<ManagedRelay> {
  const none: ManagedRelay = { started: false, process: null, stop: async () => {} };
  const url = new URL(options.url ?? "ws://127.0.0.1:8480/app");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return none;
  const port = Number(url.port) || 8480;
  if (await relayAnswers(port)) return none;

  let exe = options.executable;
  if (!exe) {
    const platform = relayPlatform();
    const folder = options.folder ?? "phone-wand-relay";
    exe = platform ? join(folder, platform, process.platform === "win32" ? "phone-wand-relay.exe" : "phone-wand-relay") : "";
    if (!platform || !existsSync(exe)) {
      console.warn(`phone-wand: no relay to start. Looked for ${exe || `a build for ${process.platform} ${process.arch}`}. See docs/shipping.md.`);
      return none;
    }
    if (process.platform !== "win32") {
      try {
        chmodSync(exe, 0o755);
      } catch {
        // read-only location; it may already be executable
      }
    }
  }

  const log = options.log ?? join(tmpdir(), "phone-wand-relay.log");
  const child = spawn(
    exe,
    [...(options.execArgs ?? []), "--lifeline", "--no-open", "--app-port", String(port), "--log", log, ...(options.args ?? [])],
    // stdin is the lifeline: it closes when this program ends, however it ends, and the relay stops.
    { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
  );
  child.on("error", (e) => console.warn(`phone-wand: the relay could not start: ${e.message}`));

  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => child.kill(), 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin?.end();
    });
  return { started: true, process: child, stop };
}
