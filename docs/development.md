# Development

## Layout

| Folder | What |
|---|---|
| `packages/core` | Shared TypeScript: maths, frames, calibration, smoothing, protocol types. |
| `packages/relay` | The relay: sessions, HTTPS and WebSocket servers, certificates, the command line. |
| `packages/phone` | The phone page. |
| `packages/dashboard` | The dashboard, built on the JS client. |
| `packages/client-js` | The JavaScript client library. |
| `clients/unity` | The Unity package, a demo project and a dotnet test host. |
| `clients/godot` | The Godot addon, its demo and tests. |
| `clients/unreal` | The Unreal plugin and a demo project. |
| `conformance` | The conformance suite (generated). |
| `examples` | Small examples shipped with the client packages. |
| `scripts` | Build, packaging, conformance and release scripts. |
| `docs` | User documentation. |

## Building from source

You need [Bun](https://bun.sh) 1.3 or later.

```bash
bun install
bun run relay            # build the phone page and dashboard, then start the relay
bun run sim              # the same, with three simulated players
bun run test             # unit and conformance tests
bun run typecheck
```

`scripts/build-assets.ts` bundles the phone page, the dashboard and the JS client's `<script>` build
into `packages/relay/src/generated/`, which the relay serves. Run it (or `bun run relay`) after
changing any of them.

## Packaging

```bash
bun scripts/dist.ts                      # everything, with the relay for this computer
bun scripts/dist.ts --relay=all          # the relay for every platform
bun scripts/dist.ts --only=js,godot      # just some packages
```

Files land in `dist/`, which git ignores. On a Mac, the macOS relay is packaged as a disk image.
With a Developer ID Application certificate in the keychain, the program and the disk image are
signed; with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` set, the disk image is
also notarized and the ticket stapled to it, so it opens without a warning even offline. (A bare
program can't carry a stapled ticket, which is why macOS doesn't get a zip.)

## Versions and the changelog

Everything shares one version, held in the root `package.json`. `bun scripts/version.ts check`
confirms every manifest agrees (CI runs it).

Add user-facing notes to `CHANGELOG.md` under `## [Unreleased]` as you go, in the same commit as the
change. Update the documentation in `docs/` in the same commit too.

## Releasing

1. Make sure `CHANGELOG.md` has notes under `## [Unreleased]`, committed and pushed.
2. Run the engine checks that CI can't: `scripts/check-unity.sh` and `scripts/check-unreal.sh`.
3. Run:

   ```bash
   bun scripts/release.ts 0.2.0
   ```

   It checks you're on a clean, pushed `main`, runs the tests, sets the version everywhere, dates the
   changelog section, commits, tags `v0.2.0` and pushes.

4. The **Release** workflow tests again, builds every file, and publishes the GitHub Release with
   the changelog section as its notes. Follow it in the Actions tab.

To try the release build without publishing (for example after changing macOS signing), run the
workflow by hand with **publish** off and a branch such as `main` as the tag: every file is built,
signed and notarized, and kept as downloadable artifacts of the run.

If a release build fails after the tag is pushed, fix the problem on `main`, then re-run the
workflow by hand for the same tag (Actions, Release, Run workflow) only if the fix doesn't need to
be in the tagged code; otherwise release the next patch version.

### Signing secrets

The release workflow signs and notarizes the macOS relay using these repository secrets:

| Secret | What |
|---|---|
| `CSC_LINK` | A Developer ID Application certificate and key, exported as .p12 and base64 encoded. |
| `CSC_KEY_PASSWORD` | The .p12 password. |
| `APPLE_ID` | The Apple ID used for notarization. |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID. |
| `APPLE_TEAM_ID` | The team ID. |

Without them the macOS binaries are still built, but unsigned (ad-hoc), and macOS will refuse to
open them from a download until the user allows them in System Settings. Windows binaries are not
signed; SmartScreen asks users to confirm the first run.
