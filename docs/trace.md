# Trace a planned check

Use `rope explain [path...] --trace` to follow selected paths from their policy sources to the initial engine invocations. Add `--json` to preserve the working directory and each argument as structured data. Ordinary `rope explain` keeps its existing output.

```sh
rope explain 'src/a file.ts' legacy/old.ts excluded/old.ts --trace
rope explain 'src/a file.ts' legacy/old.ts excluded/old.ts --trace --json
```

The plan identifies the setting inherited by a path, an override that wins, and the source of an exclusion. Naming an excluded file explicitly keeps its exclusion in the explanation. A workspace explanation retains the existing selection behavior.

The first invocation descriptions cover repository-local and shipped ast-grep rules. The trace names the local rule files to edit and includes the exact inline rule input in the argument array. Other adapters state when their invocation description is unavailable. The trace labels its evidence `planned`; it reads rule files and looks up the executable on `PATH` without starting an engine or confirming its version. A missing executable leaves its planned command and the policy explanation available.

The engine may further narrow coverage with a rule's own file globs. The listed commands are initial invocations. Execution can retry individual files after a failed batch. Run `rope check` on the same paths to observe findings and verify the policy.

The [private-import fixture](../packages/cli/tests/trace-fixture.ts) defines one convention with its rationale and passing and failing examples. Its [acceptance test](../packages/cli/tests/trace.test.ts) checks inherited, overridden, and excluded paths, verifies that tracing starts no engine, and compares the actual engine argument array and findings with the trace. The rule asks callers to import through the public entry point, which keeps consumers on the supported export boundary.
