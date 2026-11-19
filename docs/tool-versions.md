# Tool versions

`mise.toml` is the one place a tool version is pinned. That covers Bun and every external binary the repository runs, starting with rumdl. Local runs, CI and Cinch all read it.

## Change a version

1. Edit the version in `mise.toml`.
2. Run `mise lock`. It refreshes `mise.lock`, which records the download URL and checksum for each platform.
3. For Bun only, update the three places in `package.json` that repeat the version: `packageManager`, `engines.bun` and `@types/bun`. Then run `bun install`.
4. Run `bun run check`. `tests/pins.test.ts` fails if any of those files disagree with `mise.toml`.

If mise refuses to read `mise.toml` because the file is not trusted, which its paranoid mode does, run `mise trust` once in the checkout.

## Why Bun appears twice

`package.json` has to state the Bun version for tools that read `packageManager` and `engines`, and `@types/bun` is an npm package that tracks the runtime. Those entries are copies. The test keeps them equal to the pin, so a copy cannot drift without CI failing.

## Without mise

`scripts/bootstrap.sh` uses mise when it is installed and installs every pinned tool at its exact version. Without mise it accepts a Bun at or above the pin and prints a warning, because a newer runtime on the host is not a reason to stop. It does not install the other tools in that case. CI always uses mise, so CI always runs the exact pins.

## How a Cinch adapter learns its engine's version

An adapter reads the required version from the `[tools]` table of `mise.toml`. The file is plain TOML, so reading it does not need mise installed. The adapter compares that with the version the binary on `PATH` reports. Cinch does not install tools. A required tool that is missing or at the wrong version makes the step incomplete, never passed.

## Dependency versions across packages

mise pins tools. It does not keep npm dependency versions consistent across workspace packages, which is what syncpack does. Its experimental `mise deps` command (checked in mise 2026.11.10) runs package-manager installs; it does not compare versions between packages. Today only the workspace root declares dev dependencies, so there is nothing to keep in step. When a second package needs a shared dependency, the plan is a Bun catalog in the root `package.json`, so the version is written once. A checker such as Sherif or syncpack is part of the install policy decision in FIT-32.
