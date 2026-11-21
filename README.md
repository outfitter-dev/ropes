# Ropes

Ropes owns repository quality checks, policy, tool configuration, and shared presets. Its `rope` command and public core API run the same resolved plan.

The broader [`outfitter` CLI](https://github.com/outfitter-dev/outfitter) lives in a separate repository and will consume Ropes through that API. Application initialization, cross-tool configuration migration, and the unscoped `outfitter` npm cutover belong there. The previous framework lives in [`outfitter-legacy`](https://github.com/outfitter-dev/outfitter-legacy).

## Status

The unpublished `@ropes/core` package holds the existing Cinch implementation under `packages/cinch/`. `@ropes/cli` supplies `rope explain`, `rope check`, and `rope fix`, including `fix --dry-run`. The Markdown fixture verifies matching plans, versioned results, and exits through Cinch, core, and `rope`.

An installed `rope` delegates to the checkout's explicitly pinned `@ropes/cli` dependency. `rope --version` reports the selected version and entry path. See [repository-pinned invocation](docs/launcher.md) for installation selection and failure handling.

`rope explain` and `rope check` can compare an immutable cleanup candidate with its parent under an approved migration policy. See [staged cleanup](docs/cleanup.md) for the supported rule, scope and Git inputs.

Cinch remains the repository's setup and development entry point. Its `init`, `doctor`, `preset`, `rules`, and `schema` commands are available through `bun run cinch`. Ropes reads `rope.toml` and keeps its managed files under `.ropes/configs/`. During the pilot it also reads legacy `cinch.toml` or `[cinch]` in `outfitter.toml`, with managed files under `.outfitter/configs/`. The [cutover inventory](docs/cutover.md) records the compatibility choices.

Capture two resolved rule policies with `rope policy snapshot` and compare them with `rope policy compare`. See [policy previews](docs/policy-preview.md).

## Current Cinch commands

Given a path, Cinch resolves one plan: which policy applies, where each value came from, and which tools will run. Four verbs read that same plan, and each may write only its own files.

| Command | What it will do |
| --- | --- |
| `cinch explain [path...]` | Show the plan without running anything |
| `cinch check [path...]` | Run the plan read-only and report findings |
| `cinch fix [path...]` | Fix the repository's own files. `--dry-run` previews without touching the checkout. It never writes a file Cinch keeps, and it stops when the setup needs repair. See [docs/fix.md](docs/fix.md) |
| `cinch doctor` | Check the Cinch setup: the files Cinch keeps, and the pinned tools. `--fix` repairs it, and `--fix --dry-run` previews that. See [docs/doctor.md](docs/doctor.md) |
| `cinch init` | First-time setup. Set up the config and presets a repository needs. It only shows the change. `--yes` writes it. See [docs/presets.md](docs/presets.md) |
| `cinch preset` | List the shared configs Cinch keeps in the repository and whether each is current. `preset add <name>` and `preset update [name]` write them. `preset adopt <name>` and `preset eject <name>` move a tool's settings between its own config and the Cinch config |
| `cinch rules` | List the rule packs Cinch ships and how each stands in the repository: on, off, not relevant, not adopted, or waiting for rules to be switched on. `rules adopt [pack]` names the packs that apply in the Cinch config so they run. It only shows the change. `--yes` writes it |
| `cinch schema [command]` | Print the JSON Schema of a command's `--json` output, to write a jq filter against. `cinch schema config` prints the schema of the config file |

Every command prints plain text that can be piped, or one JSON document with `--json`. [Output](docs/output.md) has the contract and jq examples. Exit codes are 0 for clean, 1 when findings remain, and 2 when the run is incomplete or unusable. A check that could not run never counts as a pass.

| Verb | What it may write |
| --- | --- |
| `explain`, `check`, `doctor` | Nothing |
| `fix` | The repository's own files: what the plan's engines fix |
| `doctor --fix` | The presets and generated configs Cinch keeps under `.outfitter/configs/`, a root config Cinch creates when there is none, and the `extends` line in one a person wrote |
| `preset adopt`, `preset eject` | With `--yes`, a tool's settings, moved between its root config and its table in the Cinch config, and the generated config rewritten to match |
| `rules adopt` | With `--yes`, the Cinch config, with the rule packs named under `[rules] packs` |

`init` and `preset add` or `update` write the same files as `doctor --fix`, through the same steps. Only `init` also carries an older tool's settings over. [Outcomes and exit codes](docs/exit-codes.md) has the full contract, and [Selecting files](docs/selection.md) says which files a command looks at. Markdown is held to [the Markdown standard](docs/markdown-standard.md), which also formats fenced TypeScript and JavaScript. A TypeScript repository can ask for the shared lint, formatter and compiler presets, and have Cinch run the linter, the type check and the formatter: see [the TypeScript standard](docs/typescript-standard.md).

The first profile is Markdown. TOML is the second: every TOML file must parse, and one with a schema must fit it. Formatting TOML stays with the formatter.

## The JSON shapes are unstable

The plan, result and finding that `--json` prints are provisional. They carry `schemaVersion: 3` and will change without notice until they are ratified. `parsePlan` and `parseResult` reject a document whose schema version they do not know, and a consumer should do the same. Golden examples live in `packages/cinch/tests/fixtures/`.

## Configuration is a pilot

Use [the Ropes migration preview](docs/config-migration.md) to see the proposed `rope.toml` and managed paths for an existing Cinch configuration.

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

# Facts several tools must agree on. Cinch writes `.editorconfig` from them.
[editor]
indent_style = "space"
indent_size = 2

[[overrides]]
paths = ["docs/legacy/**"]
[overrides.markdown]
enabled = false
```

Overrides apply in file order. When more than one matches a path, the later one wins for each setting it states, and the plan names the override each value came from. A path that `exclude` matches, or that `include` does not, stays in the plan marked as skipped, with the setting that decided it.

A table under `tools` is copied into the config Cinch generates for that tool, at `.outfitter/configs/<tool>.<ext>`. That file extends the preset Cinch ships, and the tool's root config extends that file, so a rule is stated once, in the Cinch config, and plain `rumdl` or an editor sees it too. `cinch doctor --fix` rewrites the generated file after the table changes. [The Markdown standard](docs/markdown-standard.md) has the details. Markdown is the first tool with a table.

The `[editor]` table holds the facts editors and formatters share: indent, line endings, charset, line width. Cinch writes the whole root `.editorconfig` from it, and never overwrites one a person wrote. See [editor settings](docs/editor-settings.md). A tool's own config that states one of these facts differently is a finding: see [shared facts](docs/shared-facts.md).

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
  index.ts     Public @ropes/core operations and versioned contract parsers.
  cli.ts       Existing cinch argument handling and output.
packages/cli/src/
  cli.ts       rope argument handling, rendering and exit mapping.
```

The `@ropes/core` package exports typed `explain`, `check`, and `fix` operations. Its `@ropes/core/render` entry point exposes renderers for callers that need command output. `rope` imports those public entry points, and core has no dependency on the CLI. Boundary tests enforce the layer imports and package direction. [docs/adapters.md](docs/adapters.md) explains how to add an engine.

## Develop

```bash
./scripts/bootstrap.sh
bun run check
bun run rope --help
bun run cinch --help
```

`bun run check` is `cinch check` on this repository, then the tests. `cinch check` reads the root `cinch.toml` and runs the linters, the type check and the formatter, so there is no separate lint, format or type check script. `bun run fix` is `cinch fix`. `cinch check` needs the pinned rumdl and Taplo on `PATH`. With mise activated in your shell it is. Otherwise run `mise exec -- bun run check`. Without them the step is incomplete and the check fails, which is the point: a check that could not run is not a pass.

The pre-commit hook runs `cinch fix` on the files you staged. It stages what it fixed and stops the commit when a finding is left, a type error included, or an engine could not run. It also stops, without fixing anything, when the Cinch setup needs repair, and says to run `cinch doctor --fix`. It works on the file in your working tree, so a partly staged file is staged whole.

[Rolling Cinch out](docs/rollout.md) lists the other Outfitter repositories and what each needs first.

Tool versions are pinned in `mise.toml`, and [docs/tool-versions.md](docs/tool-versions.md) says how to change one. See AGENTS.md for the working rules.
