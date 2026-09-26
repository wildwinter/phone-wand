// Builds the release files into dist/, one per platform or engine:
//
//   phone-wand-relay-<ver>-macos-arm64.zip     signed relay binary (plus README and LICENSE)
//   phone-wand-relay-<ver>-macos-x64.zip
//   phone-wand-relay-<ver>-windows-x64.zip     unsigned by policy
//   phone-wand-relay-<ver>-linux-x64.tar.gz
//   phone-wand-relay-<ver>-linux-arm64.tar.gz
//   phone-wand-js-<ver>.zip                    ES module, <script> build, types, examples
//   phone-wand-unity-<ver>.zip                 the UPM package folder
//   phone-wand-godot-<ver>.zip                 addons/phone_wand
//   phone-wand-unreal-<ver>.zip                the plugin and the demo project, side by side
//
// Usage:
//   bun scripts/dist.ts                         everything; relay for this machine only
//   bun scripts/dist.ts --relay=all             relay for every platform
//   bun scripts/dist.ts --relay=darwin-arm64,darwin-x64 --only=relay
//   bun scripts/dist.ts --only=js,unity,godot,unreal
//
// macOS binaries are signed with a Developer ID identity from the keychain (or
// PHONE_WAND_SIGN_IDENTITY) when built on a Mac, and notarized when APPLE_ID,
// APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID are set. Without an identity they are ad-hoc signed.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildAssets } from "./build-assets.js";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const version: string = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const run = (cmd: string, args: string[], cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const probe = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" });

const RELAY_TARGETS: Record<string, { name: string; exe: string; archive: "zip" | "tar" }> = {
  "darwin-arm64": { name: "macos-arm64", exe: "phone-wand", archive: "zip" },
  "darwin-x64": { name: "macos-x64", exe: "phone-wand", archive: "zip" },
  "windows-x64": { name: "windows-x64", exe: "phone-wand.exe", archive: "zip" },
  "linux-x64": { name: "linux-x64", exe: "phone-wand", archive: "tar" },
  "linux-arm64": { name: "linux-arm64", exe: "phone-wand", archive: "tar" },
};

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v] as [string, string];
  }),
);
const only = new Set((args.get("only") ?? "relay,js,unity,godot,unreal").split(","));
const hostTarget = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
const relayArg = args.get("relay") ?? hostTarget;
const relayTargets = relayArg === "all" ? Object.keys(RELAY_TARGETS) : relayArg.split(",");

mkdirSync(dist, { recursive: true });
const staging = join(dist, ".staging");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

function zip(from: string, out: string, items: string[]): void {
  rmSync(out, { force: true });
  run("zip", ["-qry", out, ...items], from);
  console.log(`  ${relative(root, out)}`);
}

function common(to: string): void {
  cpSync(join(root, "LICENSE"), join(to, "LICENSE"));
  cpSync(join(root, "CHANGELOG.md"), join(to, "CHANGELOG.md"));
}

// ------------------------------------------------------------------ relay

function signingIdentity(): string | null {
  if (process.env.PHONE_WAND_SIGN_IDENTITY) return process.env.PHONE_WAND_SIGN_IDENTITY;
  if (process.platform !== "darwin") return null;
  try {
    return probe("security", ["find-identity", "-v", "-p", "codesigning"]).match(/"(Developer ID Application: [^"]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function notarize(zipPath: string): void {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("  (not notarized: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID are not all set)");
    return;
  }
  run("xcrun", [
    "notarytool", "submit", zipPath, "--wait",
    "--apple-id", APPLE_ID, "--password", APPLE_APP_SPECIFIC_PASSWORD, "--team-id", APPLE_TEAM_ID,
  ]);
}

async function buildRelay(): Promise<void> {
  await buildAssets();
  const identity = signingIdentity();
  for (const target of relayTargets) {
    const t = RELAY_TARGETS[target];
    if (!t) throw new Error(`unknown relay target ${target}; expected one of ${Object.keys(RELAY_TARGETS).join(", ")} or all`);
    const base = `phone-wand-relay-${version}-${t.name}`;
    const dir = join(staging, base);
    mkdirSync(dir, { recursive: true });
    const exe = join(dir, t.exe);
    run("bun", ["build", "packages/relay/src/main.ts", "--compile", "--minify", `--target=bun-${target}`, "--outfile", exe]);

    if (target.startsWith("darwin")) {
      if (process.platform !== "darwin") {
        console.log(`  (${base}: built off macOS, left unsigned)`);
      } else if (!identity) {
        console.log(`  (${base}: no Developer ID identity, ad-hoc signed)`);
      } else {
        run("codesign", [
          "--force", "--timestamp", "--options", "runtime",
          "--entitlements", join(root, "scripts/entitlements.plist"),
          "--sign", identity, exe,
        ]);
        run("codesign", ["--verify", "--strict", "--verbose=2", exe]);
      }
    }

    common(dir);
    writeFileSync(join(dir, "README.txt"), relayReadme(t.exe, target));
    if (t.archive === "zip") {
      const out = join(dist, `${base}.zip`);
      zip(staging, out, [base]);
      if (target.startsWith("darwin") && identity && process.platform === "darwin") notarize(out);
    } else {
      const out = join(dist, `${base}.tar.gz`);
      run("tar", ["-czf", out, base], staging);
      console.log(`  ${relative(root, out)}`);
    }
  }
}

function relayReadme(exe: string, target: string): string {
  const start = target.startsWith("windows") ? `Double-click ${exe}, or run it from a terminal.` : `Run ./${exe} from a terminal${target.startsWith("darwin") ? ", or double-click it in Finder" : ""}.`;
  return `Phone Wand relay ${version}

Turns phones into shared pointers for a screen.

${start}
It prints a QR code and opens a dashboard in your browser. Phones on the same Wi-Fi scan the code to
join. Run "${exe} --help" for the options.

Full documentation: https://github.com/wildwinter/phone-wand
`;
}

// ------------------------------------------------------------------ JS client

async function buildJs(): Promise<void> {
  const base = `phone-wand-js-${version}`;
  const dir = join(staging, base);
  mkdirSync(dir, { recursive: true });
  const pkg = join(root, "packages/client-js");
  const esm = await Bun.build({ entrypoints: [join(pkg, "src/index.ts")], target: "browser", format: "esm" });
  const iife = await Bun.build({ entrypoints: [join(pkg, "src/global.ts")], target: "browser", format: "iife", minify: true });
  if (!esm.success || !iife.success) throw new Error("JS client build failed");
  writeFileSync(join(dir, "phone-wand.mjs"), await esm.outputs[0].text());
  writeFileSync(join(dir, "phone-wand.min.js"), await iife.outputs[0].text());
  run("bunx", ["tsc", "--declaration", "--emitDeclarationOnly", "--skipLibCheck", "--target", "ES2022", "--module", "ESNext",
    "--moduleResolution", "Bundler", "--lib", "ES2022,DOM", "--outDir", dir, join(pkg, "src/index.ts")]);
  cpSync(join(dir, "index.d.ts"), join(dir, "phone-wand.d.ts"));
  rmSync(join(dir, "index.d.ts"));
  cpSync(join(root, "examples/js"), join(dir, "examples"), { recursive: true });
  cpSync(join(pkg, "README.md"), join(dir, "README.md"));
  common(dir);
  zip(staging, join(dist, `${base}.zip`), [base]);
}

// ------------------------------------------------------------------ engines

const JUNK = /(^|\/)(\.DS_Store|Library|Temp|Logs|obj|bin|Binaries|Intermediate|Saved|DerivedDataCache|\.godot|\.vs|\.idea)(\/|$)|\.import$/;

function copyClean(from: string, to: string): void {
  cpSync(from, to, { recursive: true, filter: (src) => !JUNK.test(relative(from, src)) });
}

function buildUnity(): void {
  const src = join(root, "clients/unity/PhoneWand");
  if (!existsSync(src)) return console.log("  (no Unity package yet, skipped)");
  const base = `phone-wand-unity-${version}`;
  const dir = join(staging, base);
  copyClean(src, join(dir, "PhoneWand"));
  common(dir);
  zip(staging, join(dist, `${base}.zip`), [base]);
}

function buildGodot(): void {
  const src = join(root, "clients/godot/addons/phone_wand");
  if (!existsSync(src)) return console.log("  (no Godot addon yet, skipped)");
  const base = `phone-wand-godot-${version}`;
  const addon = join(staging, base, "addons/phone_wand");
  copyClean(src, addon);
  common(addon);
  zip(join(staging, base), join(dist, `${base}.zip`), ["addons"]);
}

function buildUnreal(): void {
  const plugin = join(root, "clients/unreal/PhoneWand");
  if (!existsSync(plugin)) return console.log("  (no Unreal plugin yet, skipped)");
  const base = `phone-wand-unreal-${version}`;
  const dir = join(staging, base);
  copyClean(plugin, join(dir, "PhoneWand"));
  const demo = join(root, "clients/unreal/PhoneWandDemo");
  if (existsSync(demo)) copyClean(demo, join(dir, "PhoneWandDemo"));
  common(join(dir, "PhoneWand"));
  zip(staging, join(dist, `${base}.zip`), [base]);
}

// ------------------------------------------------------------------ main

console.log(`phone-wand ${version}: building ${[...only].join(", ")}`);
if (only.has("relay")) await buildRelay();
if (only.has("js")) await buildJs();
if (only.has("unity")) buildUnity();
if (only.has("godot")) buildGodot();
if (only.has("unreal")) buildUnreal();
rmSync(staging, { recursive: true, force: true });
