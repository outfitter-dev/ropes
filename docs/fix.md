# Fix

`rope fix [path...]` fixes the repository's own files. It runs the same plan `explain` shows and `check` runs, with one difference: a step whose adapter writes is asked to fix, not to check. A step that keeps one of Cinch's own files is the exception. `fix` only checks it, because writing those files is [`rope doctor --fix`](doctor.md). Steps run in the order of the plan's batches: one start of an engine for the files of one package, with the adapters that keep files first. This is provisional, like the plan it runs.

## What it reports

`fix` compares each file with what it held before the run and names the ones that differ. The comparison does not depend on what a step said about itself, so a run that stopped partway still lists every file it wrote.

```text
Changed:
  docs/guide.md

docs/guide.md
  fixed  rumdl

1 file selected, 1 step ran, 0 findings, 1 step fixed.

Clean. Exit code 0.
```

The exit code follows [the usual rule](exit-codes.md): 0 when nothing remains, 1 when findings remain after fixing, 2 when a step could not run. Running `fix` again on a fixed tree changes nothing and exits 0.

## When the setup needs repair

Before it writes anything, `fix` checks the Cinch setup: every file Cinch keeps at the root, whatever paths were named. When one is missing or behind, or could not be judged, `fix` changes nothing, reports the setup problem and exits 1, or 2 when a file could not be judged. An engine reading a missing or stale config would fix files by the wrong rules, so stopping is the safe default.

```text
Nothing was fixed: the Cinch setup needs repair first. Run `rope doctor --fix`, then run this again.

.outfitter/configs/rumdl.toml
  1:1  error  cinch/managed-file  This file is missing. Run `rope doctor --fix`.  [rumdl-preset]  (fixable)
```

With `--json` the report has `stopped`, holding that first line, and `result` holds the setup steps.

A kept file that `exclude` covers while its preset is on cannot be judged at all. `fix` then exits 2 with the same message `rope doctor` gives, naming the file and the setting.

## When two steps undo each other

Some disagreements between tools only show when they run. A lint rule's fix writes code one way, and the formatter, which runs last, writes it back. Comparing settings does not find these, so `fix` looks for them while it runs.

After a step rewrites a file, `fix` checks that file again with each earlier step that could write it. A finding that was not there before, on lines the later step changed, is a conflict. Only the files a step changed are checked again, so a run in which the later steps change nothing does no extra work.

```text
a.ts
  fixed  oxlint
  fixed  bun-fmt
  1:23  error  cinch/fix-conflict  bun rewrote this code, and oxlint then reported unicorn(number-literal-case): Unexpected hexadecimal digits in lowercase. The two disagree, so a fix by one is undone by the other. Change the rule or the setting behind the rewrite.  [oxlint]

Conflict in a.ts: bun-fmt rewrote what unicorn(number-literal-case) [oxlint] then reported.
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-export const mask = 0xABCDEF;
+export const mask = 0xabcdef;
```

- A conflict is a finding with the rule `cinch/fix-conflict`, so the run exits 1. It names the tool's own rule and shows the later step's change to those lines.
- Nothing is fixed a second time. Running the two tools in a loop would hide the disagreement, and the next run would start it again.
- The way out is a decision: switch the rule off, or change the setting behind the rewrite.
- When the earlier step cannot check the file again, that step is incomplete and the run exits 2.
- `check` writes nothing, so it finds no conflicts. It reports the lint finding itself.

## Dry run

`rope fix --dry-run` does the same work on a temporary copy of the root and prints the change as a unified diff. The checkout is not touched. Because the same steps run on the same content, the diff is the change a real `fix` would write.

The copy holds what git would let you commit: tracked files and untracked files that no ignore rule covers. An engine finds its own config there. A file you name is copied even when git ignores it. Other ignored files are not, so an engine config that is ignored does not apply in a dry run. Dependencies installed at the root are the exception: the copy links to the root's `node_modules`, because an engine's config may import from it. Nothing in it is copied. A link that stays inside the root is kept as a link. A link that leads out of it, or into `node_modules`, is copied as the content it reaches, so a step in the copy cannot write to the checkout through it. Without git, the tree is copied as it is, apart from version-control data and `node_modules`. On a large repository the copy takes time.

## JSON

`rope fix --json` prints one report. It is provisional and carries `schemaVersion: 3`.

| Field | Meaning |
| --- | --- |
| `changed` | Root-relative paths whose content differs, in plan order |
| `diff` | Unified diff of every changed file. Empty when nothing changed |
| `dryRun` | `true` when the steps ran on a copy |
| `result` | The same result `check --json` prints, with remaining findings in its steps |
| `result.conflicts` | Only when steps undid each other. One record for each, apart from its finding in `result.steps` |
| `schemaVersion` | `3` |
| `stopped` | Only when nothing was fixed because the setup needs repair: the reason |

A real run and a dry run of the same tree produce the same edits under the same effective policy. With scheduled enforcement, each invocation records its own evaluation time. A deadline that arrives between the two runs can change the verdict.

Each record in `result.conflicts` is one conflict, so a consumer can count them without reading messages.

| Field         | Meaning                                             |
| ------------- | --------------------------------------------------- |
| `path`        | Root-relative path of the file                      |
| `rule`        | The tool's own rule id                              |
| `reportedBy`  | The adapter whose rule reported the rewritten lines |
| `rewrittenBy` | The adapter that rewrote them                       |
| `finding`     | What the tool reported after the rewrite            |
| `diff`        | The rewrite of those lines, as a unified diff       |
