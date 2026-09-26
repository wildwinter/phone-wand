#!/usr/bin/env bun
// phone-wand relay: command-line entry point.

import { parseArgs } from "node:util";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import QRCode from "qrcode";
import pkg from "../package.json" with { type: "json" };
import { Session } from "./session.js";
import { startServers } from "./server.js";
import { fileTls, localTls } from "./certs.js";
import { certificateNames, lanAddresses } from "./network.js";
import { Recorder, readRecording, replay, simulate } from "./virtual.js";

const VERSION: string = pkg.version;

const HELP = `phone-wand ${VERSION}: turn phones into shared pointers for a screen.

Usage: phone-wand [options]

Phones:
  --port <n>            HTTPS port phones connect to (default 8443)
  --host <name>         Address or name to put in the QR code (default: this machine's LAN IP)
  --max-players <n>     Player slots (default 4)
  --key <text>          Join key carried by the QR code (default: a saved random key)
  --no-key              Let any phone on the network join without the QR code
  --landing-port <n>    Port for the welcome page the QR code opens, which explains the certificate
                        warning before the phone shows it (default: the first free port from 8440)
  --no-landing          QR code goes straight to the secure page (the default with --tls-cert)
  --http-port <n>       Also serve phones over plain HTTP on this port (Android over USB, development)

Certificates:
  --tls-cert <file>     Use this certificate (PEM) instead of the relay's own local CA
  --tls-key <file>      Private key (PEM) for --tls-cert

Apps:
  --app-port <n>        Port apps and the dashboard connect to (default 8480)
  --app-host <addr>     Address apps connect on (default 127.0.0.1; 0.0.0.0 allows other machines)
  --allow-origin <url>  Let web pages from this origin connect as apps (repeatable; * for any).
                        Pages from this computer (localhost, 127.0.0.1, files) are always allowed.

Testing:
  --simulate <n>        Add n simulated players that move and click on their own
  --record <file>       Record every phone message to a .jsonl file
  --replay <file>       Replay a recording as virtual phones
  --loop                With --replay, repeat forever

Other:
  --data-dir <dir>      Where certificates and settings live (default ~/.phone-wand)
  --no-open             Do not open the dashboard in a browser
  --quiet               Only print errors
  -v, --version         Print the version
  -h, --help            Show this help

Docs: https://github.com/wildwinter/phone-wand`;

// Started by "Phone Wand.app" on macOS (which sets PHONE_WAND_APP): there is no terminal, so output
// goes to a log file, the dashboard is the interface, and errors are shown in a dialog. Run by hand
// from Terminal, even from inside the app, the relay behaves as the ordinary command line.
const APP_MODE = process.platform === "darwin" && process.env.PHONE_WAND_APP === "1";
const LOG_FILE = join(homedir(), "Library/Logs/Phone Wand/relay.log");

if (APP_MODE) {
  mkdirSync(join(LOG_FILE, ".."), { recursive: true });
  writeFileSync(LOG_FILE, `Phone Wand relay started ${new Date().toISOString()}\n`);
  const toFile = (...parts: unknown[]) => {
    try {
      appendFileSync(LOG_FILE, parts.map(String).join(" ").replace(/\x1b\[[0-9;]*m/g, "") + "\n");
    } catch {
      // nowhere to log
    }
  };
  console.log = toFile;
  console.warn = toFile;
  console.error = toFile;
}

function alertDialog(title: string, message: string): void {
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  try {
    execFileSync("osascript", ["-e", `display alert "${esc(title)}" message "${esc(message)}" as critical`]);
  } catch {
    // no GUI session
  }
}

function fail(message: string): never {
  console.error(`phone-wand: ${message}`);
  if (APP_MODE) alertDialog("Phone Wand could not start", `${message}\n\nThe log is in ${LOG_FILE}.`);
  // Double-clicking the relay on Windows opens a console that closes the moment it exits, so the
  // message would vanish unread. Wait for Enter first.
  if (process.platform === "win32" && process.stdin.isTTY) {
    console.error("\nPress Enter to close.");
    try {
      readSync(0, Buffer.alloc(1), 0, 1, null);
    } catch {
      // no console to read from
    }
  }
  process.exit(1);
}

function int(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) fail(`${name} must be a whole number`);
  return n;
}

/** Whether nothing is listening on a TCP port. */
function portFree(port: number, hostname = "0.0.0.0"): boolean {
  try {
    const s = Bun.listen({ hostname, port, socket: { data() {} } });
    s.stop(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * If a relay is already running on this computer (say, one left running in another terminal), ask
 * it to stop so this one can take over. Anything else holding our ports is left alone.
 */
async function takeOver(phonePort: number, appPort: number, appHost: string, log: (line: string) => void): Promise<void> {
  if (portFree(phonePort) && portFree(appPort, appHost)) return;
  let version = "";
  try {
    const r = await fetch(`http://127.0.0.1:${appPort}/status.json`, { signal: AbortSignal.timeout(1500) });
    const status = (await r.json()) as { relay?: string; protocol?: number };
    if (typeof status.relay === "string" && typeof status.protocol === "number") version = status.relay;
  } catch {
    // not a relay, or not answering
  }
  if (version) {
    try {
      await fetch(`http://127.0.0.1:${appPort}/shutdown`, {
        method: "POST", headers: { "x-phone-wand": "shutdown" }, signal: AbortSignal.timeout(1500),
      });
    } catch {
      // it may already be going
    }
    for (let i = 0; i < 40 && !(portFree(phonePort) && portFree(appPort, appHost)); i++) await Bun.sleep(100);
    log(`Stopped the relay that was already running (version ${version}) and took over.`);
  }
  for (const [port, host, what] of [[phonePort, "0.0.0.0", "--port"], [appPort, appHost, "--app-port"]] as const) {
    if (!portFree(port, host)) {
      fail(`port ${port} is in use by another program${version ? "" : " (or a relay started with a different --app-port)"}. Choose another with ${what}.`);
    }
  }
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // no browser; the URL is printed anyway
  }
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      // Finder can add a process serial number argument when it launches an app.
      args: process.argv.slice(2).filter((a) => !a.startsWith("-psn_")),
      options: {
        port: { type: "string" },
        host: { type: "string" },
        "max-players": { type: "string" },
        key: { type: "string" },
        "no-key": { type: "boolean" },
        "http-port": { type: "string" },
        "landing-port": { type: "string" },
        "no-landing": { type: "boolean" },
        "tls-cert": { type: "string" },
        "tls-key": { type: "string" },
        "app-port": { type: "string" },
        "app-host": { type: "string" },
        "allow-origin": { type: "string", multiple: true },
        simulate: { type: "string" },
        record: { type: "string" },
        replay: { type: "string" },
        loop: { type: "boolean" },
        "data-dir": { type: "string" },
        "no-open": { type: "boolean" },
        quiet: { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }));
  } catch (e) {
    fail(`${(e as Error).message}\nRun phone-wand --help for the options.`);
  }
  if (values.help) return console.log(HELP);
  if (values.version) return console.log(VERSION);

  const quiet = !!values.quiet;
  const log = (line: string) => quiet || console.log(line);
  const phonePort = int(values.port, "--port", 8443);
  const appPort = int(values["app-port"], "--app-port", 8480);
  const httpPort = int(values["http-port"], "--http-port", 0);
  const maxPlayers = int(values["max-players"], "--max-players", 4);
  if (maxPlayers < 1) fail("--max-players must be at least 1");
  const appHost = values["app-host"] ?? "127.0.0.1";
  const dataDir = resolve(values["data-dir"] ?? join(homedir(), ".phone-wand"));
  mkdirSync(dataDir, { recursive: true });

  // The join key survives restarts, so phones (and printed QR codes) keep working.
  const settingsPath = join(dataDir, "settings.json");
  const settings: { key?: string } = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  if (!settings.key) {
    settings.key = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, "0")).join("");
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  const key = values["no-key"] ? "" : (values.key ?? settings.key);

  const lan = lanAddresses();
  const host = values.host ?? lan[0]?.address ?? "localhost";
  const query = key ? `?k=${encodeURIComponent(key)}` : "";
  const secureUrl = `https://${host}${phonePort === 443 ? "" : `:${phonePort}`}/${query}`;
  // A port given explicitly is used as given; the default takes the first free one from 8440.
  const landingPorts = values["no-landing"] || (values["tls-cert"] && !values["landing-port"])
    ? []
    : values["landing-port"]
      ? [int(values["landing-port"], "--landing-port", 8440)]
      : Array.from({ length: 10 }, (_, i) => 8440 + i);
  const dashboardUrl = `http://${appHost === "0.0.0.0" ? "127.0.0.1" : appHost}:${appPort}/`;

  if (!!values["tls-cert"] !== !!values["tls-key"]) fail("--tls-cert and --tls-key go together");
  const tls = values["tls-cert"]
    ? fileTls(values["tls-cert"], values["tls-key"]!)
    : await localTls(dataDir, certificateNames(host));

  const recorder = values.record ? new Recorder(values.record) : null;
  const session = new Session({
    maxPlayers, key, joinUrl: secureUrl, version: VERSION,
    qrUrl: `${dashboardUrl}qr.png`,
    log,
    onPhoneMessage: recorder ? (link, msg, t) => recorder.write({ t, link, msg }) : undefined,
    onPhoneLink: recorder
      ? (link, event, transport, t) =>
          recorder.write(event === "open" ? { t, link, open: transport } : { t, link, close: true as const })
      : undefined,
  });

  await takeOver(phonePort, appPort, appHost, log);

  let servers: ReturnType<typeof startServers>;
  // Set once the timers exist; a takeover request can only arrive after that.
  let shutdown = () => process.exit(0);
  try {
    servers = startServers(session, {
      phonePort, appPort, appHost, httpPort, landingPorts, tls,
      allowOrigins: (values["allow-origin"] ?? []).flatMap((o) => o.split(",")).map((o) => o.trim().replace(/\/$/, "")),
      onShutdownRequest: () => {
        log("\nAnother relay started on this computer and took over. Stopping.");
        shutdown();
      },
    });
  } catch (e) {
    const msg = (e as Error).message;
    fail(/in use|EADDRINUSE/i.test(msg) ? `a port is already in use (${msg}). Is another relay running?` : msg);
  }

  if (servers.landingPort) {
    const lp = servers.landingPort;
    session.options.joinUrl = `http://${host}${lp === 80 ? "" : `:${lp}`}/${query}`;
  }
  const joinUrl = session.options.joinUrl;

  const tick = setInterval(() => session.tick(), 100);
  const second = setInterval(() => session.second(), 1000);

  if (landingPorts.length && !servers.landingPort) {
    console.warn(
      `\nphone-wand: the welcome page could not start (port ${landingPorts.length === 1 ? landingPorts[0] : `${landingPorts[0]} to ${landingPorts.at(-1)}`} in use),` +
        "\nso the QR code goes straight to the secure page and phones see the certificate warning unexplained." +
        "\nChoose a free port with --landing-port.",
    );
  }
  if (!quiet) {
    console.log(`\nphone-wand ${VERSION}\n`);
    console.log((await QRCode.toString(joinUrl, { type: "terminal", small: true })).trimEnd());
    console.log(`\n  Phones join at:  ${joinUrl}`);
    if (joinUrl !== secureUrl) console.log(`  Secure page:     ${secureUrl}`);
    if (httpPort) console.log(`  Plain HTTP:      http://${host}:${httpPort}/${key ? `?k=${key}` : ""}`);
    console.log(`  Dashboard:       ${dashboardUrl}`);
    console.log(`  Apps connect to: ws://${appHost === "0.0.0.0" ? "127.0.0.1" : appHost}:${appPort}/app`);
    if (tls.source === "local-ca") {
      console.log(`  Certificate:     local CA in ${dataDir} (phones can install it from https://${host}:${phonePort}/ca.crt)`);
    } else {
      console.log(`  Certificate:     ${values["tls-cert"]}`);
    }
    if (lan.length > 1 && !values.host) {
      console.log(`  Other addresses: ${lan.slice(1).map((a) => `${a.address} (${a.iface})`).join(", ")}  (use --host to pick one)`);
    }
    console.log(`\n  ${maxPlayers} player slots. ${APP_MODE ? "Stop it with the dashboard's Stop relay button." : "Press Ctrl+C to stop."}\n`);
  }
  if (!values["no-open"]) openBrowser(dashboardUrl);
  const stopSim = values.simulate ? simulate(session, int(values.simulate, "--simulate", 0), key) : null;
  const stopReplay = values.replay ? replay(session, readRecording(values.replay), key, !!values.loop) : null;

  shutdown = () => {
    clearInterval(tick);
    clearInterval(second);
    stopSim?.();
    stopReplay?.();
    servers.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (APP_MODE) {
    // The app holds our stdin open; when it closes, the app has gone, so the relay goes too.
    process.stdin.on("end", shutdown);
    process.stdin.on("close", shutdown);
    process.stdin.resume();
  }
}

main().catch((e) => fail((e as Error).stack ?? String(e)));
