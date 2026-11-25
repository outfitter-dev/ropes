# Doctor

`rope doctor` inspects the setup, the workspace's required tools, and the shared settings those active tools can report. Use `--json` for the typed core report. The `settings` field shows the shared policy alongside observed values, their authored sources, and whether each value was confirmed by the engine or read from its selected config. Verification limits remain visible when a tool cannot expose a resolved value. `rope doctor` is read-only by default. Run `rope doctor --fix` to repair managed setup, or add `--dry-run` to preview the diff. It takes no paths because setup belongs to the whole repository.

A successful `rope doctor --fix` establishes that its managed setup repairs completed and the required tools are available. Run plain `rope doctor` afterward to inspect the active tools' observed shared settings as well. Use the authored sources listed by plain doctor to resolve shared-setting disagreements. The public core operation follows the CLI option rules, including rejecting an evaluation time and a dry run without repair.

Setup paths must be regular files and directories. Doctor rejects an active setup path that is a symbolic link, including a dangling link or a linked parent directory, before writing any setup file. A preset disabled by policy has no setup path to repair.

`rope doctor` checks the Cinch setup, not the repository's content. `rope doctor --fix` repairs it. It takes no paths, because the setup belongs to the root as a whole.

## What it checks

- Every preset Cinch keeps is present and matches what this Cinch ships. Today that is the copy of [the Markdown standard](markdown-standard.md) at `.outfitter/configs/presets/rumdl.toml`.
- Every generated config matches the Cinch config. Today that is `.outfitter/configs/rumdl.toml`, written from `[tools.rumdl]`. Changing that table leaves the file stale until `rope doctor --fix` runs.
- Each tool's own root config builds on what Cinch keeps for it, while that preset is on: the `extends` line in `.rumdl.toml`, the `extends` key in `tsconfig.json`, and the preset import in `oxlint.config.ts` and `oxfmt.config.ts`.
- `.editorconfig` matches the `[editor]` table of the Cinch config, when the config has one. See [editor settings](editor-settings.md).
- The tools the workspace's plan needs are installed, at the versions `mise.toml` pins. See [tool versions](tool-versions.md).

A preset the config switches off is no part of the setup, whether or not `exclude` covers its files. A kept file that `exclude` covers while its preset is on stops the run with exit code 2, naming the file and the setting: Cinch cannot keep a file the config tells it to leave alone, and saying nothing would read as a pass.

```text
.outfitter/configs/rumdl.toml
  1:1  error  cinch/managed-file  This file differs from what cinch keeps here. Run `rope doctor --fix`.  [rumdl-preset]  (fixable)

Tools
  taplo 0.10.0  available, needs 0.10.0
  rumdl 0.3.5  available, needs 0.3.5

The Cinch setup needs repair. Run `rope doctor --fix`. Exit code 1.
```

The exit code is 0 when the setup is in good shape, 1 when a file needs repair, and 2 when a file could not be judged or a tool cannot run. Doctor does not install tools. It reports them, and mise installs them.

## What `--fix` writes

- The presets and the generated configs. They are rewritten whole.
- A root config that is missing. `.rumdl.toml` is created as a pointer with the `extends` line, marked as generated. The others are created as the smallest file that uses the preset, and are the repository's own from then on.
- The `extends` line in a `.rumdl.toml` or a `tsconfig.json` a person wrote that has none. Nothing else in that file changes.

It never overwrites anything else in a file a person wrote. A config that extends something else is reported and left alone, and so is one Cinch cannot read. An `oxlint.config.ts` or `oxfmt.config.ts` that does not import its preset is reported with the lines to add, since it is a module a person wrote. Those need a person, and `doctor --fix` exits 1 with the finding.

`rope doctor --fix --dry-run` does the same work on a temporary copy and prints the diff. `--dry-run` without `--fix` changes nothing about a run that already only reports.

## How the verbs divide the files

| Verb                         | Writes                     |
| ---------------------------- | -------------------------- |
| `explain`, `check`, `doctor` | Nothing                    |
| `fix`                        | The repository's own files |
| `doctor --fix`               | The Cinch setup            |

`rope check` still reports a broken setup and exits non-zero for it, so CI needs no second command. Each finding says to run `rope doctor --fix`. `rope fix` checks the setup before it writes and [stops when it needs repair](fix.md#when-the-setup-needs-repair).

`rope init` is first-time setup: it writes a starting config, which names the rule packs that apply to the repository, and takes over from an older tool. `rope doctor --fix` keeps an existing setup right, including after a Cinch upgrade. `rope preset add` and `preset update` write the same files for one preset by name.

## How this fits the plan

Doctor has no way of its own to write a file. The files Cinch keeps are steps in the plan, marked `setup`, so `rope explain` lists them and says which verb writes them. Doctor runs those steps and no others.

## JSON

`rope doctor` also lists each rule pack that applies to the repository and that the config neither names nor turns off, under `Rule packs not adopted`. That is a note: it does not change the exit code, and `--fix` does not adopt a pack, because which rules run is the repository's choice. `rope rules adopt` shows the change and `--yes` writes it. A config that states `enabled = false` under `[rules]` gets no such note. In `--json` the names are in `notAdopted`.

`rope doctor --json` prints one report. It is provisional and carries `schemaVersion: 3`.

| Field | Meaning |
| --- | --- |
| `changed` | Root-relative paths `--fix` wrote, or would write in a dry run. Empty without `--fix` |
| `diff` | Unified diff of every changed file |
| `dryRun` | `true` when the steps ran on a copy |
| `fix` | `true` when the run was asked to repair |
| `notAdopted` | The names of the rule packs that apply here and that the config neither names nor turns off |
| `result` | The setup steps and their findings, in the shape `check --json` prints |
| `schemaVersion` | `3` |
| `tools` | One entry per tool: `tool`, `versionRange`, the installed `version` when known, and `problem` when it cannot run |

A tool with a `problem` makes the exit code 2 even when `result.outcome` is `clean`.
