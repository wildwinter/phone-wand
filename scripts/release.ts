// Cut a release: set the version everywhere, date the changelog, commit, tag and push. The tag starts
// .github/workflows/release.yml, which tests, builds every platform's files and publishes the
// GitHub Release.
//
//   bun scripts/release.ts 0.2.0
//   bun scripts/release.ts 0.2.0 --dry-run     check and show, change nothing
//
// Write the release notes under "## [Unreleased]" in CHANGELOG.md and commit them first.

import { execFileSync } from "node:child_process";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: "inherit" });
const fail = (msg: string): never => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const version = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) fail("usage: bun scripts/release.ts <major.minor.patch> [--dry-run]");
const tag = `v${version}`;

if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("releases are cut from main");
if (git("status", "--porcelain")) fail("the working tree is not clean; commit or stash first");
git("fetch", "--quiet", "origin");
if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) fail("main is not level with origin/main; pull or push first");
if (git("tag", "--list", tag)) fail(`tag ${tag} already exists`);

console.log(`release: checks and tests for ${tag}`);
run("bun", ["run", "typecheck"]);
run("bun", ["run", "test"]);
run("bun", ["scripts/conformance.ts", "--check"]);

if (dry) {
  console.log(`release: dry run passed; would set ${version}, commit, tag ${tag} and push`);
  process.exit(0);
}

run("bun", ["scripts/version.ts", "set", version]);
run("git", ["commit", "-am", `Release ${version}`]);
run("git", ["tag", "-a", tag, "-m", `Phone Wand ${version}`]);
run("git", ["push", "origin", "main"]);
run("git", ["push", "origin", tag]);
console.log(`release: pushed ${tag}. Follow the build at https://github.com/wildwinter/phone-wand/actions`);
