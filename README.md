# Outfitter

The Outfitter CLI and the quality tool it is built around.

| Name | Package | Executables | What it is |
| --- | --- | --- | --- |
| Fit | `outfitter` | `outfitter`, `fit` | The whole CLI. Starts with quality and leaves room for more. |
| Cinch | `@outfitter/cinch` | `cinch` | The slim quality CLI, usable on its own with `bunx`. |

`outfitter` depends on an exact Cinch version and hoists its verbs, so `cinch check`, `outfitter check` and `fit check` are the same command.

## Status

Scaffold. `cinch --version` and `cinch --help` work. `explain`, `check` and `fix` are registered and exit 2 until they are built. The `outfitter` package does not exist yet. Nothing is published.

## What Cinch does

Given a path, Cinch resolves one plan: which policy applies, where each value came from, and which tools will run. Three verbs read that same plan.

| Command | What it will do |
| --- | --- |
| `cinch explain <path>` | Show the plan without running anything |
| `cinch check [path...]` | Run the plan read-only and report findings |
| `cinch fix [path...]` | Apply what the plan allows. `--dry-run` previews without touching the checkout |

Every command takes `--json`. Exit codes are 0 for clean, 1 when findings remain, and 2 when the run is incomplete or unusable. A check that could not run never counts as a pass.

The first profile is Markdown.

## The JSON shapes are unstable

The plan, result and finding that `--json` prints are provisional. They carry `schemaVersion: 0` and will change without notice until they are ratified. `parsePlan` and `parseResult` reject a document whose schema version they do not know, and a consumer should do the same. Golden examples live in `packages/cinch/tests/fixtures/`.

## Configuration is a pilot

Cinch reads the `[cinch]` table in `outfitter.toml`, or a standalone `cinch.toml`. It looks in the directory it was run from and then in each parent up to the top of the checkout, and the nearest one found sets the root. A linked Git worktree or a jj workspace is its own checkout. Having both is an error, because one repository gets one source. With neither, the defaults apply. The file must state `pilot = 0`, and a missing or unknown marker stops the run. The format is unstable and will change without notice.

```toml
pilot = 0
include = ["**/*.md"]
exclude = ["vendor/**"]

[markdown]
enabled = true

[[overrides]]
paths = ["docs/legacy/**"]
[overrides.markdown]
enabled = false
```

Overrides apply in file order. When more than one matches a path, the later one wins for each setting it states, and the plan names the override each value came from. A path that `exclude` matches, or that `include` does not, stays in the plan marked as skipped, with the setting that decided it.

This repository's own `cinch.toml` is the first user of the format.

## Layout

```text
packages/cinch/src/
  contracts/   Plan, result and finding schemas and parsers. No I/O.
  config/      Pilot config loader.
  policy/      The resolver. Pure: config and selection in, plan out.
  adapters/    One folder per engine, plus the registry that lists them.
  runner/      Runs a plan through adapters. Knows only the adapter interface.
  commands/    explain, check and fix as functions that take and return data.
  cli.ts       The only file that parses arguments or prints.
```

A test enforces which layer may import from which. That keeps engines swappable and leaves the command layer free to change later.

## Develop

```bash
./scripts/bootstrap.sh
bun run check
bun run cinch --help
```

Tool versions are pinned in `mise.toml`, and [docs/tool-versions.md](docs/tool-versions.md) says how to change one. See AGENTS.md for the working rules.
