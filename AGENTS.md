# Outfitter

This repository holds two things that ship separately:

- **Fit** is the `outfitter` package, with the `outfitter` and `fit` executables. It is the whole Outfitter CLI. It starts with quality and leaves room for more.
- **Cinch** is the `@outfitter/cinch` package, with the `cinch` executable. It is the slim quality CLI. `outfitter` depends on an exact Cinch version and hoists its verbs, so `cinch check`, `outfitter check` and `fit check` are the same command.

The old framework that used to live under this repository name is now `outfitter-dev/outfitter-legacy`. Nothing here depends on it.

Read README.md and the [specification and decision register](https://linear.app/outfitter/document/fit-product-specification-and-decision-register-232485133059) before implementing. The specification governs behaviour. When the work shows it is wrong, update it and say so in the pull request instead of quietly diverging. Work is tracked in the Cinch Build project on the Linear `FIT` team.

## Rules that come from the specification

- One plan, four verbs. `explain`, `check`, `fix` and `doctor` all read the plan the resolver produced. Nothing runs that `explain` would not have shown.
- Each verb writes its own files and no others. `explain` and `check` write nothing. `fix` writes the repository's own files. `doctor --fix` writes the Cinch setup: the presets and generated configs Cinch keeps under `.outfitter/configs/`, and the one edit Cinch may make to a config a person wrote, the missing `extends` line. `init` and `preset` write through the same steps as `doctor --fix`. `init` alone may also carry an older tool's settings into such a config, because it is the takeover. `preset absorb` and `preset eject` move one tool's settings between its root config and its table in the Cinch config, and write those two files and the generated config only when `--yes` is given.
- The resolver in `policy/` is pure. It reads no files, spawns nothing, and gives the same plan for the same input.
- Engines sit behind the `Adapter` interface. The runner knows only that interface and never branches on an adapter's id. Adding an engine is one new folder under `adapters/` and one line in `adapters/registry.ts`.
- `cli.ts` is the only file that parses arguments or prints. Commands take a typed request and return data, so `outfitter` can call them directly, and so the command layer can be replaced later (a move to Trails is possible) without touching the rest.
- A step that could not run is incomplete, never passed. Exit codes are 0 clean, 1 findings remain, 2 incomplete or unusable, and incomplete wins.
- The plan, result and config shapes are provisional. An unknown schema or config version is an error, never a silent default.

`packages/cinch/tests/boundaries.test.ts` enforces the import rules above. If it fails, fix the import. Do not loosen the test to make room for it.

## How to work here

Use Bun and strict TypeScript: no `any`, no `as` casts, parse external input at the boundary. Add an abstraction only when a second caller exists. Keep files small: under 200 lines is healthy, and a file past 250 gets split along a seam it already has. Tests are offline and credential-free by default. A test that needs a real engine skips with a visible reason when the engine is absent, and CI runs it against the pinned version.

Run `./scripts/bootstrap.sh` in a fresh checkout, then `bun run check`. Do not hard-wrap Markdown prose. Work on a branch named for its Linear issue and keep the pull request in draft until CI passes. Use Conventional Commits.

Stacks and worktrees go through [Climb](https://github.com/outfitter-dev/climb). `climb.yaml` points its checks phase at `bun run check`, so `climb commit` runs the same gate as CI.

Do not publish a package, make the repository public, or change repository access as an incidental change. The npm name `outfitter` is still held by the legacy CLI; do not publish over it.
