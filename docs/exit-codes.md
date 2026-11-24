# Outcomes and exit codes

Every run ends in one of three outcomes, and each outcome has one exit code.

| Outcome | Exit code | Meaning |
| --- | --- | --- |
| `clean` | 0 | Every required step ran and no blocking finding remains. Advisory findings remain visible. |
| `findings` | 1 | Every required step ran and at least one blocking finding remains. |
| `incomplete` | 2 | At least one step could not run, or the run was unusable. |

Incomplete takes precedence over blocking findings. A run with a missing required tool exits 2, including when another completed step reports findings.

## How a step counts

| Step status  | Counts as                                            |
| ------------ | ---------------------------------------------------- |
| `passed`     | clean                                                |
| `fixed`      | clean                                                |
| `findings`   | findings when any match is blocking, otherwise clean |
| `incomplete` | incomplete                                           |

A `fix` step that repairs some problems and leaves others reports `findings`, not `fixed`.

A step with advisory matches also retains `findings` as its native status. Its diagnostics keep their severity, location, and fixability. The resolved enforcement determines whether those matches block the overall run. Findings with no explicit enforcement retain the blocking default. [Rule enforcement](enforcement.md) records the pilot policy and precedence.

Exit code 2 also covers problems that stop a run before any step, including an unknown command, malformed policy, retired policy files, and unsupported schema or config versions.

## One function decides

`outcomeOf` and `exitCodeOf` in `packages/core/src/contracts/result.ts` are the only place a result becomes an outcome or an exit code. Commands call them and never apply a rule of their own. `exitCodeOf` reads the steps, not the `outcome` field, so a result built or edited by hand cannot exit with a code its steps do not support.

## Empty selections

Running with no paths checks the configured workspace. An explicitly empty selection is different: it means zero files, and Ropes does not widen it to the workspace. A hook runner that forwards an empty file list gets a clean result and exit code 0, and the output says that nothing ran.

A run where files were selected but no step applied to them is also clean. The output states how many steps ran and how many files the config left out, so "0 steps ran" is visible and is never mistaken for a full check.

This is provisional. The specification leaves the exact empty-input syntax and the full per-command exit table open until the plan and result shapes are ratified.

## Output

Both renderers take a result and nothing else.

- The default output is text for a person: findings grouped by file, one summary line, and the verdict with its exit code.
- `--json` prints the result itself. A consumer should read `schemaVersion` first and stop on a version it does not know.
