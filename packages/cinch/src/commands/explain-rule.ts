import type { RuleExplanation } from "../contracts/rule-explanation.ts";
import { shippedStates } from "../policy/packs.ts";
import type { Operation, ReadRequest } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { tracePrepared } from "./trace.ts";

export interface RuleRequest extends ReadRequest {
  readonly rule: string;
  readonly trace?: boolean;
}

export const runExplainRule = async (
  request: RuleRequest,
  deps: CommandDeps
): Promise<Operation<RuleExplanation>> => {
  const prepared = await prepare(request, deps, true);
  if (!prepared.ok) {
    return prepared;
  }
  const { adapters, plan } = prepared.value;
  const catalogs = await Promise.all(
    adapters.map(async (adapter) => ({
      adapter: adapter.descriptor.id,
      catalog: await adapter.describeRules?.(plan.root),
    }))
  );
  const failure = catalogs.find(
    ({ catalog }) => catalog?.ok === false
  )?.catalog;
  if (failure?.ok === false) {
    return failure;
  }
  const rules = catalogs.flatMap(({ adapter, catalog }) =>
    catalog?.ok === true
      ? catalog.rules.map((rule) => ({ ...rule, adapter }))
      : []
  );
  const rule = rules.find(({ id }) => id === request.rule);
  if (rule === undefined) {
    return {
      error: `No rule named "${request.rule}" is available. Use a shipped rule ID or local/<id>.`,
      ok: false,
    };
  }
  const traced = await tracePrepared(prepared.value);
  const batches = traced.batches.filter(
    ({ batch }) =>
      batch.adapter === rule.adapter &&
      (rule.id.startsWith("local/") || batch.rules?.includes(rule.id) === true)
  );
  const plannedPaths = new Set(
    batches.flatMap(({ description }) =>
      description.ok ? (description.value.paths ?? []) : []
    )
  );
  const pack = shippedStates(
    prepared.value.config,
    adapters.map(({ descriptor }) => descriptor),
    prepared.value.present
  ).find(({ rules: packRules }) => packRules.some(({ id }) => id === rule.id));
  return {
    ok: true,
    value: {
      evidence: "planned",
      ...(plan.evaluation === undefined ? {} : { evaluation: plan.evaluation }),
      ...(pack === undefined ? {} : { pack }),
      limitations: [
        "Coverage describes existing literal arguments in the planned engine input. Native files, ignores, language, and match conditions are preserved for inspection and evaluated by the engine when check runs. No engine was started.",
        ...batches.flatMap(({ description }) =>
          description.ok ? description.value.limitations : [description.error]
        ),
      ],
      paths: plan.paths.map((path) => {
        if (path.skipped !== undefined) {
          return { path, state: "excluded" };
        }
        return {
          path,
          state: plannedPaths.has(path.path) ? "planned" : "inactive",
        };
      }),
      rule,
      schemaVersion: plan.schemaVersion,
      selection: plan.selection,
      ...(request.trace === true ? { trace: batches } : {}),
    },
  };
};
