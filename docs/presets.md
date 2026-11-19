# Presets

A preset is a shared config that Cinch ships and keeps in a repository. Cinch writes a managed copy under `.outfitter/configs/` and the repository's own config extends it. The copy is committed, so the tool works without Cinch installed. Do not edit the copy. Put a repository's own choices in its root config.

The first preset is `markdown`. See [markdown-standard.md](markdown-standard.md) for what it sets.

## Set a repository up

```sh
cinch init
```

This prints what Cinch would write and changes nothing. With no Cinch config it proposes a starting `cinch.toml`. It then proposes every preset that is switched on.

```sh
cinch init --apply
```

This writes the files and names each one. Running it again changes nothing. A config that is already there is never rewritten.

## See what a repository has

```sh
cinch preset
```

```text
markdown
  stale    .outfitter/configs/rumdl.toml
  current  .rumdl.toml
```

| State     | Meaning                                                        |
| --------- | -------------------------------------------------------------- |
| `current` | The file matches what this Cinch ships                         |
| `stale`   | The file differs. `cinch preset update` rewrites it            |
| `missing` | The file is not there. `cinch preset update` writes it         |
| `blocked` | Cinch will not change the file by itself. The message says why |
| `off`     | The config switches the preset off                             |
| `unknown` | The file could not be checked                                  |

The exit code is 0 when every file is current or off, 1 when one is stale, missing or blocked, and 2 when one is unknown.

## Add or update a preset

```sh
cinch preset add markdown
cinch preset update
cinch preset update markdown --dry-run
```

`add` writes one preset's files. `update` rewrites what is behind, for one preset or for all of them. `--dry-run` shows the diff and writes nothing. To take a newer standard, upgrade Cinch and run `cinch preset update`.

A preset that the config switches off is not written. Cinch names the setting to remove and does not edit a hand-written config.

## How this fits the plan

These commands have no way of their own to write a file. The preset files are steps in the plan, so `cinch explain` lists them, `cinch check` fails when one is behind, and `cinch fix` writes them along with everything else. `init` and `preset` run that same plan with the preset files as the selection.
