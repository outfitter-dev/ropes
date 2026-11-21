import type { CleanupReport } from "../contracts/cleanup.ts";

/** Preserve comparison identity and scope even when no checks have run. */
export const renderCleanup = (report: CleanupReport): string =>
  [
    `${report.evidence} cleanup comparison at ${report.at}`,
    `Rule ${report.policy.rule} (${report.policy.ruleSha256})`,
    `Policy ${report.policy.commit}:${report.policy.file}`,
    `Scope ${report.policy.scope.join(", ")}`,
    `Lineage snapshots ${report.history.length}`,
    ...Object.entries(report.scans).map(
      ([name, scan]) => `${name}: ${scan.commit} (tree ${scan.tree})`
    ),
    ...(report.evidence === "planned"
      ? ["Planning only. No occurrences were checked."]
      : [
          `Inherited ${report.inherited.length}, removed ${report.removed.length}, introduced ${report.introduced.length}, reintroduced ${report.reintroduced.length}.`,
          ...[
            ...report.inherited,
            ...report.removed,
            ...report.introduced,
            ...report.reintroduced,
          ].map(
            (finding) =>
              `  ${finding.path}:${finding.range.start.line} ${finding.rule}`
          ),
          `Migration outcome ${report.outcome}. Full scope zero ${String(report.zero)}.`,
        ]),
    ...report.uncertainty,
  ].join("\n");
