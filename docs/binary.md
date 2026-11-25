# The standalone binary

The standalone `rope` executable embeds Bun's runtime. A repository without a Bun installation, such as a Python repository, can run it with Git and its pinned external engines on `PATH`.

This page covers building the executable and qualifying an installation from a local artifact. See [Prepare a standalone release](standalone-candidate.md) for the native archive workflow and the `http:rope` mise recipe.

## Build it

Build the Ropes executable with the public `rope` interface:

```sh
bun run build:rope dist/rope
bun run build:rope dist/rope-linux-arm64 bun-linux-arm64
./dist/rope --version
./dist/rope doctor --json
./dist/rope check README.md --json
```

The executable includes Bun's runtime, so the consuming repository needs Git and its pinned external engines on `PATH`. It can run in a repository with no `package.json`. `rope --version` reports `rope <version> (binary)`. It uses the same public commands and JSON contracts as the npm CLI, and `rope doctor` inspects the setup and active settings without writing to the repository. The native acceptance suite compares the compiled executable with the package and checks fenced-code repairs with Bun absent from `PATH`.

The first argument is the file to write. The second is `bun-darwin-arm64`, `bun-linux-arm64` or `bun-linux-x64`, and without it the build is for the machine it runs on. Building for another platform downloads that platform's Bun runtime.

The build writes one file and publishes nothing.

The targeted `Standalone` workflow runs the binary acceptance tests on native Linux x64, Linux arm64 and macOS arm64 runners when core, build or toolchain inputs change. Each job uses the pinned Bun and engines, builds its host binary, and runs the existing no-Bun checks, fenced-code repair and embedded-rule proof. The fixtures give child commands a dedicated directory containing only the selected engines and Git, so a preinstalled Bun elsewhere on a runner cannot hide missing standalone support.

## Install a checked local artifact with mise

Use the native `rope` archive for the consumer's platform and record the archive's SHA-256 digest. The consumer needs mise and its selected engines on `PATH`. Its `mise.toml` pins the exact version, local file URL and expected digest.

```toml
[tools."http:rope"]
version = "0.1.0-canary.4"
url = "file:///absolute/path/to/ropes-0.1.0-canary.4-darwin-arm64.tar.gz"
bin = "rope"
checksum = "sha256:REPLACE_WITH_THE_ARCHIVE_SHA256"
```

An approved release uses an immutable version that matches the executable's `rope --version`, with its own artifact URL and checksum. The example uses the version reported by a local build from the npm canary source.

mise reuses a tool already installed under the same backend and version, even if its configured URL or checksum changed. A release upgrade needs a new version identity together with the new artifact URL and checksum. For a local candidate rebuilt at the same version, use `mise install --force http:rope` to make mise retrieve and verify the configured bytes again. Changing the version label alone still downloads the same file when its URL is fixed.

```sh
mise install --force http:rope
mise exec -- rope --version
mise exec -- rope init
mise exec -- rope init --yes
mise exec -- rope check --strict --json
```

Review the config through the repository's normal mise trust process before installation. Commit the exact artifact location and expected checksum with the policy change. A `file://` URL depends on that absolute path existing on each consumer host. For a multi-platform repository, put the URL and checksum under `[tools."http:rope".platforms]` with `macos-arm64`, `linux-x64`, and `linux-arm64` entries for the corresponding builds. An authenticated artifact download can populate those local paths after release approval. [mise HTTP backend](https://mise.jdx.dev/dev-tools/backends/http.html)

The automatic mise fixture tests a raw `rope` executable with isolated data, config, and cache directories. It covers digest rejection, forced reinstall, and same-version caching. For a release candidate, use the separate [standalone archive qualification](standalone-candidate.md#verify-a-clean-install) to install the `rope` archive through mise and compare the results with the package CLI with Bun absent from `PATH`.

## What is inside

- The public `rope` command and its supported verbs.
- The presets, as text. The binary writes the same `.ropes/configs/presets/` files as the package of the same version.
- The rules Ropes ships, as text. The binary still needs `ast-grep` on `PATH` to run them.

A repository still pins and installs rumdl, native Taplo and the other primary engines itself. `rope doctor` reports a missing primary engine. The macOS binary carries the same Taplo WebAssembly recovery tool as the npm package.

The standalone version output is `rope <version> (binary)`. The package version output includes the path to the selected entry point.

## What works with no Bun

Markdown and TOML work: the binary plans, checks, fixes and keeps the Markdown preset with only the engines on `PATH`. A test builds the binary, runs it with no Bun in reach, and compares its `check` output with the package's.

The Markdown preset formats JavaScript and TypeScript fenced blocks by calling `bun`. The binary has Bun's runtime inside it, so it stands in: it keeps a small `bun` command in the user's cache folder (`$XDG_CACHE_HOME/cinch/stand-in/`, or `~/.cache/cinch/stand-in/`) that starts the binary as Bun, and puts that folder last on the `PATH` the engines get. A `bun` the machine already has is found first. An empty, relative or checkout-local XDG cache falls back to the home cache. Cinch checks the helper directory against the outermost enclosing checkout, resolving aliases before writing, and uses it only when it is outside the checkout. If it cannot create a helper and the engine needs Bun, the check reports the affected file as incomplete. A test formats `ts` and `js` blocks with no Bun in reach and compares the result with the package's.

The lint, format and TypeScript presets are TypeScript or build on packages from npm. The binary can write those files, but a repository with no Bun or Node has nothing to run them with. They are off unless the Cinch config asks for them.

## Measured

On Linux x64 with Bun 1.4.4, on 2026-11-20:

- Size: 109 MB. Almost all of it is the Bun runtime.
- Build: under a second for the host platform.
- The historical Cinch build started in about 60 ms for `cinch --version`.

## Still open

- The first release needs approval of the exact versioned archives, source commit, and digests. Verify the public GitHub release downloads and clean installs against that record after publication.
