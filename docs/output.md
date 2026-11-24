# Output

Run `rope schema` to list the available schemas. `rope schema explain`, `rope schema check`, and `rope schema fix` describe the ordinary structured reports. The `--migration` variants use `rope schema explain migration` and `rope schema check migration`. `explain --trace`, `explain --rule`, `migrate`, and `policy` have separate response shapes outside this listing. `migrate` currently returns manual guidance as an error response. `rope schema config` prints the schema for `rope.toml`. Preset and rule commands have schemas for each JSON report, such as `rope schema preset adopt` and `rope schema rules list`.

Commands print plain text for people or one structured document with `--json`. `policy snapshot` always prints its JSON artifact. Output can be piped without a terminal.

The current shared output version is 4. Ropes-owned finding IDs are `ropes/managed-file`, `ropes/preset-dependency`, `ropes/fix-conflict`, `ropes/unused-disable`, and `ropes/unknown-disable`. Plans identify Ropes’ built-in setup steps with `tool: "ropes"`.

`parsePlan` and `parseResult` reject older versions, including version 3 results with `cinch/` finding IDs. Rerun the command to produce current qualification evidence. The offline repair reader preserves version 3 and version 2 observations and their original IDs verbatim. New repair submissions require current results. Repair records and policy snapshots retain their own version 1 envelopes. Cleanup reports use envelope version 1 and require the current output version for nested plans and results. Rerun cleanup to replace an older report before qualification.

## Text

The default. It has no color, no cursor movement and no prompt, so it reads the same in a terminal, a pipe and a log. Its wording may change in any release. Scripts should read the JSON.

## `--json`

A successful command prints one JSON document on stdout. Versioned command reports carry `schemaVersion`; `rope schema` emits JSON Schema with its own `$schema` declaration.

```sh
rope check --json | jq -r '.outcome'
rope check --json | jq -r '.steps[].findings[] | "\(.path):\(.range.start.line) \(.message)"'
rope fix --dry-run --json | jq -r '.changed[]'
rope explain README.md --json | jq '.paths[].steps'
rope preset --json | jq -r '.presets[].files[] | select(.state != "current") | .path'
```

A command that ran reports on stdout, whatever it found. The exit code says which: 0 clean, 1 findings remain, 2 incomplete.

A command that could not run at all prints nothing on stdout. Its reason goes to stderr and it exits 2. With `--json` the reason is one line of JSON:

```json
{
  "error": { "message": "no-such-file.md does not exist." },
  "schemaVersion": 4
}
```

## `rope schema`

Prints the JSON Schema of a command's `--json` document, so a filter can be written without running the command first.

```sh
rope schema                 # the names
rope schema check           # what `rope check --json` prints
rope schema doctor          # what `rope doctor --json` prints
rope schema preset add      # `preset add` and `preset update` print a fix report
rope schema failure         # the stderr document above
rope schema check | jq '.properties | keys'
rope schema config          # the config file, not an output
```

Schema generation loads no repository policy and starts no engines. The installed launcher still resolves the repository-pinned CLI. The schemas come from the same definitions Ropes checks its own output against. They are the unstable pilot format, and `schemaVersion` changes when they do.

`rope schema config` prints the JSON Schema for `rope.toml`, generated from the loader's definition so editors and Taplo can flag unknown settings before a run. The same schema is checked in at `packages/core/schemas/rope.schema.json`, and the schema test checks that generated and checked-in output agree.
