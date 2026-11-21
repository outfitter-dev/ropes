import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { CinchConfig } from "../contracts/config.ts";
import { ENFORCEMENT_PREFIX } from "../contracts/enforcement.ts";
import type {
  Evaluation,
  Plan,
  PlanBatch,
  PlannedPath,
  PolicyValue,
} from "../contracts/plan.ts";
import { ruleScope } from "./rule-scope.ts";

const deadlineOf = ({ key, value }: PolicyValue): string | undefined =>
  key.startsWith(ENFORCEMENT_PREFIX) &&
  typeof value === "string" &&
  value !== "advisory" &&
  value !== "blocking"
    ? `${value}T00:00:00.000Z`
    : undefined;

/** Only rules actually planned for a file can acquire a deadline there. */
const activeRules = (
  batches: readonly PlanBatch[],
  descriptors: readonly AdapterDescriptor[]
): Map<string, Set<string>> => {
  const byPath = new Map<string, Set<string>>();
  for (const batch of batches) {
    const descriptor = descriptors.find(({ id }) => id === batch.adapter);
    for (const rule of batch.rules ?? []) {
      const applies = ruleScope(descriptor, rule);
      for (const path of batch.paths) {
        if (applies(path)) {
          const ids = byPath.get(path) ?? new Set<string>();
          ids.add(rule);
          byPath.set(path, ids);
        }
      }
    }
  }
  return byPath;
};

/** Keep the configured source and effective level together in the file policy. */
export const resolveDeadlines = (
  config: CinchConfig,
  clock: Evaluation | undefined,
  paths: readonly PlannedPath[],
  batches: readonly PlanBatch[],
  descriptors: readonly AdapterDescriptor[]
): Pick<Plan, "paths" | "evaluation"> => {
  const scheduled = [
    config.settings,
    ...config.overrides.map(({ settings }) => settings),
  ].some((settings) =>
    settings.some((setting) => deadlineOf(setting) !== undefined)
  );
  if (!scheduled && clock?.simulated !== true) {
    return { paths };
  }
  if (clock === undefined) {
    throw new Error("Scheduled enforcement needs an evaluation instant.");
  }
  const active = scheduled
    ? activeRules(batches, descriptors)
    : new Map<string, Set<string>>();
  let nextTransitionAt: string | undefined;
  const resolved = paths.map((entry): PlannedPath => {
    const rules = active.get(entry.path);
    if (rules === undefined) {
      return entry;
    }
    const policy = entry.policy.map((setting): PolicyValue => {
      const blockingAt = deadlineOf(setting);
      if (
        blockingAt === undefined ||
        !rules.has(setting.key.slice(ENFORCEMENT_PREFIX.length))
      ) {
        return setting;
      }
      const pending = clock.at < blockingAt;
      if (
        pending &&
        (nextTransitionAt === undefined || blockingAt < nextTransitionAt)
      ) {
        nextTransitionAt = blockingAt;
      }
      return {
        ...setting,
        blockingAt,
        value: pending ? "advisory" : "blocking",
      };
    });
    return { ...entry, policy };
  });
  return {
    evaluation: {
      ...clock,
      ...(nextTransitionAt === undefined ? {} : { nextTransitionAt }),
    },
    paths: resolved,
  };
};
