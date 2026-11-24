# Presets

Use `rope preset` to inspect preset files in a configured repository, or `rope preset list <name>` to inspect one preset. `rope preset add <name>` writes a selected active preset, and `rope preset update [name]` refreshes stale or missing files. Each operation accepts at most one preset name, and `add`, `adopt`, and `eject` require one. Add `--dry-run` to preview these writes. `rope preset adopt <name>` and `rope preset eject <name>` preview moving authored settings into `rope.toml` or back into the tool’s root config. Apply either move with `--yes`. A repository with no policy starts with `rope init`. Legacy Cinch configurations retain their existing managed paths when used through either executable.

A preset is a shared config that Cinch ships and keeps in a repository. Cinch writes a managed copy under `.outfitter/configs/presets/`. Beside it, under `.outfitter/configs/`, Cinch writes a config generated from the `[tools.<tool>]` table of the Cinch config, which extends the copy. The tool's root config extends the generated one. All of it is committed, so the tool works without Cinch installed. Do not edit the copy or the generated config. Put a repository's own choices in the Cinch config.

The first preset is `markdown`. See [markdown-standard.md](markdown-standard.md) for what it sets.

## Set a repository up

```sh
rope init
```

This is a dry run. It prints what Cinch would write and writes nothing. With no Cinch config it proposes a starting `cinch.toml`. It then proposes every preset that is switched on. A config that is already there is never rewritten.

```sh
rope init --yes
```

This writes the change. Running it again changes nothing.

When a preset replaces another tool's config, `init` also deals with the old config files. The preview names them and says whether `--yes` will remove them. They are removed only when everything in them was carried over and the setup ended clean. Otherwise they stay and `init` says why. What else still names the old tool, such as a dependency or a hook, is listed and left alone. With `--json`, this is the `retired` object in the report. See [markdown-standard.md](markdown-standard.md) for the Markdown case.

| Flag | What it does |
| --- | --- |
| `--yes` | Writes the change. `-y` is the short form |
| `--dry-run` | States the default out loud. It only shows the change, and it wins over `--yes` |

Cinch never asks a question, so `init` behaves the same at a terminal, in a script and with `--json`.

## See what a repository has

```sh
rope preset
```

```text
markdown
  current  .outfitter/configs/presets/rumdl.toml
  stale    .outfitter/configs/rumdl.toml
  current  .rumdl.toml
```

| State     | Meaning                                                        |
| --------- | -------------------------------------------------------------- |
| `current` | The file matches what this Cinch ships                         |
| `stale`   | The file differs. `rope doctor --fix` rewrites it              |
| `missing` | The file is not there. `rope doctor --fix` writes it           |
| `blocked` | Cinch will not change the file by itself. The message says why |
| `off`     | The config switches the preset off, or has not asked for it    |
| `unknown` | The file could not be checked                                  |

The exit code is 0 when every file is current or off, 1 when one is stale, missing or blocked, and 2 when one is unknown.

Each file is judged by itself. A file that `exclude` covers is `blocked`, because Cinch cannot keep a file the config tells it to leave alone. `rope preset add` and `rope preset update` then write nothing and exit 2, naming the file and the setting, so a preset is never half written. `rope init` plans first for the same reason: when the plan cannot be made, it writes no config either.

Some presets are on unless the config switches them off, such as `markdown`. Others are off until the config asks for them with `preset = true`: `lint`, `format` and `typescript`, which only a TypeScript repository wants. See [the TypeScript standard](typescript-standard.md). Asking `rope preset add` for one that is off writes nothing and says which setting switches it on.

## Add or update a preset

```sh
rope preset add markdown
rope preset update
rope preset update markdown --dry-run
```

`add` writes one preset's files. `update` rewrites what is behind, for one preset or for all of them. With no name it passes over a preset that is off, and naming one that is off is an error that says how to switch it on. `--dry-run` shows the diff and writes nothing. `rope doctor --fix` does what `preset update` does for every preset, and is the command to reach for once a repository is set up. To take a newer standard, upgrade Cinch and run it.

A preset that the config switches off is not written. Cinch names the setting to remove and does not edit a hand-written config.

## Move a tool's settings into the Cinch config, and back

A repository can state its Markdown rules in two places: `.rumdl.toml`, or the `[tools.rumdl]` table in the Cinch config. Both resolve the same. These two commands move the settings from one to the other.

```sh
rope preset adopt markdown
rope preset adopt markdown --yes
rope preset eject markdown --yes
```

`adopt` moves what `.rumdl.toml` states into `[tools.rumdl]`, regenerates `.outfitter/configs/rumdl.toml` from it, and leaves `.rumdl.toml` as the one `extends` line Cinch keeps. `eject` is the way back: the table leaves the Cinch config and becomes a `.rumdl.toml` the repository owns, which still extends the generated file.

Both show the diff of every file and write nothing until `--yes` is given. `--dry-run` wins over `--yes`. After writing, the command checks that the setup is clean, and exits 1 when it is not. A second run finds nothing to move.

The settings move one layer up or down under the same layers as before, so the tool resolves the same before and after. A test runs `rumdl config` at each point and compares.

- Comments move with their settings. Where they cannot, the settings are written afresh and the comments that were lost are listed.
- A setting in `.rumdl.toml` that only repeats the layer below is left out, and the output names it.
- `adopt` stops, writes nothing and exits 1 when a setting is stated in both places with different values, or when the Cinch config already has a table for the same rule. It names the keys to settle by hand.
- `adopt` needs `.rumdl.toml` to extend the generated config already, and the preset under `.outfitter/configs/presets/` to be the one this Cinch ships. When either is not so, run `rope doctor --fix` first.
- `eject` will not overwrite a `.rumdl.toml` the repository wrote. It will not create one beside a `rumdl.toml`, a `.config/rumdl.toml` or a `[tool.rumdl]` table in `pyproject.toml` either, because rumdl would stop reading that file. It stops on a table that sets `extends`.
- Neither command writes a file that is a link to somewhere outside the repository. That exits 2.
- When the files were written and Cinch could not check them afterwards, the command exits 2. When it checked them and they are not clean, it exits 1.

Markdown is the only preset with a tool config to move today.

## How this fits the plan

These commands have no way of their own to write a file. The preset files are steps in the plan, so `rope explain` lists them, `rope check` fails when one is behind, and `rope doctor --fix` writes them. `init` and `preset` run that same plan with the preset files as the selection. `rope fix` only checks them: see [Doctor](doctor.md).
