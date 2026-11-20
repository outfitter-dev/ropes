# Try a rule before making it blocking

The pilot accepts an explicit advisory or blocking choice for a shipped rule ID. The pack still needs to be adopted and enabled, and file selection and relevance still apply. An enforcement entry alone introduces no check or engine requirement.

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

This slice supports the shipped rule IDs already supplied by the pack registry. Repository-local rule enforcement, calendar conditions, dependency predicates, and automatic changes to a convention's level can follow separate proofs. The level grants no additional permission to modify files.

## Existing adoption behavior

Rules with no new setting keep their blocking behavior. A pack still runs only when the config names it, `rules.enabled` is on, relevant files exist, and the pack or rule has not been disabled. Relevant file discovery can suggest adoption. It supplies no adoption or enforcement choice by itself.

The automatic-enable assumption in ROPE-61 was superseded by explicit pack adoption in ROPE-63. This proof keeps that shipped behavior. The earlier ROPE-63 warning-period sketch is represented here by an explicit advisory choice that a maintainer can review. Native warning severity also retains its current blocking behavior unless the rule has an explicit advisory policy. This slice does not reinterpret an existing pack's rules when upgrading.

## Versioned result contract

The provisional plan/result contract is now version 2. A completed result may have `outcome = "clean"` while retaining native `findings` steps whose diagnostics are all advisory. A consumer must validate the version before interpreting the result. A version-one `parseResult` checks `schemaVersion` against its supported constant first and returns `unknown-version` for 2, including this successful advisory case. The version-two parser likewise rejects version-one documents rather than guessing which verdict semantics apply.

`cinch schema check` and the other generated command schemas use the updated contract definitions. The checked-in config schema includes the new opt-in table, and the plan/result golden fixtures carry version 2. The offline [CLI proof](../packages/cli/tests/enforcement.test.ts) exercises the real shipped rule and engine, mixed outcomes, provenance, override order, missing-tool precedence, and an unadopted pack with a sentinel executable that must remain untouched.
