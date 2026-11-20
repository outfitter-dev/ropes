# Adapters

An adapter is the only code that knows about one engine, such as a linter or a formatter. The resolver reads an adapter's descriptor to plan steps, and the runner calls its three operations. Nothing else in Cinch names an engine.

## Add one

1. Make a folder under `packages/cinch/src/adapters/`, named for the engine.
2. Export an `Adapter` from it. The interface is in `adapters/adapter.ts`.
3. Add it to the list in `adapters/registry.ts`. Order in that list is the order steps run on a file.

No other file changes. `tests/boundaries.test.ts` fails if anything outside `adapters/` imports from an adapter's folder, or if any source file other than the registry and the engine's own folder mentions the engine by name.

The registry is a function, `adaptersFor(pins)`. It hands each adapter the version the repository pins for its tool in `mise.toml`, and the adapter puts that in its `versionRange`. `adapters/pins.ts` reads the file. See [tool versions](tool-versions.md).

## The descriptor

The descriptor is plain data. It is all the resolver sees.

| Field | Meaning |
| --- | --- |
| `id` | The name the plan and the result use for this adapter. |
| `tool` | The external tool the adapter drives. It appears in messages. |
| `versionRange` | A semver range the installed tool must satisfy. `*` accepts any version. |
| `writes` | Whether `fix` may change files. When it is `false`, `fix` runs `check` instead. |
| `unit` | What one step works on: `file`, `package` or `workspace`. Only `file` steps are planned today, so an adapter with another unit gets no steps yet. |
| `platforms` | Where the tool can run, from `darwin`, `linux` and `win32`. |
| `extensions` | The file extensions, with the dot, that get a step from this adapter. |
| `enabledBy` | The policy key that switches the adapter. A path whose policy sets it to `false` gets no step. |
| `owns` | Optional. Exact root-relative files the adapter keeps. They get a step whatever their extension and whatever `include` says, and they join a workspace run before they exist. |

## Kept files

Some files in a repository belong to Cinch, such as the copy of a shared config preset. `adapters/managed.ts` builds an adapter for them from a list of paths and, for each, a function that says what the file should hold. `check` reports a file that is missing or differs, and `fix` writes it. There is no engine to install, so the probe always succeeds.

An engine's preset lives in the engine's own folder and is listed in the registry like any adapter. `adapters/rumdl/preset.ts` is the first one. Kept files go in `.outfitter/configs/`, and the repository's own config stays at the root and extends the kept one. See [the Markdown standard](markdown-standard.md).

## The operations

- `probe()` reports whether the tool is installed and at which version. Return the version as plain semver, such as `0.1.2`, with no tool name in front. The runner calls it at most once per run.
- `check(input)` inspects one path and returns findings with a status of `passed` or `findings`. It must not write.
- `fix(input)` may write. It returns `fixed` when it changed the file and nothing remains, `findings` when something remains that it could not fix, and `passed` when there was nothing to do.

Any operation may return `incomplete` with a reason when it could not do its work.

## What the runner guarantees

A step is `incomplete`, and the run exits 2, when any of these is true:

- The plan names an adapter that is not registered.
- The current platform is not in `platforms`. The tool is not probed.
- `probe()` says the tool is not available.
- The reported version does not satisfy the `versionRange` in the plan step, or a range is set and no version is reported. The plan's range is the one that counts, so a saved plan holds the tool to what it showed.
- `probe()`, `check()` or `fix()` throws. The run continues with the next step.

An adapter never has to guard against these itself, and a step that could not run is never reported as passed.

## Keep it free of the command line

An adapter takes a root and a path and returns data. It does not read arguments, print, or set an exit code. That keeps the interface usable from `outfitter`, and from a different command layer later.

## rumdl

`adapters/rumdl/` lints Markdown with [rumdl](https://github.com/rvben/rumdl). It runs `rumdl check --output-format json` on one file at a time from the repository root, and `fix` adds `--fix`.

- rumdl reads its own config, such as `.rumdl.toml`, from the repository root. Running rumdl by hand and running it through Cinch therefore apply the same rules. Cinch passes no policy of its own to rumdl. It keeps the shared config that rumdl reads.
- Cinch does not install rumdl. The binary must be on `PATH`. A repository pins the version in `mise.toml`, and `mise install` provides it. Without a pin the adapter accepts the 0.3 releases from 0.3.5, the version its output mapping was checked against.
- rumdl exits 0 when clean, 1 when findings remain and 2 when it could not run, for example on a config file it cannot parse. Exit 2, output that is not the expected JSON, and exit 1 with no finding all make the step incomplete.
- rumdl can run other tools on fenced code. A missing tool is reported under the rule `code-block-tools`, and the step is incomplete. A tool that fails on a block is a warning on stderr, which the adapter reads. When the error is placed in the block itself, the block is not valid code, and that is a finding under the rule `code-block-parse`. Any other failure makes the step incomplete, and the reason names the line. See [the Markdown standard](markdown-standard.md).
- rumdl's cache is switched off, so a run leaves no `.rumdl_cache` folder behind.

## Testing

`packages/cinch/tests/fake-adapter.ts` is an in-memory adapter that records the calls made to it. Use it for anything that tests the runner or the resolver. A test for a real adapter that needs the engine installed skips with a visible reason when the engine is absent. CI installs every pinned tool, so those tests always run there. Locally, `mise exec -- bun run check` runs them when the tools are not on your `PATH`. The last step of `bun run check` is `cinch check` on this repository, and that step does not skip: without the engine it is incomplete and the check fails.

## Taplo

`adapters/taplo/` lints TOML with [Taplo](https://taplo.tamasfe.dev). It runs `taplo lint` on one file at a time from the repository root. It never writes: formatting TOML is the formatter's job, so `fix` only checks.

- A file that does not parse is a finding under the rule `syntax`, one for each problem, with what the parser expected. A file that does not fit its schema is a finding under the rule `schema`, in the schema's words.
- Taplo reads its own config, `.taplo.toml`, from the repository root, and that is where a file is given a schema. This repository checks `cinch.toml` against the schema `cinch schema config` prints. Cinch passes no schema of its own, and Taplo's online schema catalogs stay off, so a check needs no network.
- Cinch does not install Taplo. The binary must be on `PATH`. A repository pins the version in `mise.toml`. Without a pin the adapter accepts the 0.10 releases, the version its output mapping was checked against.
- Taplo 0.10 has no machine-readable output, so the adapter reads the diagnostics it prints. A problem printed without a place, or an exit code that does not match what was printed, makes the step incomplete.
- Taplo exits 0 when its own config excludes the file it was given. The adapter counts a pass only when Taplo says it read the file. Otherwise the step is incomplete.
- `[toml] enabled = false` in the Cinch config switches the adapter off, for the whole repository or for the paths of an override.
