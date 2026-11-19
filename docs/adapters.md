# Adapters

An adapter is the only code that knows about one engine, such as a linter or a formatter. The resolver reads an adapter's descriptor to plan steps, and the runner calls its three operations. Nothing else in Cinch names an engine.

## Add one

1. Make a folder under `packages/cinch/src/adapters/`, named for the engine.
2. Export an `Adapter` from it. The interface is in `adapters/adapter.ts`.
3. Add it to the list in `adapters/registry.ts`. Order in that list is the order steps run on a file.

No other file changes. `tests/boundaries.test.ts` fails if anything outside `adapters/` imports from an adapter's folder.

## The descriptor

The descriptor is plain data. It is all the resolver sees.

| Field | Meaning |
| --- | --- |
| `id` | The name the plan and the result use for this adapter. |
| `tool` | The external tool the adapter drives. It appears in messages. |
| `versionRange` | A semver range the installed tool must satisfy. `*` accepts any version. |
| `writes` | Whether `fix` may change files. When it is `false`, `fix` runs `check` instead. |
| `unit` | What one step works on: `file`, `package` or `workspace`. Only `file` steps are planned today. |
| `platforms` | Where the tool can run, from `darwin`, `linux` and `win32`. |
| `extensions` | The file extensions, with the dot, that get a step from this adapter. |
| `enabledBy` | The policy key that switches the adapter. A path whose policy sets it to `false` gets no step. |

## The operations

- `probe()` reports whether the tool is installed and at which version. Return the version as plain semver, such as `0.1.2`, with no tool name in front. The runner calls it at most once per run.
- `check(input)` inspects one path and returns findings with a status of `passed` or `findings`. It must not write.
- `fix(input)` may write, and returns `fixed`, or `findings` when something remains that it could not fix.

Any operation may return `incomplete` with a reason when it could not do its work.

## What the runner guarantees

A step is `incomplete`, and the run exits 2, when any of these is true:

- The plan names an adapter that is not registered.
- The current platform is not in `platforms`. The tool is not probed.
- `probe()` says the tool is not available.
- The reported version does not satisfy `versionRange`, or a range is set and no version is reported.
- `probe()`, `check()` or `fix()` throws. The run continues with the next step.

An adapter never has to guard against these itself, and a step that could not run is never reported as passed.

## Keep it free of the command line

An adapter takes a root and a path and returns data. It does not read arguments, print, or set an exit code. That keeps the interface usable from `outfitter`, and from a different command layer later.

## Testing

`packages/cinch/tests/fake-adapter.ts` is an in-memory adapter that records the calls made to it. Use it for anything that tests the runner or the resolver. A test for a real adapter that needs the engine installed skips with a visible reason when the engine is absent.
