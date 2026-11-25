import { minVersion, subset, validRange } from "semver";

import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { PlanStep } from "../contracts/plan.ts";
import type { PackageTarget, TargetDecision } from "../contracts/targets.ts";
import { WORKSPACE } from "./batches.ts";

/** A range must sit wholly on one side of the API transition. */
export const targetDecision = (
  descriptor: AdapterDescriptor,
  directory: string,
  facts: readonly PackageTarget[]
): TargetDecision | undefined => {
  const condition = descriptor.target;
  if (condition === undefined) {
    return undefined;
  }
  const fact = facts.find(
    (entry) =>
      entry.package === directory && entry.dependency === condition.dependency
  );
  const base = {
    adapter: descriptor.id,
    condition,
    ...(fact === undefined ? {} : { fact }),
  };
  if (fact?.state === "absent") {
    return {
      ...base,
      decision: "inapplicable",
      reason: "the package declares no support target for this dependency",
    };
  }
  if (fact?.state !== "declared" || fact.range === undefined) {
    return {
      ...base,
      decision: "unresolved",
      reason: fact?.reason ?? "the required package target was not collected",
    };
  }
  const range = validRange(fact.range);
  if (range === null || minVersion(range) === null) {
    return {
      ...base,
      decision: "unresolved",
      reason: `unsupported declared support range ${JSON.stringify(fact.range)}`,
    };
  }
  if (/-[0-9A-Za-z]/u.test(fact.range)) {
    return {
      ...base,
      decision: "unresolved",
      reason:
        "prerelease support targets are outside the verified stable API transition",
    };
  }
  if (subset(range, `>=${condition.atLeast}`, { includePrerelease: true })) {
    return {
      ...base,
      decision: "applicable",
      reason: `the entire declared support range reaches ${condition.atLeast}`,
    };
  }
  if (subset(range, `<${condition.atLeast}`, { includePrerelease: true })) {
    return {
      ...base,
      decision: "inapplicable",
      reason: `the entire declared support range precedes ${condition.atLeast}`,
    };
  }
  return {
    ...base,
    decision: "unresolved",
    reason: `declared support range ${JSON.stringify(fact.range)} spans ${condition.atLeast}`,
  };
};

/** Resolve package conditions before creating executable batches. */
export const targetSteps = (
  candidates: readonly PlanStep[],
  descriptors: readonly AdapterDescriptor[],
  directory: string,
  facts: readonly PackageTarget[]
) => {
  const targets = descriptors
    .filter((descriptor) =>
      candidates.some((step) => step.adapter === descriptor.id)
    )
    .flatMap((descriptor) => {
      const scope = descriptor.unit === "workspace" ? WORKSPACE : directory;
      const decision = targetDecision(descriptor, scope, facts);
      return decision === undefined ? [] : [decision];
    });
  const steps = candidates.flatMap((step) => {
    const target = targets.find(({ adapter }) => adapter === step.adapter);
    if (target?.decision === "inapplicable") {
      return [];
    }
    return [
      {
        ...step,
        ...(target?.fact === undefined ? {} : { target: target.fact }),
        ...(target?.decision === "unresolved"
          ? { incomplete: target.reason }
          : {}),
      },
    ];
  });
  return { steps, targets };
};
