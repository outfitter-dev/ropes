# Land a cleanup in stages

The first cleanup proof covers the shipped `config/tsconfig-extends` rule. Its occurrence identity is the root-relative compiler config path and the exact embedded rule digest. Each config can have one occurrence. Line shifts preserve identity. Renaming a config removes the old occurrence and introduces one at the new path.

Commit a migration policy after the accepted anchor. An approved policy fixes the scope, anchor and rule digest. Read the digest from `rope explain --json` at `rules[].rules[].digest`.

```json
{
  "schemaVersion": 1,
  "anchor": "<full-40-character-anchor-commit>",
  "rule": "config/tsconfig-extends",
  "ruleSha256": "<64-character-embedded-rule-digest>",
  "scope": ["packages/**/tsconfig.json"]
}
```

The caller supplies the reviewed policy commit explicitly. For a protected run the caller must obtain that commit from its trusted policy, since a proposed change cannot approve its own allowance.

```sh
rope explain --migration "$approved:migration.json" --parent "$parent" --candidate "$candidate" --json
rope check --migration "$approved:migration.json" --parent "$parent" --candidate "$candidate" --json
```

Use full commit IDs. The approved policy must be an ancestor of the candidate's actual sole parent. The accepted anchor must lie on its linear first-parent history. The command reads immutable Git blobs into disposable snapshots and leaves the checkout and index untouched. It uses full workspace plans, with the migration rule governed by the complete scope in the policy. A path-filtered command cannot qualify the migration.

`explain` reports the plans with `evidence = "planned"`, no observed occurrences, and `zero = null`. `check` executes the same plans at one evaluation instant. It reports the exact commits and trees, policy digest, rule digest, inherited, removed, introduced and reintroduced findings. The report uses envelope version 1 and embeds current v4 plans and results. Archived nested evidence is rejected; rerun cleanup to generate a current report. Public consumers can validate it with `parseCleanup`, and `rope schema check migration` prints its schema. It preserves the candidate's raw result as evidence while calculating migration compliance separately. Other blocking findings and incomplete steps retain their verdicts. A migration can pass with inherited debt, and `zero` becomes true only after a complete scan with no remaining occurrences of that rule in scope.

The command scans intervening commits too, so removing an occurrence retires its allowance along that lineage. A later reintroduction remains blocking even when another commit carries it forward. It rejects repeated diagnostics that cannot have the pilot's one-occurrence identity. Every comparison freezes all root and nested `rope.toml`, `cinch.toml`, `outfitter.toml`, `mise.toml`, `sgconfig.yml`, `sgconfig.yaml`, `package.json` and `bun.lock` files at the approved revision. Snapshots containing retired policy or managed paths require manual migration before a current comparison. A changed context, unknown rule digest, missing engine, unsupported snapshot or incomplete scope exits 2. A new or reintroduced occurrence exits 1. A fully evaluated compliant change exits 0.

An optional `deadline` in the policy accepts a quoted UTC date. From midnight on that date all residual debt blocks. `--at` evaluates an explicit UTC instant and marks the report simulated. A protected current run must verify its trusted clock and reject simulated qualification.

This first slice requires plain tracked files, JSON compiler configs and a linear history. Symlinks, submodules, merge commits, partial comparisons and policy-context changes need a separately reviewed comparison. Installed dependencies are absent from the immutable snapshots, so checks requiring unavailable dependencies are incomplete. For a rule whose occurrence identity cannot be proved, adopt strict enforcement one independently verifiable path or package at a time. A compatibility migration must keep the old target working until the final dependency upgrade passes its required checks.

Protected consumers own approval of the policy commit, the expected parent and candidate tree, and the evaluation clock. They must verify those identities against their target before treating an observed report as qualification. An explicitly approved update at the same policy path can replace an earlier policy. Earlier snapshots use that selected approval, while any later rewrite or deletion is rejected. Each materialized snapshot is removed after scanning. Git replacement objects are disabled. Unsupported path encodings and aliases are rejected, and immutable file reads use bounded concurrency.

The frozen context belongs to this migration rule. Native engine configurations beyond the listed files are evaluated as they exist in each snapshot. The report preserves the candidate's complete raw check verdict. Protected callers also review and bind those native policy inputs before qualification.
