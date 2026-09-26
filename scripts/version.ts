// One version number for everything: the root package.json holds it, and every manifest follows.
//
//   bun scripts/version.ts check            every manifest matches the root version
//   bun scripts/version.ts set 0.2.0        write 0.2.0 everywhere and date the changelog section
//   bun scripts/version.ts tag v0.2.0       check that a release tag matches, with a dated changelog
//   bun scripts/version.ts notes 0.2.0      print that version's changelog section (release notes)

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const write = (p: string, s: string) => writeFileSync(join(root, p), s);

interface Manifest {
  path: string;
  get(text: string): string | null;
  set(text: string, version: string): string;
}

const jsonVersion = (path: string): Manifest => ({
  path,
  get: (t) => JSON.parse(t).version ?? null,
  set: (t, v) => t.replace(/("version"\s*:\s*")[^"]*(")/, `$1${v}$2`),
});

const MANIFESTS: Manifest[] = [
  jsonVersion("package.json"),
  ...readdirSync(join(root, "packages")).map((p) => jsonVersion(`packages/${p}/package.json`)),
  jsonVersion("clients/unity/PhoneWand/package.json"),
  {
    path: "clients/godot/addons/phone_wand/plugin.cfg",
    get: (t) => t.match(/^version="([^"]*)"/m)?.[1] ?? null,
    set: (t, v) => t.replace(/^version="[^"]*"/m, `version="${v}"`),
  },
  {
    path: "clients/unreal/Plugins/PhoneWand/PhoneWand.uplugin",
    get: (t) => JSON.parse(t).VersionName ?? null,
    // Unreal also wants an increasing integer Version; bump it with every release.
    set: (t, v) => {
      const n = (JSON.parse(t).Version ?? 0) + 1;
      return t.replace(/("VersionName"\s*:\s*")[^"]*(")/, `$1${v}$2`).replace(/("Version"\s*:\s*)\d+/, `$1${n}`);
    },
  },
];

const present = () => MANIFESTS.filter((m) => existsSync(join(root, m.path)));
const rootVersion = () => JSON.parse(read("package.json")).version as string;

function check(): number {
  const want = rootVersion();
  let bad = 0;
  for (const m of present()) {
    const have = m.get(read(m.path));
    if (have !== want) {
      console.error(`${m.path}: version ${have}, expected ${want}`);
      bad++;
    }
  }
  if (!bad) console.log(`version ${want}: ${present().length} manifests agree`);
  return bad;
}

function notes(version: string): string | null {
  const lines = read("CHANGELOG.md").split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case "check":
    process.exit(check() ? 1 : 0);
  case "set": {
    if (!arg || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg)) {
      console.error("usage: bun scripts/version.ts set <major.minor.patch>");
      process.exit(2);
    }
    const changelog = read("CHANGELOG.md");
    if (!/^## \[Unreleased\]\s*\n+(?!## )\S/m.test(changelog)) {
      console.error("CHANGELOG.md has nothing under ## [Unreleased]. Write the release notes first.");
      process.exit(1);
    }
    if (changelog.includes(`## [${arg}]`)) {
      console.error(`CHANGELOG.md already has a ${arg} section.`);
      process.exit(1);
    }
    for (const m of present()) write(m.path, m.set(read(m.path), arg));
    const date = new Date().toISOString().slice(0, 10);
    write("CHANGELOG.md", changelog.replace("## [Unreleased]", `## [Unreleased]\n\n## [${arg}] - ${date}`));
    console.log(`set version ${arg} in ${present().length} manifests and dated the changelog`);
    process.exit(check() ? 1 : 0);
  }
  case "tag": {
    const version = (arg ?? "").replace(/^v/, "");
    if (version !== rootVersion()) {
      console.error(`tag ${arg} does not match the repository version ${rootVersion()}`);
      process.exit(1);
    }
    if (!new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}`, "m").test(read("CHANGELOG.md"))) {
      console.error(`CHANGELOG.md has no dated ${version} section`);
      process.exit(1);
    }
    process.exit(check() ? 1 : 0);
  }
  case "notes": {
    const n = notes(arg ?? rootVersion());
    if (!n) {
      console.error(`no changelog section for ${arg}`);
      process.exit(1);
    }
    console.log(n);
    break;
  }
  default:
    console.error("usage: bun scripts/version.ts check | set <version> | tag <tag> | notes <version>");
    process.exit(2);
}
