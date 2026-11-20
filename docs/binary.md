# The standalone binary

Cinch is a Bun program. A repository with no Bun, such as a Python one, can still run it from one executable that has Bun's runtime inside it.

This page covers building that executable. Nothing is released yet, so there is no install step to follow.

## Build it

```sh
bun run build:binary dist/cinch
bun run build:binary dist/cinch-linux-arm64 bun-linux-arm64
```

The first argument is the file to write. The second is `bun-darwin-arm64`, `bun-linux-arm64` or `bun-linux-x64`, and without it the build is for the machine it runs on. Building for another platform downloads that platform's Bun runtime.

The build writes one file and publishes nothing.

## What is inside

- The `cinch` command, with every verb.
- The presets, as text. A Cinch version is a preset version, so the binary writes the same `.outfitter/configs/presets/` files as the package of the same version.
- The rules Cinch ships, as text, for the same reason. The binary still needs `ast-grep` on `PATH` to run them.

The engines are not inside. A repository still pins and installs rumdl, Taplo and the rest itself, and `cinch doctor` still reports one that is missing.

`cinch --version` prints the version followed by `(binary)` when the binary is running, and the bare version from the package.

## What works with no Bun

Markdown and TOML work: the binary plans, checks, fixes and keeps the Markdown preset with only the engines on `PATH`. A test builds the binary, runs it with no Bun in reach, and compares its `check` output with the package's.

One part of Markdown does not work yet. The Markdown preset formats JavaScript and TypeScript fenced blocks by calling `bun`, and the binary does not put one on `PATH`. A file with such a block is reported as incomplete, never as passing. The binary can stand in for `bun` when it is started with `BUN_BE_BUN=1`, which is the planned fix.

The lint, format and TypeScript presets are TypeScript or build on packages from npm. The binary can write those files, but a repository with no Bun or Node has nothing to run them with. They are off unless the Cinch config asks for them.

## Measured

On Linux x64 with Bun 1.4.4, on 2026-11-20:

- Size: 109 MB. Almost all of it is the Bun runtime.
- Build: under a second for the host platform.
- Cold start: about 60 ms for `cinch --version`.

## Still open

- JavaScript and TypeScript fenced blocks in Markdown, as above.
- How a release is cut and how a repository installs and pins the binary. mise is where tool versions live, so a release asset mise can install is the first choice.
- Builds for macOS arm64 and Linux arm64 in CI.
