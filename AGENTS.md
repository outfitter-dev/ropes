# Ropes

This repository owns the Ropes quality engine and CLI, including contracts, policy, runner, adapters, shared presets, rules, schemas, standalone build, tests, and quality setup.

- `@ropes/core` is the unpublished package under `packages/core/`. It exposes typed quality operations and versioned contract parsers. This directory also owns the setup implementation.
- `@ropes/cli` is the unpublished package under `packages/cli/`, with the `rope` executable. Its first slice exposes `explain`, `check`, and `fix` through public core imports. Use `bun run rope` from this checkout.
- The separate [`outfitter` application](https://github.com/outfitter-dev/outfitter) will consume the public core API. Application initialization, cross-tool configuration migration, and the unscoped `outfitter` npm cutover belong to that repository. New consumer examples use the `outfitter` executable.

The previous framework lives in [`outfitter-legacy`](https://github.com/outfitter-dev/outfitter-legacy).

Read README.md, the [design tenets](docs/tenets.md), the [product direction](https://linear.app/outfitter/document/ropes-product-direction-cli-design-and-repository-architecture-def8de43517b), the [execution plan](https://linear.app/outfitter/document/ropes-execution-plan-cutover-pilot-and-rollout-37f1f91fa166), and the [specification and decision register](https://linear.app/outfitter/document/fit-product-specification-and-decision-register-232485133059) before implementing. The tenets guide long-term design. The specification governs existing Cinch behavior until the cutover is accepted. Keep implementation and technical documentation aligned with both. When work challenges either, record the decision in the governing document and explain it in the pull request. Work is tracked on the Linear `ROPE` team in Cinch Build and Cinch Rule Enforcement.

## Rules that come from the specification

- One plan, four verbs. `explain`, `check`, `fix` and `doctor` all read the plan the resolver produced. Nothing runs that `explain` would not have shown.
- Each verb writes its own files and no others. `explain` and `check` write nothing. `fix` writes the repository's own files. `doctor --fix` writes the Cinch setup: the presets and generated configs Cinch keeps under `.outfitter/configs/`, and the one edit Cinch may make to a config a person wrote, the missing `extends` line. `init` and `preset` write through the same steps as `doctor --fix`. `init` alone may also carry an older tool's settings into such a config, because it is the takeover. `preset adopt` and `preset eject` move one tool's settings between its root config and its table in the Cinch config, and write those two files and the generated config only when `--yes` is given. `rules adopt` names rule packs in the Cinch config, and writes that one file only when `--yes` is given. These limits are about the repository. The standalone binary also keeps a stand-in `bun` in the user's cache folder, under any verb, and never in the repository; `docs/binary.md` describes it.
- The resolver in `policy/` is pure. It reads no files, spawns nothing, and gives the same plan for the same input.
- Engines sit behind the `Adapter` interface. The runner knows only that interface and never branches on an adapter's id. Adding an engine is one new folder under `adapters/` and one line in `adapters/registry.ts`.
- Argument parsing and printing belong to the CLI entry points. Core operations take typed requests and return data. `rope` and external consumers use the public `@ropes/core` exports; keep their quality logic in core. A future command-layer change must preserve the resolver and runner boundaries.
- A required step that could not run is incomplete, never passed. Exit codes are 0 for a completed run without blocking findings, 1 for blocking findings, and 2 for an incomplete or unusable run. Advisory findings remain visible, and incomplete wins.
- The plan, result and config shapes are provisional. An unknown schema or config version is an error, never a silent default.

`packages/core/tests/boundaries.test.ts` enforces the import rules above. If it fails, fix the import. Do not loosen the test to make room for it.

## How to work here

Use Bun and strict TypeScript: no `any`, no `as` casts, parse external input at the boundary. Add an abstraction only when a second caller exists. Keep files small: under 200 lines is healthy, and a file past 250 gets split along a seam it already has. Tests are offline and credential-free by default. A test that needs a real engine skips with a visible reason when the engine is absent, and CI runs it against the pinned version.

Run `./scripts/bootstrap.sh` in a fresh checkout, then `bun run check`. Do not hard-wrap Markdown prose. Work on a branch named for its Linear issue and keep the pull request in draft until CI passes. Use Conventional Commits.

Stacks and worktrees go through [Climb](https://github.com/outfitter-dev/climb). `climb.yaml` points its checks phase at `bun run check`, so `climb commit` runs the same gate as CI.

Package publication, repository visibility, and access changes need explicit authorization. The Ropes prerelease gate is [ROPE-18](https://linear.app/outfitter/issue/ROPE-18). The separate Outfitter repository owns the unscoped npm cutover.
