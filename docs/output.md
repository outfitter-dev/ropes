# Output

Every Cinch command prints plain text for a person, or one JSON document with `--json`. Neither depends on a terminal, so both can be piped.

## Text

The default. It has no color, no cursor movement and no prompt, so it reads the same in a terminal, a pipe and a log. Its wording may change in any release. Scripts should read the JSON.

## `--json`

Prints one JSON document on stdout and nothing else. Each command has its own document, and every document carries `schemaVersion`.

```sh
cinch check --json | jq -r '.outcome'
cinch check --json | jq -r '.steps[].findings[] | "\(.path):\(.range.start.line) \(.message)"'
cinch fix --dry-run --json | jq -r '.changed[]'
cinch explain README.md --json | jq '.paths[].steps'
cinch preset --json | jq -r '.presets[].files[] | select(.state != "current") | .path'
```

A command that ran reports on stdout, whatever it found. The exit code says which: 0 clean, 1 findings remain, 2 incomplete.

A command that could not run at all prints nothing on stdout. Its reason goes to stderr and it exits 2. With `--json` the reason is one line of JSON:

```json
{
  "error": { "message": "no-such-file.md does not exist." },
  "schemaVersion": 3
}
```

## `cinch schema`

Prints the JSON Schema of a command's `--json` document, so a filter can be written without running the command first.

```sh
cinch schema                 # the names
cinch schema check           # what `cinch check --json` prints
cinch schema doctor          # what `cinch doctor --json` prints
cinch schema preset add      # `preset add` and `preset update` print a fix report
cinch schema failure         # the stderr document above
cinch schema check | jq '.properties | keys'
cinch schema config          # the config file, not an output
```

`cinch schema` reads no files and runs no tools. The schemas come from the same definitions Cinch checks its own output against. They are the unstable pilot format, and `schemaVersion` changes when they do.

`cinch schema config` is the one name that is not an output. It prints the JSON Schema of `cinch.toml`, made from the definition the loader reads with, so an editor or Taplo can flag an unknown key before Cinch runs. The same schema is checked in at `packages/cinch/schemas/cinch.schema.json`, and a test fails when the two differ. It describes the `[cinch]` table of `outfitter.toml` as well, though nothing points Taplo at that table yet.
