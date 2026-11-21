# Tool versions

`mise.toml` is the one place a tool version is pinned. That covers Bun and every external binary the repository runs, starting with rumdl and Taplo. Local runs, CI and Cinch all read it.

## Change a version

1. Edit the version in `mise.toml`.
2. Run `mise lock`. It refreshes `mise.lock`, which records the download URL and checksum for each platform.
3. For Bun only, update the three places in `package.json` that repeat the version: `packageManager`, `engines.bun` and `@types/bun`. Then run `bun install`.
4. Run `bun run check`. `tests/pins.test.ts` fails if any of those files disagree with `mise.toml`.

If mise refuses to read `mise.toml` because the file is not trusted, which its paranoid mode does, run `mise trust` once in the checkout.

## Why Bun appears twice

`package.json` has to state the Bun version for tools that read `packageManager` and `engines`, and `@types/bun` is an npm package that tracks the runtime. Those entries are copies. The test keeps them equal to the pin, so a copy cannot drift without CI failing.

## Without mise

`scripts/bootstrap.sh` uses mise when it is installed and installs every pinned tool at its exact version. Without mise it accepts a Bun at or above the pin and prints a warning, because a newer runtime on the host is not a reason to stop. It does not install the other tools in that case, so the `cinch check` step of `bun run check` reports required engines such as rumdl, Lychee and Taplo as missing and the check fails until they are on `PATH`. CI always uses mise, so CI always runs the exact pins.

## How a Cinch adapter learns its engine's version

`adapters/pins.ts` reads the `[tools]` table of `mise.toml`, and the registry hands each adapter the version pinned for its tool. The file is plain TOML, so reading it does not need mise installed. Only an exact three-part version counts as a pin. The runner compares the pin with the version the binary on `PATH` reports. Cinch does not install tools. A required tool that is missing or at the wrong version makes the step incomplete, never passed.

## A tool newer than its pin

A host often has a newer tool than the pin, and that alone should not stop local work. So a tool that is newer than its pin still runs when it is inside the range its adapter was tested on. The run prints a note that names the installed version, the pin and the range, and the exit code does not change. `cinch explain` and `cinch doctor` show the same note beside the tool.

With `--strict`, or when the `CI` environment variable is `true`, only the exact pin will do, and a newer tool makes its steps incomplete as before. A tool older than its pin, or outside the tested range, is always incomplete.

The Taplo step also lists a separately pinned WebAssembly engine for recovery from the macOS system proxy panic. Strict version checks still apply to the native engine. If recovery completes, the result names the WebAssembly version that checked the file.

When a repository does not pin a tool, the adapter falls back to the range of versions it was checked against, which it states in its own folder.

## How installs behave

The `[install]` table states the linker and minimum release age. Cinch generates this repository's `bunfig.toml` from that table. New package resolution waits seven days, and an existing reviewed lockfile retains its resolved versions. Deliberate package or exact-version exceptions belong in `release_age_exempt`. The [install policy guide](install-policy.md) covers adoption and authored configs.

## Dependency versions across packages

mise pins tools. The three workspace manifests currently share no direct external dependency names, so each version is stated in one manifest. When a second package needs a shared dependency, put that version in a Bun catalog in the root `package.json`. The CLI's `workspace:*` dependency on core continues to follow the workspace package.

## GitHub Actions pins

Pinact writes the commit SHA and release comment for each external action. Its own version is pinned in mise alongside actionlint and zizmor. The [workflow guide](workflows.md) describes offline checking and the deliberate action update command.
