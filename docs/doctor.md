# Doctor

`cinch doctor` checks the Cinch setup, not the repository's content. `cinch doctor --fix` repairs it. It takes no paths, because the setup belongs to the root as a whole.

## What it checks

- Every preset Cinch keeps is present and matches what this Cinch ships. Today that is the copy of [the Markdown standard](markdown-standard.md) at `.outfitter/configs/presets/rumdl.toml`.
- Every generated config matches the Cinch config. Today that is `.outfitter/configs/rumdl.toml`, written from `[tools.rumdl]`. Changing that table leaves the file stale until `cinch doctor --fix` runs.
- The root config extends the generated one. Today that is the `extends` line in `.rumdl.toml`.
- `.editorconfig` matches the `[editor]` table of the Cinch config, when the config has one. See [editor settings](editor-settings.md).
- The tools the workspace's plan needs are installed, at the versions `mise.toml` pins. See [tool versions](tool-versions.md).

A preset the config switches off is no part of the setup, whether or not `exclude` covers its files. A kept file that `exclude` covers while its preset is on stops the run with exit code 2, naming the file and the setting: Cinch cannot keep a file the config tells it to leave alone, and saying nothing would read as a pass.

```text
.outfitter/configs/rumdl.toml
  1:1  error  cinch/managed-file  This file differs from what cinch keeps here. Run `cinch doctor --fix`.  [rumdl-preset]  (fixable)

Tools
  taplo 0.10.0  available, needs 0.10.0
  rumdl 0.3.5  available, needs 0.3.5

The Cinch setup needs repair. Run `cinch doctor --fix`. Exit code 1.
```

The exit code is 0 when the setup is in good shape, 1 when a file needs repair, and 2 when a file could not be judged or a tool cannot run. Doctor does not install tools. It reports them, and mise installs them.

## What `--fix` writes

- The presets and the generated configs. They are rewritten whole.
- A root config that is missing. Cinch creates it as a pointer with the `extends` line, marked as generated.
- The `extends` line in a root config a person wrote that has none. Nothing else in that file changes.

It never overwrites anything else in a file a person wrote. A config that extends something else is reported and left alone, and so is one that is not valid TOML. Those need a person, and `doctor --fix` exits 1 with the finding.

`cinch doctor --fix --dry-run` does the same work on a temporary copy and prints the diff. `--dry-run` without `--fix` changes nothing about a run that already only reports.

## How the verbs divide the files

| Verb                         | Writes                     |
| ---------------------------- | -------------------------- |
| `explain`, `check`, `doctor` | Nothing                    |
| `fix`                        | The repository's own files |
| `doctor --fix`               | The Cinch setup            |

`cinch check` still reports a broken setup and exits non-zero for it, so CI needs no second command. Each finding says to run `cinch doctor --fix`. `cinch fix` checks the setup before it writes and [stops when it needs repair](fix.md#when-the-setup-needs-repair).

`cinch init` is first-time setup: it writes a starting config, which names the rule packs that apply to the repository, and takes over from an older tool. `cinch doctor --fix` keeps an existing setup right, including after a Cinch upgrade. `cinch preset add` and `preset update` write the same files for one preset by name.

## How this fits the plan

Doctor has no way of its own to write a file. The files Cinch keeps are steps in the plan, marked `setup`, so `cinch explain` lists them and says which verb writes them. Doctor runs those steps and no others.

## JSON

`cinch doctor` also lists each rule pack that applies to the repository and that the config neither names nor turns off, under `Rule packs not adopted`. That is a note: it does not change the exit code, and `--fix` does not adopt a pack, because which rules run is the repository's choice. `cinch rules adopt` shows the change and `--yes` writes it. A config that states `enabled = false` under `[rules]` gets no such note. In `--json` the names are in `notAdopted`.

`cinch doctor --json` prints one report. It is provisional and carries `schemaVersion: 1`.

| Field | Meaning |
| --- | --- |
| `changed` | Root-relative paths `--fix` wrote, or would write in a dry run. Empty without `--fix` |
| `diff` | Unified diff of every changed file |
| `dryRun` | `true` when the steps ran on a copy |
| `fix` | `true` when the run was asked to repair |
| `notAdopted` | The names of the rule packs that apply here and that the config neither names nor turns off |
| `result` | The setup steps and their findings, in the shape `check --json` prints |
| `schemaVersion` | `1` |
| `tools` | One entry per tool: `tool`, `versionRange`, the installed `version` when known, and `problem` when it cannot run |

A tool with a `problem` makes the exit code 2 even when `result.outcome` is `clean`.
