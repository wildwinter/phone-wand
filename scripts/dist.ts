// Builds the release files into dist/, one per platform or engine:
//
//   phone-wand-relay-<ver>-macos-arm64.dmg     signed, notarized and stapled disk image
//   phone-wand-relay-<ver>-macos-x64.dmg       (a zip instead when built off macOS)
//   phone-wand-relay-<ver>-windows-x64.zip     tray app and relay, unsigned by policy
//   phone-wand-relay-<ver>-linux-x64.tar.gz
//   phone-wand-relay-<ver>-linux-arm64.tar.gz
//   phone-wand-relay-<ver>-embed.zip           the relay for every platform, for games to ship
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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildAssets } from "./build-assets.js";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const version: string = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const run = (cmd: string, args: string[], cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const probe = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" });

// macOS gets a disk image: a bare program can't carry a notarization ticket, so a downloaded one
// needs Apple's servers to vouch for it on first run, and shows a malware warning when that lookup
// fails. A disk image can have the ticket stapled to it, so it works offline and straight away.
const RELAY_TARGETS: Record<string, { name: string; exe: string; archive: "zip" | "tar" | "dmg" }> = {
  "darwin-arm64": { name: "macos-arm64", exe: "phone-wand", archive: "dmg" },
  "darwin-x64": { name: "macos-x64", exe: "phone-wand", archive: "dmg" },
  "windows-x64": { name: "windows-x64", exe: "phone-wand-relay.exe", archive: "zip" },
  "linux-x64": { name: "linux-x64", exe: "phone-wand", archive: "tar" },
  "linux-arm64": { name: "linux-arm64", exe: "phone-wand", archive: "tar" },
};

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v] as [string, string];
  }),
);
const only = new Set((args.get("only") ?? "relay,embed,js,unity,godot,unreal").split(","));
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

/**
 * Notarize a file and staple the ticket to `staple` (the file itself by default: a disk image; for an
 * app, submit a zip of it and staple the app). Returns false when there are no credentials.
 */
function notarizeAndStaple(dmgPath: string, staple: string | null = dmgPath): boolean {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("  (not notarized: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID are not all set)");
    return false;
  }
  // --wait exits 0 even when Apple rejects the upload, so read the status it reports.
  const out = execFileSync("xcrun", [
    "notarytool", "submit", dmgPath, "--wait", "--output-format", "json",
    "--apple-id", APPLE_ID, "--password", APPLE_APP_SPECIFIC_PASSWORD, "--team-id", APPLE_TEAM_ID,
  ], { cwd: root, encoding: "utf8" });
  const result = JSON.parse(out) as { status?: string; id?: string };
  if (result.status !== "Accepted") {
    throw new Error(`notarization of ${dmgPath} was ${result.status} (submission ${result.id}); see: xcrun notarytool log ${result.id}`);
  }
  if (!staple) return true;
  run("xcrun", ["stapler", "staple", staple]);
  run("xcrun", ["stapler", "validate", staple]);
  return true;
}

const embedDir = join(dist, "embed");

async function buildRelay(): Promise<void> {
  await buildAssets();
  const identity = signingIdentity();
  await buildRelayTargets(identity);
  macEmbed(identity);
}

async function buildRelayTargets(identity: string | null): Promise<void> {
  for (const target of relayTargets) {
    const t = RELAY_TARGETS[target];
    if (!t) throw new Error(`unknown relay target ${target}; expected one of ${Object.keys(RELAY_TARGETS).join(", ")} or all`);
    const base = `phone-wand-relay-${version}-${t.name}`;
    const dir = join(staging, base);
    mkdirSync(dir, { recursive: true });
    const exe = join(dir, t.exe);
    run("bun", ["build", "packages/relay/src/main.ts", "--compile", "--minify", `--target=bun-${target}`, "--outfile", exe]);
    // A bare copy for games to ship (see buildEmbed); macOS copies are merged and signed below.
    const part = join(embedDir, target.startsWith("darwin") ? `macos-${target.slice(7)}` : target);
    mkdirSync(part, { recursive: true });
    cpSync(exe, join(part, target.startsWith("windows") ? "phone-wand-relay.exe" : "phone-wand-relay"));

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

    if (target.startsWith("windows")) buildTray(dir);
    common(dir);
    writeFileSync(join(dir, "README.txt"), relayReadme(t.exe, target));
    if (t.archive === "dmg" && process.platform === "darwin") {
      // A Mac app alongside the command-line tool. Finder won't open a bare command-line program
      // that came from the internet, however it is signed ("does not seem to be an app"), so the
      // app is what people double-click. It runs the same relay, with the dashboard as its window.
      // The app is a small native wrapper (scripts/macos/PhoneWandApp.swift) that gives the relay a
      // Dock icon and menus; the relay binary sits beside it and is the only thing in the image.
      const app = join(dir, "Phone Wand.app");
      mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
      mkdirSync(join(app, "Contents/Resources"), { recursive: true });
      const relayInApp = join(app, "Contents/MacOS/phone-wand-relay");
      cpSync(exe, relayInApp);
      rmSync(exe);
      run("swiftc", [
        "-O", "-target", `${target === "darwin-arm64" ? "arm64" : "x86_64"}-apple-macos13.0`,
        join(root, "scripts/macos/PhoneWandApp.swift"), "-o", join(app, "Contents/MacOS/Phone Wand"),
      ]);
      cpSync(join(root, "scripts/macos/AppIcon.icns"), join(app, "Contents/Resources/AppIcon.icns"));
      writeFileSync(join(app, "Contents/Info.plist"), infoPlist());
      if (identity) {
        // Inside out: the relay (which needs the JIT entitlements), then the app around it.
        run("codesign", [
          "--force", "--timestamp", "--options", "runtime",
          "--entitlements", join(root, "scripts/entitlements.plist"),
          "--sign", identity, relayInApp,
        ]);
        run("codesign", ["--force", "--timestamp", "--options", "runtime", "--sign", identity, app]);
        run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
        const appZip = join(staging, `${base}-app.zip`);
        run("ditto", ["-c", "-k", "--keepParent", app, appZip]);
        notarizeAndStaple(appZip, app);
        rmSync(appZip, { force: true });
      }
      symlinkSync("/Applications", join(dir, "Applications"));

      const out = join(dist, `${base}.dmg`);
      rmSync(out, { force: true });
      run("hdiutil", ["create", "-volname", `Phone Wand relay ${version}`, "-srcfolder", dir, "-fs", "HFS+", "-format", "UDZO", "-ov", "-quiet", out]);
      if (identity) {
        run("codesign", ["--force", "--timestamp", "--sign", identity, out]);
        notarizeAndStaple(out);
      }
      console.log(`  ${relative(root, out)}`);
    } else if (t.archive === "zip" || t.archive === "dmg") {
      zip(staging, join(dist, `${base}.zip`), [base]);
    } else {
      const out = join(dist, `${base}.tar.gz`);
      run("tar", ["-czf", out, base], staging);
      console.log(`  ${relative(root, out)}`);
    }
  }
}

/**
 * Phone Wand.exe, the Windows tray app (scripts/windows/PhoneWandTray), beside the relay. Needs the
 * dotnet SDK; without it the zip has only the relay, with a note.
 */
function buildTray(dir: string): void {
  const out = join(staging, "tray");
  try {
    run("dotnet", [
      "build", join(root, "scripts/windows/PhoneWandTray"), "-c", "Release", `-p:Version=${version}`,
      "-o", out, "-nologo", "-v", "quiet",
    ]);
  } catch {
    console.log("  (no dotnet SDK: the Windows zip has the relay but not the tray app)");
    return;
  }
  cpSync(join(out, "Phone Wand.exe"), join(dir, "Phone Wand.exe"));
  cpSync(join(out, "Phone Wand.exe.config"), join(dir, "Phone Wand.exe.config"));
}

/**
 * The macOS relay for games: one universal binary (both processors), signed with the JIT
 * entitlements and notarized, in dist/embed/macos. Games that are themselves signed re-sign it.
 */
function macEmbed(identity: string | null): void {
  const parts = ["macos-arm64", "macos-x64"].map((p) => join(embedDir, p, "phone-wand-relay")).filter((p) => existsSync(p));
  if (!parts.length) return;
  const outDir = join(embedDir, "macos");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, "phone-wand-relay");
  if (parts.length === 2 && process.platform === "darwin") run("lipo", ["-create", ...parts, "-output", out]);
  else cpSync(parts[0], out);
  rmSync(join(embedDir, "macos-arm64"), { recursive: true, force: true });
  rmSync(join(embedDir, "macos-x64"), { recursive: true, force: true });
  if (process.platform !== "darwin" || !identity) return;
  run("codesign", [
    "--force", "--timestamp", "--options", "runtime",
    "--entitlements", join(root, "scripts/entitlements.plist"), "--sign", identity, out,
  ]);
  run("codesign", ["--verify", "--strict", "--verbose=2", out]);
  // A bare program can't carry a stapled ticket, but notarizing it means Gatekeeper finds the
  // ticket online when a game starts it.
  const zipPath = join(staging, "embed-macos.zip");
  run("ditto", ["-c", "-k", out, zipPath]);
  notarizeAndStaple(zipPath, null);
  rmSync(zipPath, { force: true });
}

/** phone-wand-relay-<ver>-embed.zip: the relay for every platform, laid out for games to ship. */
function buildEmbed(): void {
  if (!existsSync(embedDir)) return console.log("  (no relay binaries in dist/embed: build the relay first)");
  const base = `phone-wand-relay-${version}-embed`;
  const dir = join(staging, base, "phone-wand-relay");
  cpSync(embedDir, dir, { recursive: true });
  cpSync(join(root, "LICENSE"), join(dir, "LICENSE"));
  writeFileSync(join(dir, "README.txt"), `Phone Wand relay ${version}, for shipping with a game or app

One folder per platform: macos (a universal binary for Apple silicon and Intel), windows-x64,
linux-x64 and linux-arm64. Keep the folder names: the Phone Wand client libraries look for
phone-wand-relay/<platform>/phone-wand-relay (phone-wand-relay.exe on Windows).

Where to put this folder for Unity, Godot and Unreal, and how to sign it inside a macOS game:
https://github.com/wildwinter/phone-wand/blob/main/docs/shipping.md
`);
  zip(join(staging, base), join(dist, `${base}.zip`), ["phone-wand-relay"]);
}

function infoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Phone Wand</string>
  <key>CFBundleDisplayName</key><string>Phone Wand</string>
  <key>CFBundleIdentifier</key><string>se.storytools.phonewand</string>
  <key>CFBundleExecutable</key><string>Phone Wand</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>Ian Thomas, storytools.se. MIT licence.</string>
</dict>
</plist>
`;
}

function relayReadme(exe: string, target: string): string {
  const start = target.startsWith("windows")
    ? `Double-click Phone Wand.exe. Its icon appears in the notification area (bottom right, perhaps under\nthe ^ arrow) while the relay runs, and the dashboard opens in your browser. Click the icon to reopen\nthe dashboard; right-click it and choose Quit to stop the relay. Keep phone-wand-relay.exe in the same\nfolder.\n\nThe first time, SmartScreen may say it doesn't recognise the app: choose More info, then Run anyway.\nWhen Windows Firewall asks, allow access on private networks, or phones can't connect.\n\nThe relay also runs from a terminal, with options: phone-wand-relay.exe --help`
    : target.startsWith("darwin")
      ? `Drag Phone Wand to Applications, then open it. It shows in the Dock while the relay runs and opens\nthe dashboard in your browser. Click its Dock icon to reopen the dashboard; quit it to stop the relay.\n\nThe relay also runs from Terminal, with options:\n  "/Applications/Phone Wand.app/Contents/MacOS/phone-wand-relay" --help`
      : `Run ./${exe} from a terminal.`;
  return `Phone Wand relay ${version}

Turns phones into shared pointers for a screen.

${start}
The dashboard shows a QR code; phones on the same Wi-Fi scan it to join.${target.startsWith("linux") ? `\nRun "${exe} --help" for the command-line options.` : ""}

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
  // Starting the relay from Node, Bun or Deno (docs/shipping.md); kept apart for browsers.
  const node = await Bun.build({ entrypoints: [join(pkg, "src/node.ts")], target: "node", format: "esm" });
  if (!node.success) throw new Error("JS node helper build failed");
  writeFileSync(join(dir, "phone-wand-node.mjs"), await node.outputs[0].text());
  run("bunx", ["tsc", "--declaration", "--emitDeclarationOnly", "--skipLibCheck", "--target", "ES2022", "--module", "ESNext",
    "--moduleResolution", "Bundler", "--lib", "ES2022,DOM", "--types", "node", "--outDir", dir,
    join(pkg, "src/index.ts"), join(pkg, "src/node.ts")]);
  cpSync(join(dir, "index.d.ts"), join(dir, "phone-wand.d.ts"));
  cpSync(join(dir, "node.d.ts"), join(dir, "phone-wand-node.d.ts"));
  rmSync(join(dir, "index.d.ts"));
  rmSync(join(dir, "node.d.ts"));
  cpSync(join(root, "examples/js"), join(dir, "examples"), { recursive: true });
  cpSync(join(pkg, "README.md"), join(dir, "README.md"));
  common(dir);
  zip(staging, join(dist, `${base}.zip`), [base]);
}

// ------------------------------------------------------------------ engines

// Only files git tracks go into a package, so whatever an editor or build has generated locally
// (Library, Binaries, Saved, .godot, DefaultInput.ini and so on) never ships.
const tracked = new Set(probe("git", ["ls-files", "-z"]).split("\0").filter(Boolean).map((f) => join(root, f)));

function copyClean(from: string, to: string): void {
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      if (tracked.has(src)) return true;
      // Keep directories that contain tracked files.
      const prefix = src + "/";
      for (const f of tracked) if (f.startsWith(prefix)) return true;
      return false;
    },
  });
}

function buildUnity(): void {
  const src = join(root, "clients/unity/PhoneWand");
  if (!existsSync(src)) return console.log("  (no Unity package yet, skipped)");
  // The zip holds just the package folder, ready to drop into a project's Packages folder.
  const base = `phone-wand-unity-${version}`;
  const dir = join(staging, base);
  copyClean(src, join(dir, "PhoneWand"));
  cpSync(join(root, "CHANGELOG.md"), join(dir, "PhoneWand/CHANGELOG.md"));
  zip(dir, join(dist, `${base}.zip`), ["PhoneWand"]);
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
  const plugin = join(root, "clients/unreal/Plugins/PhoneWand");
  if (!existsSync(plugin)) return console.log("  (no Unreal plugin yet, skipped)");
  const base = `phone-wand-unreal-${version}`;
  const dir = join(staging, base);
  // The same layout as the repository: Plugins/PhoneWand beside PhoneWandDemo, whose .uproject
  // looks in ../Plugins. (Pointing it at a folder that also holds the project breaks packaging.)
  copyClean(plugin, join(dir, "Plugins/PhoneWand"));
  const demo = join(root, "clients/unreal/PhoneWandDemo");
  if (existsSync(demo)) copyClean(demo, join(dir, "PhoneWandDemo"));
  common(join(dir, "Plugins/PhoneWand"));
  // The plugin and the demo side by side at the top of the zip.
  zip(dir, join(dist, `${base}.zip`), existsSync(demo) ? ["Plugins", "PhoneWandDemo"] : ["Plugins"]);
}

// ------------------------------------------------------------------ main

console.log(`phone-wand ${version}: building ${[...only].join(", ")}`);
if (only.has("relay")) {
  rmSync(embedDir, { recursive: true, force: true });
  await buildRelay();
}
if (only.has("embed")) buildEmbed();
if (only.has("js")) await buildJs();
if (only.has("unity")) buildUnity();
if (only.has("godot")) buildGodot();
if (only.has("unreal")) buildUnreal();
rmSync(staging, { recursive: true, force: true });
