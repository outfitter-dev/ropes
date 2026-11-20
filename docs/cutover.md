# Cinch to Ropes cutover

This inventory covers the Ropes quality tool and its known callers. The separate Outfitter application owns application initialization, cross-tool migration, and the unscoped `outfitter` npm cutover. See [ROPE-77](https://linear.app/outfitter/issue/ROPE-77) for the decision and [ROPE-79](https://linear.app/outfitter/issue/ROPE-79) for the preview.

## Config decisions

Matt approved these choices on November 20, 2026.

- New setup uses `rope.toml` and keeps its generated files and presets under `.ropes/configs/`.
- Read `cinch.toml`, `[cinch]` in `outfitter.toml`, and existing `.outfitter/configs/` paths through the pilot. Review retirement after that pilot.
- When multiple supported config sources would govern the same root, report the conflict before writing. Preserve the behavior of a single legacy config.
- Start with a read-only preview. Show the proposed policy, managed files, and root tool references. The source files stay available for any later conversion. A future apply path must define how to recover the old config and pointers from the pre-migration revision before removing anything.

## Ropes references

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

## Consumers and repository links

On November 20, 2026, a tracked-file search across the 17 mounted Outfitter sibling checkouts found no active Cinch or Ropes package caller outside Ropes. A hosted GitHub code search for `@outfitter/cinch`, `@ropes/core`, `@ropes/cli`, `cinch check`, `cinch fix`, and `cinch.toml` found no indexed consumer outside Ropes. Record a consumer's exact pin and owner when it appears. The searches do not cover private local scripts, unindexed branches, global installs, or registry consumers.

| Reference | Owner and action |
| --- | --- |
| Ropes repository and history | Use [outfitter-dev/ropes](https://github.com/outfitter-dev/ropes) for the Ropes and Cinch code, commits, and PR links. ROPE-83 owns the Ropes planning corrections. |
| Camp checkout catalog | [Camp PR #10](https://github.com/outfitter-dev/camp/pull/10) registered `ropes` and `outfitter` separately. The `outfitter` links in Camp's catalog, project index, and tests refer to the application intentionally. |
| Legacy framework | Agents' `plugins/outfitter/README.md` still uses the old slug for the plugin marketplace, issues, and Stack docs. Skillset's draft `docs/adrs/drafts/20260710-catalog-owned-marketplace-refresh-pull-requests.md` uses it in historical marketplace examples. The respective owners should check each destination against [outfitter-dev/outfitter-legacy](https://github.com/outfitter-dev/outfitter-legacy) before updating it. If there is no active owner, record the reference and handoff in ROPE-83. |
| Outfitter application | Use [outfitter-dev/outfitter](https://github.com/outfitter-dev/outfitter) for the application. Ropes owns the private packed consumer proof in ROPE-20. The application owner handles production integration. |
| Forge pilot | ROPE-19 names Forge as a planned consumer. Once the exact prerelease is approved and available, coordinate the pin and nonblocking baseline with the Forge owner. |
