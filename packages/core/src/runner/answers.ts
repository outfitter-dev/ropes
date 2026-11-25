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
  let invalid: string | undefined;
  for (const outcome of outcomes) {
    const { path } = outcome;
    if (!planned.has(path)) {
      invalid ??= `gave an answer for unplanned file ${JSON.stringify(path)}`;
      continue;
    }
    let { findings } = outcome;
    if (batch.unit !== undefined) {
      const misplaced = findings.find((finding) => finding.path !== path);
      if (misplaced !== undefined) {
        const wrong = JSON.stringify(misplaced.path);
        invalid ??= planned.has(misplaced.path)
          ? `gave a diagnostic for ${wrong} in the answer for ${JSON.stringify(path)}`
          : `gave a diagnostic for unplanned file ${wrong}`;
        findings = findings.filter((finding) => finding.path === path);
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
  if (invalid !== undefined) {
    // Malformed evidence invalidates the batch. Correctly attributed
    // findings from uniquely answered planned files remain visible.
    const reason = `${batch.tool} ${invalid}`;
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
