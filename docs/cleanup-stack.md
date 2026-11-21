# Qualify a cleanup one layer at a time

The [cleanup comparison](cleanup.md) can qualify a plain Git candidate against a fixed approved allowance and its exact immediate parent. The stack acceptance fixture uses twelve compiler configs without `extends`, the embedded `config/tsconfig-extends` rule and ast-grep 0.51.3. Each config path is one occurrence. The approved policy fixes the anchor, full scope and rule digest before any cleanup begins.

| Layer | Parent debt | Removed in this layer | Candidate debt | Migration complies | Full scope zero |
| --- | --- | --- | --- | --- | --- |
| First | 12 | 5 | 7 | Yes | No |
| Second | 7 | 4 | 3 | Yes | No |
| Third | 3 | 3 | 0 | Yes | Yes |

The candidate’s raw check result still contains the remaining findings. Its migration verdict separately permits the occurrences inherited from the approved anchor and still allowed along the actual parent lineage. The fixture also shows an invalid middle layer introducing a violation before a clean tip removes it. Each layer must qualify on its own.

## Supply the actual parent and candidate

Read the approved policy revision from the caller’s trusted configuration. Construct or select the candidate for the actual target before running the comparison. The command requires full commit IDs and verifies that the supplied parent is the candidate’s sole actual parent.

```sh
parent=$(git rev-parse target^{commit})
candidate=$(git rev-parse cleanup-layer^{commit})
rope check --migration "$approved:migration.json" \
  --parent "$parent" --candidate "$candidate" --json
```

If that candidate was built on an earlier target, construct a new integration candidate first. The proof squash-lands only the first layer, allows unrelated work while seven occurrences remain, and adds a concurrent target fix. A sibling candidate that restores that fixed occurrence fails even while reducing the total to four. Cherry-picking the remaining layers onto the advanced target creates new candidates. Their reports bind to the new commits and trees. Supplying the earlier parent returns exit 2.

The fixture tests missing exact inputs and unreviewed policy-context changes as incomplete comparisons. The command preserves its explicit-base contract and makes the caller responsible for selecting the actual integration target.

## Consume each kind of progress

A plain consumer replay validates the versioned report with public `parseCleanup`. It obtains the expected policy commit, parent, candidate and candidate tree independently from Git and compares them to the report before evaluating the verdict.

The replay presents removals attributable to the layer, total campaign debt and full-scope zero as separate values. It rejects a previous layer’s report for a different parent or candidate and rejects simulated reports for current qualification. A deliberate local replay may accept a simulated report. At midnight UTC on the policy deadline, the actual squash-landed first layer blocks on its seven remaining occurrences, the restacked middle layer blocks on three, and the rebased completed tip passes independently.

## Keep dependency upgrades independently runnable

The compatibility fixture uses the same Bun 1.4.4 checker with official TypeScript 4.9.5 and 5.0.4 declarations. The old source imports TypeScript’s exported `Map` type. A source-only layer replaces that dependency on the removed API with native `Map`, and passes on the old API. The final dependency upgrade then passes on the new API. Restoring the removed import against the new API fails with the native compiler diagnostic.

A dependency upgrade changes the immutable context frozen by the cleanup policy. Run the final upgrade through ordinary strict checking under its reviewed new context. A failing build still blocks. When a source form supported by both versions is unavailable, maintain a tested compatibility bridge or land the source and dependency change together in the smallest independently valid cutover.

## Reproduce the acceptance fixture

```sh
bun test packages/cli/tests/cleanup-stack.test.ts \
  packages/cli/tests/cleanup-restack.test.ts \
  packages/cli/tests/cleanup-stack-consumer.test.ts \
  packages/cli/tests/cleanup-stack-compatibility.test.ts
```

The tests use disposable plain Git repositories and local CLI invocations. The pinned ast-grep engine is required for the migration fixture. Bun and the exact installed API declarations are required for the compatibility fixture. The public comparison, parser and ordinary strict check supply the proof. The fixture creates local branches and commits, and each temporary checkout is removed afterwards.
