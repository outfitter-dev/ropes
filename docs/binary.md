# The standalone binary

Cinch is a Bun program. A repository with no Bun, such as a Python one, can still run it from one executable that has Bun's runtime inside it.

This page covers building the executable and qualifying an installation from a local artifact. The first published release still needs approval.

## Build it

```sh
bun run build:binary dist/cinch
bun run build:binary dist/cinch-linux-arm64 bun-linux-arm64
```

The first argument is the file to write. The second is `bun-darwin-arm64`, `bun-linux-arm64` or `bun-linux-x64`, and without it the build is for the machine it runs on. Building for another platform downloads that platform's Bun runtime.

The build writes one file and publishes nothing.

The targeted `Standalone` workflow runs the binary acceptance tests on native Linux x64, Linux arm64 and macOS arm64 runners when core, build or toolchain inputs change. Each job uses the pinned Bun and engines, builds its host binary, and runs the existing no-Bun checks, fenced-code repair and embedded-rule proof. The fixtures give child commands a dedicated directory containing only the selected engines and Git, so a preinstalled Bun elsewhere on a runner cannot hide missing standalone support.

## Install a checked local artifact with mise

Build the executable for the consumer's platform, record its SHA-256 digest, and put the artifact at a fixed absolute path available to that consumer. The consumer needs mise and its selected engines on `PATH`. Its `mise.toml` pins the exact version, local file URL and expected digest.

```toml
[tools."http:cinch"]
version = "0.1.0-canary.1"
url = "file:///absolute/path/to/cinch"
bin = "cinch"
checksum = "sha256:REPLACE_WITH_THE_ARTIFACT_SHA256"
```

An approved release uses an immutable version that matches the artifact's `cinch --version`, with its own artifact URL and checksum. The example uses the version reported by a local build from the npm canary source.

mise reuses a tool already installed under the same backend and version, even if its configured URL or checksum changed. A release upgrade needs a new version identity together with the new artifact URL and checksum. For a local candidate rebuilt at the same version, use `mise install --force http:cinch` to make mise retrieve and verify the configured bytes again. Changing the version label alone still downloads the same file when its URL is fixed.

```sh
mise install --force http:cinch
mise exec -- cinch --version
mise exec -- cinch init
mise exec -- cinch init --yes
mise exec -- cinch check --strict --json
```

Review the config through the repository's normal mise trust process before installation. Commit the exact artifact location and expected checksum with the policy change. A `file://` URL depends on that absolute path existing on each consumer host. For a multi-platform repository, put the URL and checksum under `[tools."http:cinch".platforms]` with `macos-arm64`, `linux-x64`, and `linux-arm64` entries for the corresponding builds. An authenticated artifact download can populate those local paths after release approval. [mise HTTP backend](https://mise.jdx.dev/dev-tools/backends/http.html)

The native acceptance suite tests this route with isolated mise data, config, system config and cache folders. It rejects an incorrect digest before installation and on forced reinstall, checks the cached behavior of a same-version pin change, and verifies a new mise version identity rejects a wrong digest and selects the checked bytes after correction. It runs setup and a Markdown check through `mise exec` with Bun absent from `PATH`. The installed executable returns the same JSON and exit code as direct execution of the built artifact.

## What is inside

- The `cinch` command, with every verb.
- The presets, as text. A Cinch version is a preset version, so the binary writes the same `.outfitter/configs/presets/` files as the package of the same version.
- The rules Cinch ships, as text, for the same reason. The binary still needs `ast-grep` on `PATH` to run them.

The engines are not inside. A repository still pins and installs rumdl, Taplo and the rest itself, and `cinch doctor` still reports one that is missing.

`cinch --version` prints the version followed by `(binary)` when the binary is running, and the bare version from the package.

## What works with no Bun

Markdown and TOML work: the binary plans, checks, fixes and keeps the Markdown preset with only the engines on `PATH`. A test builds the binary, runs it with no Bun in reach, and compares its `check` output with the package's.

The Markdown preset formats JavaScript and TypeScript fenced blocks by calling `bun`. The binary has Bun's runtime inside it, so it stands in: it keeps a small `bun` command in the user's cache folder (`$XDG_CACHE_HOME/cinch/stand-in/`, or `~/.cache/cinch/stand-in/`) that starts the binary as Bun, and puts that folder last on the `PATH` the engines get. A `bun` the machine already has is found first. An empty, relative or checkout-local XDG cache falls back to the home cache. Cinch checks the helper directory against the outermost enclosing checkout, resolving aliases before writing, and uses it only when it is outside the checkout. If it cannot create a helper and the engine needs Bun, the check reports the affected file as incomplete. A test formats `ts` and `js` blocks with no Bun in reach and compares the result with the package's.

The lint, format and TypeScript presets are TypeScript or build on packages from npm. The binary can write those files, but a repository with no Bun or Node has nothing to run them with. They are off unless the Cinch config asks for them.

## Measured

On Linux x64 with Bun 1.4.4, on 2026-11-20:

- Size: 109 MB. Almost all of it is the Bun runtime.
- Build: under a second for the host platform.
- Cold start: about 60 ms for `cinch --version`.

## Still open

- The first release needs an approved version, executable name, three platform artifacts and their digests, and a distribution location/authentication route. The local mise qualification supplies installation evidence. Hosted download and release publication remain to be qualified against the approved artifacts.
