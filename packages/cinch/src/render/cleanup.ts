import type { CleanupReport, CleanupScan } from "../contracts/cleanup.ts";
import { pathBlocks } from "./human.ts";
import { renderPlan } from "./plan.ts";

const snapshotDetails = (
  name: string,
  scan: CleanupScan,
  planned: boolean
): string[] => {
  const identity = `${name}: ${scan.commit} (tree ${scan.tree})`;
  if (planned) {
    return [
      identity,
      renderPlan(scan.plan, { configFile: scan.configFile, tools: [] }),
    ];
  }
  const { result } = scan;
  if (result === undefined) {
    return [identity];
  }
  const steps =
    name === "candidate"
      ? result.steps
      : result.steps.filter((step) => step.status === "incomplete");
  return [
    identity,
    ...(name === "candidate" ? ["Candidate raw check diagnostics"] : []),
    ...pathBlocks({ ...result, steps }),
  ];
};

/** Preserve comparison identity and scope even when no checks have run. */
export const renderCleanup = (report: CleanupReport): string =>
  [
    `${report.evidence} cleanup comparison at ${report.at}`,
    `Rule ${report.policy.rule} (${report.policy.ruleSha256})`,
    `Policy ${report.policy.commit}:${report.policy.file}`,
    `Scope ${report.policy.scope.join(", ")}`,
    `Lineage snapshots ${report.history.length}`,
    ...Object.entries(report.scans).flatMap(([name, scan]) =>
      snapshotDetails(name, scan, report.evidence === "planned")
    ),
    ...report.history.flatMap((scan, index) =>
      snapshotDetails(`history-${index}`, scan, report.evidence === "planned")
    ),
    ...(report.evidence === "planned"
      ? ["Planning only. No occurrences were checked."]
      : [
          `Inherited ${report.inherited.length}, removed ${report.removed.length}, introduced ${report.introduced.length}, reintroduced ${report.reintroduced.length}.`,
          ...Object.entries({
            inherited: report.inherited,
            introduced: report.introduced,
            reintroduced: report.reintroduced,
            removed: report.removed,
          }).flatMap(([status, findings]) =>
            findings.map(
              (finding) =>
                `  ${status} ${finding.path}:${finding.range.start.line} ${finding.rule}`
            )
          ),
          `Migration outcome ${report.outcome}. Full scope zero ${String(report.zero)}.`,
        ]),
    ...report.uncertainty,
  ].join("\n");
