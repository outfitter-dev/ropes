# Adapters

An adapter is the only code that knows about one engine, such as a linter or a formatter. The resolver reads an adapter's descriptor to plan steps, and the runner calls its three operations. Nothing else in Cinch names an engine.

## Add one

1. Make a folder under `packages/cinch/src/adapters/`, named for the engine.
2. Export an `Adapter` from it. The interface is in `adapters/adapter.ts`.
3. Add it to the list in `adapters/registry.ts`. Order in that list is the order steps run on a file, after the adapters that keep files, which always go first.

No other file changes. `tests/boundaries.test.ts` fails if anything outside `adapters/` imports from an adapter's folder, or if any source file other than the registry and the engine's own folder mentions the engine by name.

The registry is a function, `adaptersFor(pins)`. It hands each adapter the version the repository pins for its tool in `mise.toml`, and the adapter puts that in its `versionRange`. `adapters/pins.ts` reads the file. See [tool versions](tool-versions.md).

## The descriptor

The descriptor is plain data. It is all the resolver sees.

| Field | Meaning |
| --- | --- |
| `id` | The name the plan and the result use for this adapter. |
| `tool` | The external tool the adapter drives. It appears in messages. |
| `versionRange` | A semver range the installed tool must satisfy. `*` accepts any version. |
| `writes` | Whether the adapter may change files. When it is `false`, every verb runs `check`. |
| `setup` | Optional. `true` when what the adapter writes is the Cinch setup, not the repository's content. Then `doctor --fix` is the one verb that calls its `fix`, and `cinch fix` runs `check` instead. |
| `unit` | What one step works on: `file`, `package` or `workspace`. Only `file` steps are planned today, so an adapter with another unit gets no steps yet. |
| `platforms` | Where the tool can run, from `darwin`, `linux` and `win32`. |
| `extensions` | The file extensions, with the dot, that get a step from this adapter. |
| `enabledBy` | The policy key that switches the adapter. A path whose policy sets it to `false` gets no step. |
| `optIn` | Optional. The adapter is off until policy sets `enabledBy` to `true`, instead of on until policy sets it to `false`. For a preset only some repositories want. |
| `table` | Optional. The table under `tools` in the Cinch config that the adapter copies into a file it keeps. The registry hands the adapter that table. A table no adapter names is an error. |
| `layers` | Optional. For each kept file, the part it plays in the tool's config: `preset`, `generated` or `root`. `explain` prints it. |
| `reports` | Optional. The [shared facts](shared-facts.md) the adapter can report its tool's value for, by the names the `[editor]` table uses. An empty list says the tool has such settings and the adapter cannot report them, and `explain` says so. |
| `owns` | Optional. Exact root-relative files the adapter keeps. They get a step whatever their extension and whatever `include` says, and they join a workspace run before they exist. |

## Kept files

Some files in a repository belong to Cinch, such as the copy of a shared config preset. `adapters/managed.ts` builds an adapter for them from a list of paths and, for each, a function that says what the file should hold. `check` reports a file that is missing or differs, and `fix` writes it. The descriptor sets `setup`, so the runner calls that `fix` only for `cinch doctor --fix`. There is no engine to install, so the probe always succeeds.

An engine's preset lives in the engine's own folder and is listed in the registry like any adapter. `adapters/rumdl/preset.ts` is the first one. It keeps three files that the engine reads through `extends`: the preset in `.outfitter/configs/presets/`, a config generated from the engine's `tools` table in `.outfitter/configs/`, and the root config, which extends the generated one. The layers stay separate files and are never merged. See [the Markdown standard](markdown-standard.md).

`adapters/shipped.ts` builds the simplest kind: one kept file that is a copy of a file the package ships under `presets/`, behind a comment that says Cinch manages it, and off until the config asks for it. The lint, formatter and compiler presets of [the TypeScript standard](typescript-standard.md) are three of these.

Another adapter may still get a step on a kept file, as the linter does on a preset that is a `.ts` file. A file Cinch writes whole, which is every kept file but a root config, is setup, and only `cinch doctor --fix` writes setup. So the plan marks such a step as one that only checks, `cinch fix` runs it as a check, and its files are a batch of their own. A root config is a person's file and is fixed like any other.

## The operations

- `probe(root)` reports whether the tool is installed and at which version. `root` is the repository the run is for: an engine the repository installs is looked for there, so the probe answers for the executable the run starts. Return the version as plain semver, such as `0.1.2`, with no tool name in front. The runner calls it at most once per run.
- `check(input)` inspects the files of one batch and returns one outcome for each, with its path, its findings and a status of `passed` or `findings`. It must not write.
- `fix(input)` may write. For each file it returns `fixed` when it changed the file and nothing remains, `findings` when something remains that it could not fix, and `passed` when there was nothing to do.

Any file may come back `incomplete` with a reason when the adapter could not do its work on it.

An adapter that lists `reports` also has `facts(root)`. It returns what the tool resolves for those facts, each with the file and the setting that state it, and leaves out a value that is only the tool's default. It reads and never writes. The runner compares the answers, so an adapter never sees another tool's value or the Cinch config's.

## Taking over from another tool

An adapter that replaces a tool, or adopts a hand-written config of its own tool, lists a migration source for each in `migrates`. A source only reads. It has an `id` and two optional questions that `cinch init` asks:

- `inherits(root)` returns the file choices the old config made, as `include` and `exclude` globs for a new `cinch.toml`, with a note for each choice it could not carry.
- `retires(root)` returns the old config files, each reason they should stay, the adapter's own files that the carried settings land in, and what else still names the old tool. `init` asks before it writes anything, and removes the files only when no reason was given and the setup ended clean.

`init` knows only this interface. It never names the tool a source reads, and `tests/boundaries.test.ts` fails when a file outside the engine's folder does.

A source lives in its own folder under the adapter: `adapters/<engine>/migrate/<tool>/`, with an `index.ts` that exports the source. Adding one is that folder and one entry in the adapter's `migrates` list. The Markdown preset has one today, for markdownlint. It writes the carried rules itself, in the step that keeps `.rumdl.toml`, because a source never writes.

## Batches

The input is a batch: a root, a package and the selected files of that package. An engine starts once for all of them, which is what makes a large repository quick. A package is a directory above a selected file that holds a `package.json`, `pyproject.toml`, `Cargo.toml` or `go.mod`. A file with none above it belongs to the workspace, written `.`. The plan lists the batches in the order they run, and `cinch explain` shows each file's package and how many other files its step runs with.

`adapters/batch.ts` has two helpers. `eachFile` is for an engine that judges one file at a time: it calls a function for each file in order. `allIncomplete` gives every file of the batch the same reason, for a start that could not run.

## What the runner guarantees

A step is `incomplete`, and the run exits 2, when any of these is true:

- The plan names an adapter that is not registered.
- The current platform is not in `platforms`. The tool is not probed.
- `probe()` says the tool is not available.
- The reported version does not satisfy the `versionRange` in the plan step, or a range is set and no version is reported. The plan's range is the one that counts, so a saved plan holds the tool to what it showed.
- `probe()`, `check()` or `fix()` throws. The run continues with the next batch.

Each of these marks every file of the batch incomplete. A file the adapter returned no outcome for is incomplete too.

An adapter never has to guard against these itself, and a step that could not run is never reported as passed.

## Keep it free of the command line

An adapter takes a root and the files of a batch and returns data. It does not read arguments, print, or set an exit code. That keeps the interface usable from `outfitter`, and from a different command layer later.

## rumdl

`adapters/rumdl/` lints Markdown with [rumdl](https://github.com/rvben/rumdl). It runs `rumdl check --output-format json` once for the files of a batch, from the repository root, and `fix` adds `--fix`. rumdl names the file on every finding, so each file gets its own outcome.

- rumdl reads its own config, such as `.rumdl.toml`, from the repository root. Running rumdl by hand and running it through Cinch therefore apply the same rules. Cinch passes no policy of its own to rumdl. It keeps the config files that rumdl reads.
- Cinch does not install rumdl. The binary must be on `PATH`. A repository pins the version in `mise.toml`, and `mise install` provides it. Without a pin the adapter accepts the 0.3 releases from 0.3.5, the version its output mapping was checked against.
- rumdl exits 0 when clean, 1 when findings remain and 2 when it could not run, for example on a config file it cannot parse. Exit 2, output that is not the expected JSON, and exit 1 with no finding all make the step incomplete.
- rumdl can run other tools on fenced code. A missing tool is reported under the rule `code-block-tools`, and the step is incomplete. A tool that fails on a block is a warning on stderr, which the adapter reads. When the error is placed in the block itself, the block is not valid code, and that is a finding under the rule `code-block-parse`. Any other failure makes the step incomplete, and the reason names the line. See [the Markdown standard](markdown-standard.md).
- rumdl's cache is switched off, so a run leaves no `.rumdl_cache` folder behind.
- rumdl's own `exclude` patterns are switched off with `--no-exclude`. The files of a step are the plan's, chosen by `cinch.toml`. With the patterns on, rumdl leaves a named file out without saying so, and that file would count as passed.
- When a start of several files exits 2, each file is run by itself, so one file rumdl cannot read does not leave the rest unchecked. A start is given at most 200 files.

## Testing

`packages/cinch/tests/fake-adapter.ts` is an in-memory adapter that records the calls made to it. Use it for anything that tests the runner or the resolver. A test for a real adapter that needs the engine installed skips with a visible reason when the engine is absent. CI installs every pinned tool, so those tests always run there. Locally, `mise exec -- bun run check` runs them when the tools are not on your `PATH`. The last step of `bun run check` is `cinch check` on this repository, and that step does not skip: without the engine it is incomplete and the check fails.

## Taplo

`adapters/taplo/` lints TOML with [Taplo](https://taplo.tamasfe.dev). It runs `taplo lint` on one file at a time from the repository root, because a pass counts only when Taplo says it read that one file. It never writes: formatting TOML is the formatter's job, so `fix` only checks.

- A file that is not sound TOML is a finding under the rule `syntax`, one for each problem: a file that does not parse, with what the parser expected, or one whose keys or tables conflict. A file that does not fit its schema is a finding under the rule `schema`, in the schema's words.
- Taplo reads its own config, `.taplo.toml`, from the repository root, and that is where a file is given a schema. This repository checks `cinch.toml` against the schema `cinch schema config` prints. Cinch passes no schema of its own, and Taplo's online schema catalogs stay off, so a check needs no network.
- Cinch does not install Taplo. The binary must be on `PATH`. A repository pins the version in `mise.toml`. Without a pin the adapter accepts the 0.10 releases, the version its output mapping was checked against.
- Taplo 0.10 has no machine-readable output, so the adapter reads the diagnostics it prints. A problem printed without a place, or an exit code that does not match what was printed, makes the step incomplete.
- Taplo exits 0 when its own config excludes the file it was given. The adapter counts a pass only when Taplo says it read that one file. Otherwise the step is incomplete.
- Taplo 0.10 now and then leaves out the log line that says which files it read, mostly on a busy machine, though it linted the file. Under load here that was 3 of about 4,800 starts. When Taplo ran and that line is missing, the adapter starts it again, three times at most. A file Taplo never accounted for is incomplete. The same goes for the line that names the check a file failed, which tells a schema problem from a syntax one: under the same load it was missing from 562 of 3,000 starts, so the adapter asks again, and a problem whose check Taplo never named is incomplete, not a guessed rule.
- Taplo carries on with no config when it cannot use its own, which would skip every schema. The adapter reports the step incomplete with what Taplo said was wrong.
- Taplo reads a file argument as a glob. The adapter passes the full path with its glob characters made literal, so a name such as `config[1].toml` is the file that gets checked.
- `[toml] enabled = false` in the Cinch config switches the adapter off, for the whole repository or for the paths of an override.

## Oxlint

`adapters/oxlint/` lints TypeScript and JavaScript with [Oxlint](https://oxc.rs/docs/guide/usage/linter). It runs once for the files of a batch, from the repository root, and reads the repository's own `oxlint.config.ts` there, type-aware rules included. In `fix` it runs with `--fix`.

- It is off until the Cinch config sets `lint.enabled = true`, and `include` has to name the files, for example `**/*.ts`. Not every repository has TypeScript, and the default `include` is Markdown and TOML.
- Cinch does not install Oxlint. It is a package, so the adapter looks for it in the repository's `node_modules/.bin` first and then on `PATH`. The probe and the run look in the same places. The lockfile pins it. Without a pin in `mise.toml` the adapter accepts the 1.x releases from 1.93.0, the version its report mapping was checked against.
- A finding keeps Oxlint's own rule id, such as `eslint(no-var)` or `typescript(no-floating-promises)`. A file that does not parse is a finding under the rule `syntax`.
- The JSON report does not say which diagnostics a fix would clear, so no lint finding is marked fixable. `cinch fix` still applies what Oxlint can fix.
- A fixing run reports what it saw before it wrote. The adapter runs a second time without `--fix` and reports what that run finds. A file the fixing run could not take stays incomplete, and the others are still checked again.
- Oxlint states how many files it linted. When that is not the number it was given, it left a file out without saying which, and every file of that run is incomplete. A report that cannot be read, or an exit code of 1 with nothing in the report, is incomplete too.
- A warning is a finding. `cinch check` exits 1 on one, as `oxlint --deny-warnings` does.

## The formatter

`adapters/bun-fmt/` formats with `bun fmt`, which is [oxfmt](https://oxc.rs/docs/guide/usage/formatter) as Bun ships it. It runs once for the files of a batch, from the repository root, and reads the repository's own `oxfmt.config.ts` there. It covers TypeScript and JavaScript, JSON, YAML, TOML, Markdown, CSS, HTML, Vue, GraphQL and Handlebars. In `fix` it writes.

- It is off until the Cinch config sets `format.enabled = true`, and `include` has to name the files.
- The tool is Bun itself, so the `bun` pin in `mise.toml` is the pin. Without one the adapter accepts the 1.x releases from 1.4.4, the version its output mapping was checked against. It runs `bun fmt --no-script`, so a `fmt` script in `package.json` is never run in its place.
- A file that is not formatted is one finding under the rule `format`, at the top of the file, and it is fixable. The formatter does not say where the file differs. A file that does not parse is a finding under the rule `syntax`, at the place the formatter names.
- The formatter passes over a file that an ignore file or its own config leaves out, and says nothing. So the adapter first asks which of the files it would format (`--list-files`). A file that is there and that the formatter leaves out is incomplete, never passed. Leave such a file out of the Cinch config too, with `exclude` or an override that sets `format.enabled = false`.
- A fixing run is followed by a check, and the adapter reports what the check finds.
- Markdown and TOML also have a linter. The linter runs first and the formatter after it, so the formatter has the last word on layout.
