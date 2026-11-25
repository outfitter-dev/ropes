import type { ToolStatus } from "../contracts/doctor.ts";
import type {
  Plan,
  PlanBatch,
  PlannedPath,
  PlanStep,
  PolicyValue,
  Provenance,
} from "../contracts/plan.ts";
import type { TargetDecision } from "../contracts/targets.ts";
import { evaluationLines } from "./evaluation.ts";
import { factsBlock } from "./facts.ts";
import { localRulesBlock, rulesBlock } from "./rules.ts";

export type { ToolStatus } from "../contracts/doctor.ts";

/** What `explain` knows beyond the plan itself. */
export interface PlanContext {
  /** Root-relative config file. Null when the defaults apply. */
  readonly configFile: string | null;
  readonly tools: readonly ToolStatus[];
}

const origin = (source: Provenance): string =>
  source.kind === "default" ? "default" : `${source.file}: ${source.key}`;

const policyLine = (setting: PolicyValue): string => {
  const deadline =
    setting.blockingAt === undefined
      ? ""
      : `, blocking from ${setting.blockingAt}`;
  return `    ${setting.key} = ${String(setting.value)}  (${origin(setting.source)}${deadline})`;
};

const targetLine = (target: TargetDecision): string => {
  const source = target.fact?.source;
  const evidence =
    source === undefined
      ? "no target evidence"
      : `${source.file} ${source.key}`;
  return `  ${target.adapter} ${target.decision} — ${target.reason} (${evidence})`;
};

/** How many other files the step's one start of the engine also covers. */
const company = (
  step: PlanStep,
  planned: PlannedPath,
  batches: readonly PlanBatch[]
): string => {
  const batch = batches.find(
    (candidate) =>
      candidate.adapter === step.adapter &&
      (candidate.unit === "workspace" ||
        candidate.package === planned.package) &&
      candidate.paths.includes(planned.path)
  );
  if (batch?.unit !== undefined) {
    return `  (${batch.unit} step)`;
  }
  const others = (batch?.paths.length ?? 1) - 1;
  if (others === 0) {
    return "";
  }
  return `  with ${others} other ${others === 1 ? "file" : "files"}`;
};

/** What the verbs do with a step. Setup is written by `doctor --fix` only. */
const doing = (step: PlanStep): string => {
  if (!step.writes) {
    return "checks";
  }
  return step.setup === true
    ? "checks, and `doctor --fix` writes"
    : "checks and fixes";
};

const stepLine =
  (planned: PlannedPath, batches: readonly PlanBatch[]) =>
  (step: PlanStep): string =>
    [
      `    ${step.adapter}  ${step.tool} ${step.versionRange}  ${doing(step)}${company(step, planned, batches)}`,
      ...(step.recovery === undefined
        ? []
        : [
            `      recovery  ${step.recovery.tool} ${step.recovery.version} (${step.recovery.package}) on ${step.recovery.platform} when ${step.recovery.when}`,
          ]),
    ].join("\n");

const LAYER = {
  generated: "generated from the Ropes config, and extends the preset",
  preset: "the preset this Ropes ships",
  root: "the config the tool reads first, which extends the generated one",
} satisfies Record<NonNullable<PlannedPath["layer"]>, string>;

const REASON = {
  excluded: "excluded",
  "not-included": "not included",
} satisfies Record<NonNullable<PlannedPath["skipped"]>["reason"], string>;

const pathBlock =
  (batches: readonly PlanBatch[]) =>
  (planned: PlannedPath): string => {
    if (planned.skipped) {
      const { reason, source } = planned.skipped;
      return `${planned.path}\n  left out: ${REASON[reason]} (${origin(source)})`;
    }
    return [
      planned.path,
      ...(planned.layer === undefined
        ? []
        : [`  layer: ${planned.layer}, ${LAYER[planned.layer]}`]),
      `  package: ${planned.package === "." ? "the workspace" : planned.package}`,
      "  policy",
      ...planned.policy.map(policyLine),
      ...(planned.targets ?? []).map(targetLine),
      ...(planned.steps.length === 0
        ? ["  no step applies to this file"]
        : ["  steps", ...planned.steps.map(stepLine(planned, batches))]),
    ].join("\n");
  };

const scopedSteps = (batches: readonly PlanBatch[]): string[] =>
  batches.flatMap((batch) => {
    if (batch.unit === undefined) {
      return [];
    }
    const scope =
      batch.unit === "workspace" ? "Workspace" : `Package ${batch.package}`;
    return [
      [
        `${scope} step for ${batch.adapter} covers`,
        ...batch.paths.map((path) => `  ${path}`),
      ].join("\n"),
    ];
  });

export const toolLine = (status: ToolStatus): string => {
  if (status.problem !== undefined) {
    return `  ${status.tool}  unavailable: ${status.problem}`;
  }
  const name = [status.tool, status.version].filter(Boolean).join(" ");
  const line = `  ${name}  available, needs ${status.versionRange}`;
  return status.notice === undefined ? line : `${line}\n    ${status.notice}`;
};

const summary = (plan: Plan): string => {
  const steps = plan.paths.reduce((sum, entry) => sum + entry.steps.length, 0);
  const files = plan.paths.length;
  const starts = plan.batches.length;
  return files === 0
    ? "No files selected, so there is nothing to plan."
    : `${files} ${files === 1 ? "file" : "files"}, ${steps} ${steps === 1 ? "step" : "steps"} planned in ${starts} ${starts === 1 ? "batch" : "batches"}. Nothing was run.`;
};

/** The plan as text for a person. `check` and `fix` run exactly these steps. */
export const renderPlan = (plan: Plan, context: PlanContext): string =>
  [
    [
      `Root: ${plan.root}`,
      `Config: ${context.configFile ?? "none, so the defaults apply"}`,
    ].join("\n"),
    ...evaluationLines(plan.evaluation),
    ...plan.paths.map(pathBlock(plan.batches)),
    ...scopedSteps(plan.batches),
    ...(plan.facts === undefined ? [] : [factsBlock(plan.facts)]),
    ...(plan.rules === undefined ? [] : [rulesBlock(plan.rules, true, "rope")]),
    ...(plan.localRules === undefined
      ? []
      : [localRulesBlock(plan.localRules)]),
    ...(context.tools.length === 0
      ? []
      : [["Tools", ...context.tools.map(toolLine)].join("\n")]),
    summary(plan),
  ].join("\n\n");
