import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { CinchConfig } from "../contracts/config.ts";
import {
  ENFORCEMENT_PREFIX,
  EnforcementLevelSchema,
} from "../contracts/enforcement.ts";
import type { PackState, Plan, PlannedPath } from "../contracts/plan.ts";
import type {
  PolicyRule,
  PolicySnapshot,
} from "../contracts/policy-preview.ts";
import { shippedStates } from "./packs.ts";
import { ruleScope } from "./rule-scope.ts";

const enforcement = (
  base: Pick<PolicyRule, "adoption" | "rule">,
  policy: PlannedPath["policy"],
  target: NonNullable<PlannedPath["targets"]>[number] | undefined
): PolicyRule => {
  const setting = policy.find(
    ({ key }) => key === `${ENFORCEMENT_PREFIX}${base.rule}`
  );
  const level = EnforcementLevelSchema.safeParse(setting?.value);
  if (setting !== undefined && !level.success) {
    return {
      ...base,
      reason: "the plan could not resolve the enforcement policy",
      source: setting.source,
      state: "unresolved",
    };
  }
  let reason = "default enforcement";
  if (setting?.blockingAt !== undefined) {
    reason = "scheduled enforcement";
  } else if (setting !== undefined) {
    reason = "explicit enforcement";
  }
  return {
    ...base,
    ...(setting?.blockingAt === undefined
      ? {}
      : { blockingAt: setting.blockingAt }),
    reason,
    source: setting?.source ?? { kind: "default" },
    state: level.success ? level.data : "blocking",
    ...(target === undefined ? {} : { target }),
  };
};

const decision = (
  { path, policy, skipped, steps, targets }: PlannedPath,
  pack: PackState,
  rule: PackState["rules"][number],
  descriptor: AdapterDescriptor
): PolicyRule => {
  const { id } = rule;
  const adoption = pack.named;
  const base = { rule: id, ...(adoption === undefined ? {} : { adoption }) };
  const exemption = skipped?.source ?? rule.off ?? pack.off;
  if (exemption !== undefined) {
    return {
      ...base,
      reason: skipped?.reason ?? "disabled in rules.off",
      source: exemption,
      state: "exempt",
    };
  }
  if (adoption === undefined || pack.found === undefined) {
    return {
      ...base,
      reason:
        adoption === undefined
          ? "the pack is not adopted"
          : "the pack is not relevant to this repository",
      state: "inapplicable",
    };
  }
  const enabled = policy.find(({ key }) => key === descriptor.enabledBy);
  if (enabled?.value === false) {
    return {
      ...base,
      reason: "rules are disabled for this path",
      source: enabled.source,
      state: "exempt",
    };
  }
  const target = targets?.find(({ adapter }) => adapter === pack.adapter);
  if (
    target?.decision === "inapplicable" ||
    target?.decision === "unresolved"
  ) {
    return { ...base, reason: target.reason, state: target.decision, target };
  }
  if (!steps.some(({ adapter }) => adapter === pack.adapter)) {
    return {
      ...base,
      reason: `no check is planned for ${path}`,
      state: "inapplicable",
    };
  }
  return enforcement(base, policy, target);
};

/** Explain shipped rule coverage from the same resolved plan checks execute. */
export const policySnapshot = (input: {
  readonly artifactVersion: string;
  readonly config: CinchConfig;
  readonly descriptors: readonly AdapterDescriptor[];
  readonly plan: Plan;
  readonly present: readonly string[];
}): PolicySnapshot => {
  const { artifactVersion, config, descriptors, plan, present } = input;
  const packs = shippedStates(config, descriptors, present);
  const defined = packs.flatMap((pack) => {
    const descriptor = descriptors.find(({ id }) => id === pack.adapter);
    return descriptor === undefined
      ? []
      : pack.rules.map((rule) => ({
          applies: ruleScope(descriptor, rule.id),
          descriptor,
          pack,
          rule,
        }));
  });
  return {
    artifactVersion,
    catalog: [...new Set(defined.map(({ rule }) => rule.id))].toSorted(),
    ...(plan.evaluation === undefined ? {} : { evaluation: plan.evaluation }),
    evidence: "planned",
    paths: plan.paths.map((entry) => ({
      package: entry.package,
      path: entry.path,
      rules: defined.flatMap(({ applies, descriptor, pack, rule }) => {
        const extension = entry.path.slice(entry.path.lastIndexOf("."));
        return applies(entry.path) && descriptor.extensions.includes(extension)
          ? [decision(entry, pack, rule, descriptor)]
          : [];
      }),
      ...(entry.skipped === undefined ? {} : { skipped: entry.skipped }),
    })),
    root: plan.root,
    schemaVersion: 1,
    selection: plan.selection,
  };
};
