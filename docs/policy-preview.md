# Preview rule policy changes

Capture the same paths from two local inputs, such as Git worktrees with different pins or declared package support. Use each worktree's pinned Ropes installation. Capture at the same instant for an upgrade comparison, or change only the instant to inspect a deadline. Keep source and selection fixed when you want to isolate the effect of one change.

```sh
# In the base checkout
rope policy snapshot packages/app/src/index.ts --at 2027-02-01T00:00:00Z > /tmp/rope-before.json

# In the candidate checkout
rope policy snapshot packages/app/src/index.ts --at 2027-02-01T00:00:00Z > /tmp/rope-after.json
rope policy compare /tmp/rope-before.json /tmp/rope-after.json
```

The snapshot always prints JSON. Omit paths to capture the workspace. The comparison checks that both snapshots asked for the same selection and accepts `--json` for a versioned report. A path missing from one snapshot leaves coverage incomplete. The preview explains changes to shipped rule adoption, selection, package support and enforcement. It reports the rule catalog and version from each local artifact, so skipping an intermediate version still shows a newly added rule. A stale rule reference fails at capture with the same diagnostic as `rope explain`.

For example, a report can show a compiler config rule moving from advisory to blocking when its deadline arrives and a direct TypeScript API import rule applying after a package raises its declared support range. The report names the affected package and path, both decisions, the decision sources, and the changed input. A comparison exits 2 when required policy coverage is unresolved.

This is a planning-only report. It records no match counts or finding locations. Use `rope check` to observe findings and engine readiness. Both artifacts must support policy snapshots. The report covers shipped rule identities and their resolved policy. Check changes to a rule's matching implementation and local rule bodies separately.
