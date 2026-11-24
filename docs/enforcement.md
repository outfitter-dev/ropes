# Try a rule before making it blocking

The pilot accepts an advisory level, a blocking level, or a UTC deadline for a shipped rule ID. Enforcement applies to the selected files covered by an enabled, adopted pack and rule.

```toml
pilot = 0
include = ["**/tsconfig.json"]

[rules]
enabled = true
packs = ["config"]

[rules.enforcement]
"config/tsconfig-extends" = "advisory"

[[overrides]]
paths = ["packages/ready/**"]
[overrides.rules.enforcement]
"config/tsconfig-extends" = "blocking"
```

The root setting applies to selected paths unless an ordered override replaces it. The last matching override that states a level wins for that rule. Overrides that omit the level inherit the preceding choice. `explain` includes the effective value and its authored file/key in each path's policy. Unknown shipped rule IDs and levels are config errors.

```sh
rope explain packages/trial/tsconfig.json packages/ready/tsconfig.json --json
rope check packages/trial/tsconfig.json packages/ready/tsconfig.json --json
```

The same missing-extends diagnostic remains an error from the engine at both levels. Each explicitly governed finding carries its effective `enforcement.level` and `enforcement.source`. Advisory-only completed checks exit 0 and report the advisory count. A blocking match exits 1. A required tool that cannot run yields exit 2, including when other steps have already reported matches. The step's native `findings` status remains a record of its diagnostics, while the shared result verdict applies enforcement.

## Discover and adopt packs

Run `rope rules` or `rope rules list` to inspect each shipped pack's state and the repository's local rules. The report shows where a pack is relevant, whether the policy adopts it, and whether rules are enabled. An adopted pack whose files fall outside selection carries a note naming the policy and the selection to review.

`rope rules adopt config` previews the policy edit. Add `--yes` to apply it, or combine `--yes --dry-run` to retain the preview. A repeat adoption produces no change. An existing rollout enabled only through path overrides keeps that scope when packs are adopted. If the active policy changes during planning, adoption stops so the saved edit can be reviewed before retrying. Adoption writes the active `rope.toml` or supported legacy policy file and leaves the Git index untouched. A repository without a policy config is directed to `rope init` first.

## Preview a shipped rewrite

The optional `config-spelling` pack changes the exact lowercase `"esnext"` value of `compilerOptions.module` in `tsconfig.json` to `"ESNext"`. TypeScript treats both spellings as the same module kind. Adopt the pack explicitly and inspect the patch before applying it.

```sh
rope rules adopt config-spelling --yes
rope fix --dry-run tsconfig.json
rope fix tsconfig.json
```

Only selected files covered by the adopted rule are eligible. Adding `"config-spelling/tsconfig-module-esnext"` to `[rules] off` turns the rule off. Local rules remain report-only, including local rules with a native ast-grep `fix` field.

## Set a deadline

Replace a level with a quoted calendar date, for example `"config/tsconfig-extends" = "2027-02-01"`. The rule is advisory before February 1 and blocking from midnight UTC on February 1. The same override order applies to deadlines and fixed levels. Each active path policy shows the resolved level, its source, and `blockingAt`. Unadopted or disabled rules and paths outside the rule's scope contribute no transition.

```sh
rope check packages/trial/tsconfig.json --at 2027-01-31T23:59:59.999Z --json
rope explain packages/trial/tsconfig.json --at 2027-02-01T00:00:00Z
```

`explain` and `check` accept an explicit UTC instant with seconds and optional milliseconds. Both mark that output as simulated and leave the checkout untouched. An ordinary check samples the current clock once. Machine output records the instant at `plan.evaluation.at`, the simulation flag, and `nextTransitionAt` when an active rule in that selection has a future deadline. Consumers qualifying a current check must require an observed result and rerun it once its next transition arrives. These fields describe only the selected files.

## Existing adoption behavior

Rules with no new setting keep their blocking behavior. A pack still runs only when the config names it, `rules.enabled` is on, relevant files exist, and the pack or rule has not been disabled. Relevant file discovery can suggest adoption. It supplies no adoption or enforcement choice by itself.

The automatic-enable assumption in ROPE-61 was superseded by explicit pack adoption in ROPE-63. This proof keeps that shipped behavior. The earlier ROPE-63 warning-period sketch is represented here by an explicit advisory choice that a maintainer can review. Native warning severity also retains its current blocking behavior unless the rule has an explicit advisory policy. This slice does not reinterpret an existing pack's rules when upgrading.

## Versioned result contract

The provisional plan and result contract uses version 3. A completed result can be clean while retaining native findings when they are all advisory. Consumers must check the version before interpreting a verdict, then use the evaluation data to identify simulations and expired observations. The offline repair reader can also display records that embedded version 2 observations.

`cinch schema check` and the generated config schema describe these fields. The [level proof](../packages/cli/tests/enforcement.test.ts) and [UTC boundary proof](../packages/cli/tests/deadline.test.ts) exercise the shipped rule using the real engine.
