import type {
  CleanupPolicy,
  CleanupReport,
  CleanupScan,
} from "../contracts/cleanup.ts";
import type { Finding } from "../contracts/finding.ts";
import { outcomeOf } from "../contracts/result.ts";
import { compileGlobs } from "./glob.ts";

const occurrences = (scan: CleanupScan, policy: CleanupPolicy): Finding[] =>
  (scan.result?.steps ?? [])
    .flatMap(({ findings }) => findings)
    .filter(
      (finding) =>
        finding.rule === policy.rule && compileGlobs(policy.scope)(finding.path)
    );

/** Once absent in a lineage, an accepted occurrence cannot regain allowance. */
const retireAbsent = (
  inheritedBefore: Set<string>,
  history: readonly CleanupScan[],
  policy: CleanupPolicy
): void => {
  for (const scan of history) {
    const present = new Set(occurrences(scan, policy).map(({ path }) => path));
    for (const file of inheritedBefore) {
      if (!present.has(file)) {
        inheritedBefore.delete(file);
      }
    }
  }
};

/** A supported rule has at most one occurrence per compiler config. */
export const compareCleanup = (
  scans: CleanupReport["scans"],
  policy: CleanupReport["policy"],
  at: string,
  simulated: boolean,
  uncertainty: readonly string[],
  history: readonly CleanupScan[] = []
): CleanupReport => {
  const anchor = occurrences(scans.anchor, policy);
  const parent = occurrences(scans.parent, policy);
  const candidate = occurrences(scans.candidate, policy);
  const accepted = new Set(anchor.map(({ path }) => path));
  const inheritedBefore = new Set(parent.map(({ path }) => path));
  retireAbsent(inheritedBefore, history, policy);
  const remains = new Set(candidate.map(({ path }) => path));
  const inherited = candidate.filter(
    ({ path }) => accepted.has(path) && inheritedBefore.has(path)
  );
  const introduced = candidate.filter(({ path }) => !accepted.has(path));
  const reintroduced = candidate.filter(
    ({ path }) => accepted.has(path) && !inheritedBefore.has(path)
  );
  const removed = parent.filter(({ path }) => !remains.has(path));
  const observed = scans.candidate.result !== undefined;
  const problems = [...uncertainty];
  for (const [name, findings] of [
    ["anchor", anchor],
    ["parent", parent],
    ["candidate", candidate],
  ] as const) {
    if (new Set(findings.map(({ path }) => path)).size !== findings.length) {
      problems.push(
        `${name} has repeated occurrences. This rule's path identity is ambiguous.`
      );
    }
  }
  const strict =
    policy.deadline !== undefined && at >= `${policy.deadline}T00:00:00.000Z`;
  const residual =
    scans.candidate.result?.steps
      .map((step) => ({
        ...step,
        findings: step.findings.filter(
          (finding) => !inherited.includes(finding) || strict
        ),
      }))
      .map((step) =>
        step.status === "findings" && step.findings.length === 0
          ? { ...step, status: "passed" as const }
          : step
      ) ?? [];
  const native = outcomeOf(residual);
  const incomplete = problems.length > 0 || native === "incomplete";
  let evidence: CleanupReport["evidence"] = "planned";
  if (observed) {
    evidence = simulated ? "simulated" : "observed";
  }
  let outcome: CleanupReport["outcome"] = "clean";
  if (!observed || incomplete) {
    outcome = "incomplete";
  } else if (
    introduced.length > 0 ||
    reintroduced.length > 0 ||
    (strict && candidate.length > 0) ||
    native === "findings"
  ) {
    outcome = "findings";
  }
  return {
    at,
    evidence,
    history: [...history],
    inherited,
    introduced,
    outcome,
    policy,
    reintroduced,
    removed,
    scans,
    schemaVersion: 1,
    uncertainty: problems,
    zero: observed && !incomplete ? candidate.length === 0 : null,
  };
};
