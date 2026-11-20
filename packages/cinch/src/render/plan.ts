import type { ToolStatus } from "../contracts/doctor.ts";
import type {
  Plan,
  PlanBatch,
  PlannedPath,
  PlanStep,
  PolicyValue,
  Provenance,
} from "../contracts/plan.ts";

export type { ToolStatus } from "../contracts/doctor.ts";

/** What `explain` knows beyond the plan itself. */
export interface PlanContext {
  /** Root-relative config file. Null when the defaults apply. */
  readonly configFile: string | null;
  readonly tools: readonly ToolStatus[];
}

const origin = (source: Provenance): string =>
  source.kind === "default" ? "default" : `${source.file}: ${source.key}`;

const policyLine = (setting: PolicyValue): string =>
  `    ${setting.key} = ${String(setting.value)}  (${origin(setting.source)})`;

/** How many other files the step's one start of the engine also covers. */
const company = (
  step: PlanStep,
  planned: PlannedPath,
  batches: readonly PlanBatch[]
): string => {
  const batch = batches.find(
    (candidate) =>
      candidate.adapter === step.adapter &&
      candidate.package === planned.package
  );
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
    `    ${step.adapter}  ${step.tool} ${step.versionRange}  ${doing(step)}${company(step, planned, batches)}`;

const LAYER = {
  generated: "generated from the Cinch config, and extends the preset",
  preset: "the preset this Cinch ships",
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
      ...(planned.steps.length === 0
        ? ["  no step applies to this file"]
        : ["  steps", ...planned.steps.map(stepLine(planned, batches))]),
    ].join("\n");
  };

export const toolLine = (status: ToolStatus): string => {
  if (status.problem !== undefined) {
    return `  ${status.tool}  unavailable: ${status.problem}`;
  }
  const name = [status.tool, status.version].filter(Boolean).join(" ");
  return `  ${name}  available, needs ${status.versionRange}`;
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
    ...plan.paths.map(pathBlock(plan.batches)),
    ...(context.tools.length === 0
      ? []
      : [["Tools", ...context.tools.map(toolLine)].join("\n")]),
    summary(plan),
  ].join("\n\n");
