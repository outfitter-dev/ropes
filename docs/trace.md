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

## Look up a rule

Run `rope explain --rule local/private-import` to start with a finding ID. An optional path narrows the answer, and `--trace` adds planned invocations. The command reads shipped and repository-owned rule definitions, shows their authored message and rationale when present, and groups each selected path under its package with its policy sources.

The report marks a path `planned` when the rule is part of its engine input, `inactive` when its resolved policy has no such invocation, and `excluded` when selection leaves it out. The report preserves native file scopes and metadata without interpreting their glob semantics. Native file scopes, language and match conditions can narrow coverage when the engine runs. Only existing literal file arguments are marked planned; missing setup files stay visible for their keeper's diagnostics. The report is planned evidence and starts no engine. Run `rope check` on the same paths to observe findings.

Use the complete finding ID, such as `config/tsconfig-extends` for a shipped rule or `local/private-import` for a repository-owned rule. Unknown IDs fail with exit code 2. Ordinary `rope explain` keeps its existing output.
