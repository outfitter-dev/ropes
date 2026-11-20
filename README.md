# Outfitter

The Outfitter CLI and the quality tool it is built around.

| Name | Package | Executables | What it is |
| --- | --- | --- | --- |
| Fit | `outfitter` | `outfitter`, `fit` | The whole CLI. Starts with quality and leaves room for more. |
| Cinch | `@outfitter/cinch` | `cinch` | The slim quality CLI, usable on its own with `bunx`. |

`outfitter` depends on an exact Cinch version and hoists its verbs, so `cinch check`, `outfitter check` and `fit check` are the same command.

## Status

Early. `cinch explain`, `cinch check` and `cinch fix` work on Markdown, `cinch check` also lints TOML, `cinch init` and `cinch preset` set a repository up, and `cinch doctor` keeps that setup right. The `outfitter` package does not exist yet. Nothing is published.

## What Cinch does

Given a path, Cinch resolves one plan: which policy applies, where each value came from, and which tools will run. Four verbs read that same plan, and each may write only its own files.

| Command | What it will do |
| --- | --- |
| `cinch explain [path...]` | Show the plan without running anything |
| `cinch check [path...]` | Run the plan read-only and report findings |
| `cinch fix [path...]` | Fix the repository's own files. `--dry-run` previews without touching the checkout. It never writes a file Cinch keeps, and it stops when the setup needs repair. See [docs/fix.md](docs/fix.md) |
| `cinch doctor` | Check the Cinch setup: the files Cinch keeps, and the pinned tools. `--fix` repairs it, and `--fix --dry-run` previews that. See [docs/doctor.md](docs/doctor.md) |
| `cinch init` | First-time setup. Set up the config and presets a repository needs. It only shows the change. `--yes` writes it. See [docs/presets.md](docs/presets.md) |
| `cinch preset` | List the shared configs Cinch keeps in the repository and whether each is current. `preset add <name>` and `preset update [name]` write them |
| `cinch schema [command]` | Print the JSON Schema of a command's `--json` output, to write a jq filter against. `cinch schema config` prints the schema of the config file |

Every command prints plain text that can be piped, or one JSON document with `--json`. [Output](docs/output.md) has the contract and jq examples. Exit codes are 0 for clean, 1 when findings remain, and 2 when the run is incomplete or unusable. A check that could not run never counts as a pass.

| Verb | What it may write |
| --- | --- |
| `explain`, `check`, `doctor` | Nothing |
| `fix` | The repository's own files: what the plan's engines fix |
| `doctor --fix` | The presets and generated configs Cinch keeps under `.outfitter/configs/`, a root config Cinch creates when there is none, and the `extends` line in one a person wrote |

`init` and `preset add` or `update` write the same files as `doctor --fix`, through the same steps. Only `init` also carries an older tool's settings over. [Outcomes and exit codes](docs/exit-codes.md) has the full contract, and [Selecting files](docs/selection.md) says which files a command looks at. Markdown is held to [the Markdown standard](docs/markdown-standard.md), which also formats fenced TypeScript and JavaScript.

The first profile is Markdown. TOML is the second: every TOML file must parse, and one with a schema must fit it. Formatting TOML stays with the formatter.

## The JSON shapes are unstable

The plan, result and finding that `--json` prints are provisional. They carry `schemaVersion: 1` and will change without notice until they are ratified. `parsePlan` and `parseResult` reject a document whose schema version they do not know, and a consumer should do the same. Golden examples live in `packages/cinch/tests/fixtures/`.

## Configuration is a pilot

Cinch reads the `[cinch]` table in `outfitter.toml`, or a standalone `cinch.toml`. It looks in the directory it was run from and then in each parent up to the top of the checkout, and the nearest one found sets the root. A linked Git worktree or a jj workspace is its own checkout. Having both is an error, because one repository gets one source. With neither, the defaults apply. The file must state `pilot = 0`, and a missing or unknown marker stops the run. The format is unstable and will change without notice.

```toml
pilot = 0
include = ["**/*.md", "**/*.toml"]
exclude = ["vendor/**"]

[markdown]
enabled = true
# Keep the shared Markdown standard in the repository. On unless set to false.
preset = true

[toml]
enabled = true

# One table for each tool, in the tool's own settings.
[tools.rumdl.MD007]
indent = 4

[[overrides]]
paths = ["docs/legacy/**"]
[overrides.markdown]
enabled = false
```

Overrides apply in file order. When more than one matches a path, the later one wins for each setting it states, and the plan names the override each value came from. A path that `exclude` matches, or that `include` does not, stays in the plan marked as skipped, with the setting that decided it.

A table under `tools` is copied into the config Cinch generates for that tool, at `.outfitter/configs/<tool>.<ext>`. That file extends the preset Cinch ships, and the tool's root config extends that file, so a rule is stated once, in the Cinch config, and plain `rumdl` or an editor sees it too. `cinch doctor --fix` rewrites the generated file after the table changes. [The Markdown standard](docs/markdown-standard.md) has the details. Markdown is the first tool with a table.

This repository's own `cinch.toml` is the first user of the format.

## Layout

```text
packages/cinch/src/
  contracts/   Plan, result and finding schemas and parsers. No I/O.
  config/      Pilot config loader.
  policy/      The resolver. Pure: config and selection in, plan out.
  adapters/    One folder per engine, plus the registry that lists them.
  runner/      Runs a plan through adapters. Knows only the adapter interface.
  render/      Turns a result into text or JSON. Pure, and takes only a result.
  commands/    explain, check and fix as functions that take and return data.
  cli.ts       The only file that parses arguments or prints.
```

A test enforces which layer may import from which. That keeps engines swappable and leaves the command layer free to change later. [docs/adapters.md](docs/adapters.md) explains how to add an engine.

## Develop

```bash
./scripts/bootstrap.sh
bun run check
bun run cinch --help
```

`bun run check` ends with `cinch check` on this repository, reading the root `cinch.toml`. That step needs the pinned rumdl and Taplo on `PATH`. With mise activated in your shell it is. Otherwise run `mise exec -- bun run check`. Without them the step is incomplete and the check fails, which is the point: a check that could not run is not a pass.

The pre-commit hook runs `cinch fix` on the Markdown you staged, after the formatter. It stages what it fixed and stops the commit when a finding is left or the engine could not run. It also stops, without fixing anything, when the Cinch setup needs repair, and says to run `cinch doctor --fix`. It works on the file in your working tree, so a partly staged Markdown file is staged whole.

[Rolling Cinch out](docs/rollout.md) lists the other Outfitter repositories and what each needs first.

Tool versions are pinned in `mise.toml`, and [docs/tool-versions.md](docs/tool-versions.md) says how to change one. See AGENTS.md for the working rules.
