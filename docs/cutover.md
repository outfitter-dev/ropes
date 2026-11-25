# Ropes cutover

Ropes uses the `rope` executable, `rope.toml`, and managed files under `.ropes/configs/`. The public implementation lives in `packages/core/`, and the config schema is `packages/core/schemas/rope.schema.json`. The broader Outfitter application owns its own CLI initialization and unscoped npm cutover.

## Ropes checks its own repository

This repository uses `rope.toml` and `.ropes/configs/` for its own checks. `bun run check` runs workflow validation, the public `rope check` command and the test suite. Lefthook runs `rope fix` before committing and uses the same full check before pushing.

To roll back the repository's setup cutover, revert its commit as a unit. The previous revision supplies both the earlier policy and matching tool references. Run the version associated with that revision when verifying a historical rollback.

## Command retirement

Use `rope` for `explain`, `check`, `fix`, `doctor`, `init`, `preset`, `rules`, and `schema`. The public CLI supports the documented flags, including `--at` for `explain` and `check`, `--strict`, and the preview and confirmation options for the actions that write. Preset operations take one preset name at a time. `rope init` uses the fix report shape and preserves existing tool files. `rope schema` lists the schemas for preset and rule reports. The repository builds the standalone executable with `bun run build:rope`.

## Legacy policy retirement

Following the [hard-cutover decision](https://linear.app/outfitter/issue/ROPE-109), Ropes accepts `rope.toml` and keeps generated files under `.ropes/configs/`. Repository operations stop with exit 2 when they encounter the retired standalone file, a retired shared table, or the retired managed directory. Use the [manual migration guide](config-migration.md) to move policy and review the generated setup.

## Current output and marker contracts

The naming cutover introduced shared output version 4. Current plans and results use version 6. Ropes-owned findings use the `ropes/` namespace. Current parsers reject earlier plan and result versions, while the offline repair reader preserves archived v2, v3, v4 and v5 observations with their original IDs. See [output contracts](output.md).

The Markdown fragment marker is `<!-- ropes-disable-next-line code-block-parse -->`. A retired `cinch-` marker produces migration guidance. See [the Markdown standard](markdown-standard.md).

## Historical cutover record · November 20, 2026

The following decisions and inventory describe the pilot before command, config, finding, marker, and source-layout retirement. They preserve the original paths and observations. Current behavior is described above and in the [manual migration guide](config-migration.md).

### Pilot config decisions

Matt approved these choices on November 20, 2026.

- New setup uses `rope.toml` and keeps its generated files and presets under `.ropes/configs/`.
- Read `cinch.toml`, `[cinch]` in `outfitter.toml`, and existing `.outfitter/configs/` paths through the pilot. Review retirement after that pilot.
- When multiple supported config sources would govern the same root, report the conflict before writing. Preserve the behavior of a single legacy config.
- Start with a read-only preview. Show the proposed policy, managed files, and root tool references. The source files stay available for any later conversion. A future apply path must define how to recover the old config and pointers from the pre-migration revision before removing anything.

### Observed source inventory

The [Cinch baseline](https://github.com/outfitter-dev/ropes/tree/64d311fd54a5dde1448047073abfca3a425ea057) has one private package at `packages/cinch`, historically named `@outfitter/cinch@0.0.0`. The repo is its own first consumer.

| Surface | Observed references | Owner and action |
| --- | --- | --- |
| Package and local commands | `packages/cinch/package.json`, root `package.json`, and `bun.lock` | Ropes. ROPE-78 proves the private `@ropes/core` and `@ropes/cli` packages and keeps the existing `cinch` repo gate. ROPE-26 checks the matched local tarballs. |
| Hooks and CI | `lefthook.yml` uses `bun run cinch fix {staged_files}` and `bun run check`. `.github/workflows/ci.yml` installs the lockfile, runs the gate, and smokes `bun run cinch --version`. | Ropes. Preserve the gate through the packaging and migration proofs. Coordinate any command switch with the route that exercises the new configuration. |
| Discovery and authoring | `packages/cinch/src/config/load.ts` reads `cinch.toml` or `[cinch]` in `outfitter.toml`. `commands/starter.ts` writes the initial config. `.taplo.toml` binds `cinch.toml` to `packages/cinch/schemas/cinch.schema.json`. | Ropes. ROPE-79 proves new and legacy policy equivalence, the conflict path, and a preview that leaves the checkout unchanged. |
| Managed files and root pointers | `.rumdl.toml`, `oxlint.config.ts`, `oxfmt.config.ts`, and `tsconfig.json` refer to `.outfitter/configs/`. The TypeScript config also includes the managed TypeScript preset directory. | Ropes. Show generated-file destinations and corresponding root reference changes in ROPE-79. |
| Engine pins | `mise.toml` and `mise.lock` pin Bun 1.4.4, rumdl 0.3.5, Taplo 0.10.0, and ast-grep 0.51.3. The workspace lockfile pins the package tools. | Ropes. Use the same engine versions for both sides of the preview. |
| Standalone binary | `packages/cinch/scripts/build-binary.ts` builds `cinch`. Its Bun stand-in uses the user's `cinch/stand-in` cache directory. | Ropes. Binary distribution remains in ROPE-47. |
| Names and rollout | README, AGENTS, `docs/rollout.md`, the Linear plan, and the decision register describe different points in the transition. | Ropes. ROPE-82 updates repository ownership. ROPE-83 updates planning references and uses the repository split to hand off Outfitter work. Treat the rollout document's trial counts as historical. |

### Consumer inventory and repository links

On November 20, 2026, a tracked-file search across the 17 mounted Outfitter sibling checkouts found no active Cinch or Ropes package caller outside Ropes. A hosted GitHub code search for `@outfitter/cinch`, `@ropes/core`, `@ropes/cli`, `cinch check`, `cinch fix`, and `cinch.toml` found no indexed consumer outside Ropes. Record a consumer's exact pin and owner when it appears. The searches do not cover private local scripts, unindexed branches, global installs, or registry consumers.

| Reference | Owner and action |
| --- | --- |
| Ropes repository and history | Use [outfitter-dev/ropes](https://github.com/outfitter-dev/ropes) for the Ropes and Cinch code, commits, and PR links. ROPE-83 owns the Ropes planning corrections. |
| Camp checkout catalog | [Camp PR #10](https://github.com/outfitter-dev/camp/pull/10) registered `ropes` and `outfitter` separately. The `outfitter` links in Camp's catalog, project index, and tests refer to the application intentionally. |
| Legacy framework | Agents' `plugins/outfitter/README.md` still uses the old slug for the plugin marketplace, issues, and Stack docs. Skillset's draft `docs/adrs/drafts/20260710-catalog-owned-marketplace-refresh-pull-requests.md` uses it in historical marketplace examples. The respective owners should check each destination against [outfitter-dev/outfitter-legacy](https://github.com/outfitter-dev/outfitter-legacy) before updating it. If there is no active owner, record the reference and handoff in ROPE-83. |
| Outfitter application | Use [outfitter-dev/outfitter](https://github.com/outfitter-dev/outfitter) for the application. Ropes owns the private packed consumer proof in ROPE-20. The application owner handles production integration. |
| Forge pilot | ROPE-19 names Forge as a planned consumer. Once the exact prerelease is approved and available, coordinate the pin and nonblocking baseline with the Forge owner. |
