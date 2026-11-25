import type { FileOutcome, StepOutcome } from "../adapters/adapter.ts";
import type { PlanBatch } from "../contracts/plan.ts";

export const incomplete = (reason: string): StepOutcome => ({
  findings: [],
  reason,
  status: "incomplete",
});

/** Only a single answer for a planned file can establish its coverage. */
export const answered = (
  batch: PlanBatch,
  outcomes: readonly FileOutcome[]
): FileOutcome[] => {
  const planned = new Set(batch.paths);
  const byPath = new Map<string, FileOutcome>();
  let unplanned: string | undefined;
  for (const outcome of outcomes) {
    const { path } = outcome;
    if (!planned.has(path)) {
      unplanned ??= path;
      continue;
    }
    let { findings } = outcome;
    if (batch.unit !== undefined) {
      const outside = findings.find((finding) => !planned.has(finding.path));
      if (outside !== undefined) {
        unplanned ??= outside.path;
        findings = findings.filter((finding) => planned.has(finding.path));
      }
    }
    byPath.set(
      path,
      byPath.has(path)
        ? {
            ...incomplete(
              `${batch.tool} gave more than one answer for this file`
            ),
            path,
          }
        : { ...outcome, findings }
    );
  }
  if (unplanned !== undefined) {
    // An answer that belongs to no planned file invalidates the batch,
    // while findings from uniquely answered planned files remain visible.
    const reason = `${batch.tool} gave an answer for unplanned file ${JSON.stringify(unplanned)}`;
    return batch.paths.map((path) => ({
      findings: byPath.get(path)?.findings ?? [],
      path,
      reason,
      status: "incomplete",
    }));
  }
  return batch.paths.map(
    (path) =>
      byPath.get(path) ?? {
        ...incomplete(`${batch.tool} gave no answer for this file`),
        path,
      }
  );
};
