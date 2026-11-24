# Ropes

Ropes owns repository quality checks, policy, tool configuration, and shared presets. Its `rope` command and public core API run the same resolved plan.

The broader [`outfitter` CLI](https://github.com/outfitter-dev/outfitter) lives in a separate repository and will consume Ropes through that API. Application initialization, cross-tool configuration migration, and the unscoped `outfitter` npm cutover belong there. The previous framework lives in [`outfitter-legacy`](https://github.com/outfitter-dev/outfitter-legacy).

## Status

The `@ropes/core` package owns quality operations and setup under `packages/core/`. `@ropes/cli` supplies `rope init`, `rope explain`, `rope check`, `rope fix`, and `rope doctor` for setup inspection and repair. `fix --dry-run` previews content repairs. The Markdown fixture verifies matching plans, versioned results, and exits through the public core API and `rope`.

## Quickstart

Start in a Git checkout with an initial commit, or a Git-colocated jj workspace. Install Bun 1.4.4 or newer and the external engines your policy uses. Markdown checks require rumdl. For npm, replace `VERSION` with the exact Ropes version you intend to adopt and commit its dependency pin and lockfile.

```bash
bun add --dev --exact @ropes/cli@VERSION
git add package.json bun.lock
git commit -m "chore: pin Ropes"
./node_modules/.bin/rope init
./node_modules/.bin/rope init --yes
./node_modules/.bin/rope check README.md
```

`init` previews `rope.toml` and its managed setup. `init --yes` applies the preview. When the setup needs repair, run `rope doctor --fix --dry-run` to preview the changes and `rope doctor --fix` to apply them. For a repository with retired policy files, follow the [manual migration guide](docs/config-migration.md).

The npm-installed `rope` launcher delegates to the checkout's explicitly pinned `@ropes/cli` dependency, and `rope --version` reports the selected version and entry path. The standalone executable runs its embedded version, pinned through mise, and reports `rope <version> (binary)`. See [installation selection](docs/launcher.md) for both routes and their failure handling.

`rope explain` and `rope check` can compare an immutable cleanup candidate with its parent under an approved migration policy. See [staged cleanup](docs/cleanup.md) for the supported rule, scope and Git inputs.

This repository checks and fixes itself through `rope`. Ropes reads `rope.toml` and keeps its managed files under `.ropes/configs/`. Legacy policy files stop repository checks with a message naming the replacement. The [cutover inventory](docs/cutover.md) records the compatibility choices.

`rope rules` lists the shipped packs and their state in this repository. Use `rope rules adopt [pack...]` to preview an adoption and add `--yes` to write it. The active policy file is the only file adoption changes.

Capture two resolved rule policies with `rope policy snapshot` and compare them with `rope policy compare`. See [policy previews](docs/policy-preview.md).

## Ropes commands

Given a path, Ropes resolves one plan: which policy applies, where each value came from, and which tools will run. Four verbs read that same plan, and each may write only its own files.

| Command | What it will do |
| --- | --- |
| `rope explain [path...]` | Show the plan without running anything |
| `rope check [path...]` | Run the plan read-only and report findings |
| `rope fix [path...]` | Fix the repository's own files. `--dry-run` previews without touching the checkout. It never writes a file Ropes manages, and it stops when the setup needs repair. See [docs/fix.md](docs/fix.md) |
| `rope doctor` | Check managed setup files and pinned tools. `--fix` repairs it, and `--fix --dry-run` previews that. See [docs/doctor.md](docs/doctor.md) |
| `rope init` | First-time setup. Set up the config and presets a repository needs. It only shows the change. `--yes` writes it. See [docs/presets.md](docs/presets.md) |
| `rope preset` | List the shared configs Ropes manages in the repository and whether each is current. `preset add <name>` and `preset update [name]` write them. `preset adopt <name>` and `preset eject <name>` move a tool's settings between its own config and the Ropes config |
| `rope rules` | List the rule packs Ropes ships and how each stands in the repository: on, off, not relevant, not adopted, or waiting for rules to be switched on. `rules adopt [pack]` names the packs that apply in the Ropes config so they run. It only shows the change. `--yes` writes it |
| `rope schema [command]` | Print the JSON Schema of a command's `--json` output, to write a jq filter against. `rope schema config` prints the schema of the config file |

Every command prints plain text that can be piped, or one JSON document with `--json`. [Output](docs/output.md) has the contract and jq examples. Exit codes are 0 for clean, 1 when findings remain, and 2 when the run is incomplete or unusable. A check that could not run never counts as a pass.

| Verb | What it may write |
| --- | --- |
| `explain`, `check`, `doctor` | Nothing |
| `fix` | The repository's own files: what the plan's engines fix |
| `doctor --fix` | The presets and generated configs Ropes keeps under `.ropes/configs/`, a root config Ropes creates when there is none, and the `extends` line in one a person wrote |
| `preset adopt`, `preset eject` | With `--yes`, a tool's settings, moved between its root config and its table in the Ropes config, and the generated config rewritten to match |
| `rules adopt` | With `--yes`, the Ropes config, with the rule packs named under `[rules] packs` |

`init` and `preset add` or `update` write the same files as `doctor --fix`, through the same steps. `init` can carry supported native tool settings into a new policy while preserving the authored tool files. Rule packs require explicit adoption. [Outcomes and exit codes](docs/exit-codes.md) has the full contract, and [Selecting files](docs/selection.md) says which files a command looks at. Markdown is held to [the Markdown standard](docs/markdown-standard.md), which also formats fenced TypeScript and JavaScript. A TypeScript repository can ask for the shared lint, formatter and compiler presets, and have Ropes run the linter, the type check and the formatter: see [the TypeScript standard](docs/typescript-standard.md).

The first profile is Markdown. TOML is the second: every TOML file must parse, and one with a schema must fit it. Formatting TOML stays with the formatter. On macOS, if native Taplo panics during system proxy discovery, Ropes retries with its pinned Taplo WebAssembly CLI and identifies the fallback in the report. The fallback needs evidence that it checked the selected file. Excluded files and checks it cannot complete still report as incomplete. Repositories still install their pinned native Taplo.

## The JSON shapes are unstable

The plan and result that `--json` prints are provisional and carry `schemaVersion: 4`. Findings are versioned by the containing result. These provisional shapes can change before ratification. `parsePlan` and `parseResult` reject a document whose schema version they do not know, and a consumer should do the same. Golden examples live in `packages/core/tests/fixtures/`.

## Configuration is a pilot

The `[install]` table can generate Bun's install config and report release-age drift in authored Renovate config. See [install policy](docs/install-policy.md).

Run `rope migrate` for manual guidance when converting retired Cinch policy and generated files. The [migration guide](docs/config-migration.md) covers the file changes, verification, and recovery.

Ropes reads `rope.toml`. It searches the current directory and its parents up to the checkout boundary, and the nearest policy sets the root. A linked Git worktree or jj workspace is its own checkout. With no policy, documented defaults apply. A policy file must state `pilot = 0`, and a missing or unknown marker stops the run. The format remains provisional. Retired `cinch.toml`, `[cinch]` tables, and `.outfitter/configs/` stop repository operations with exit 2 and manual migration guidance.

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

# Facts several tools must agree on. Ropes writes `.editorconfig` from them.
[editor]
indent_style = "space"
indent_size = 2

[[overrides]]
paths = ["docs/legacy/**"]
[overrides.markdown]
enabled = false
```

Overrides apply in file order. When more than one matches a path, the later one wins for each setting it states, and the plan names the override each value came from. A path that `exclude` matches, or that `include` does not, stays in the plan marked as skipped, with the setting that decided it.

A table under `tools` is copied into the config Ropes generates for that tool, at `.ropes/configs/<tool>.<ext>`. That file extends the preset Ropes ships, and the tool's root config extends that file, so a rule is stated once, in the Ropes config, and plain `rumdl` or an editor sees it too. `rope doctor --fix` rewrites the generated file after the table changes. [The Markdown standard](docs/markdown-standard.md) has the details. Markdown is the first tool with a table.

The `[editor]` table holds the facts editors and formatters share: indent, line endings, charset, line width. Ropes writes the whole root `.editorconfig` from it, and never overwrites one a person wrote. With `[editor] check = true`, the built-in text checker validates selected files that have no active formatter. See [editor settings](docs/editor-settings.md). A tool's own config that states one of these facts differently is a finding: see [shared facts](docs/shared-facts.md).

This repository uses `rope.toml` and tracks its generated configuration under `.ropes/configs/`.

## Layout

```text
packages/core/src/
  contracts/   Plan, result and finding schemas and parsers. No I/O.
  config/      Pilot config loader.
  policy/      The resolver. Pure: config and selection in, plan out.
  adapters/    One folder per engine, plus the registry that lists them.
  runner/      Runs a plan through adapters. Knows only the adapter interface.
  render/      Turns a result into text or JSON. Pure, and takes only a result.
  commands/    explain, check and fix as functions that take and return data.
  index.ts     Public @ropes/core operations and versioned contract parsers.
packages/cli/src/
  cli.ts       rope argument handling, rendering and exit mapping.
```

The `@ropes/core` package exports typed `explain`, `check`, and `fix` operations. Its `@ropes/core/render` entry point exposes renderers for callers that need command output. `rope` imports those public entry points, and core has no dependency on the CLI. Boundary tests enforce the layer imports and package direction. [docs/adapters.md](docs/adapters.md) explains how to add an engine.

## Develop

```bash
./scripts/bootstrap.sh
bun run check
bun run rope --help
bun run rope doctor
```

`bun run check` runs the [workflow gate](docs/workflows.md), the [terminology guard](docs/terminology.md) for retired-name regressions, `rope check` on this repository, then the tests. `rope check` reads the root `rope.toml` for code linting, type checking and formatting. `bun run fix` is `rope fix`. The check needs the pinned rumdl, Lychee and Taplo on `PATH`. With mise activated in your shell it is. Otherwise run `mise exec -- bun run check`. Without them the step is incomplete and the check fails, which is the point: a check that could not run is not a pass.

The pre-commit hook runs `rope fix` on the files you staged. It stages what it fixed and stops the commit when a finding is left, a type error included, or an engine could not run. It also stops, without fixing anything, when the Ropes setup needs repair, and says to run `rope doctor --fix`. It works on the file in your working tree, so a partly staged file is staged whole.

[Rollout guidance](docs/rollout.md) describes adoption checks and preserves the dated pilot inventory.

Tool versions are pinned in `mise.toml`, and [docs/tool-versions.md](docs/tool-versions.md) says how to change one. See AGENTS.md for the working rules.
