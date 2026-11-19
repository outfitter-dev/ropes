import type {
  Plan,
  PlannedPath,
  PlanStep,
  PolicyValue,
  Provenance,
} from "../contracts/plan.ts";

/** Whether a tool the plan needs can run here. `explain` reports it. */
export interface ToolStatus {
  readonly tool: string;
  readonly versionRange: string;
  /** The installed version, when the tool reported one. */
  readonly version?: string | undefined;
  /** Why the tool cannot run. Absent when it can. */
  readonly problem?: string | undefined;
}

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

const stepLine = (step: PlanStep): string =>
  `    ${step.adapter}  ${step.tool} ${step.versionRange}  ${step.writes ? "checks and fixes" : "checks"}`;

const REASON = {
  excluded: "excluded",
  "not-included": "not included",
} satisfies Record<NonNullable<PlannedPath["skipped"]>["reason"], string>;

const pathBlock = (planned: PlannedPath): string => {
  if (planned.skipped) {
    const { reason, source } = planned.skipped;
    return `${planned.path}\n  left out: ${REASON[reason]} (${origin(source)})`;
  }
  return [
    planned.path,
    "  policy",
    ...planned.policy.map(policyLine),
    ...(planned.steps.length === 0
      ? ["  no step applies to this file"]
      : ["  steps", ...planned.steps.map(stepLine)]),
  ].join("\n");
};

const toolLine = (status: ToolStatus): string => {
  if (status.problem !== undefined) {
    return `  ${status.tool}  unavailable: ${status.problem}`;
  }
  const name = [status.tool, status.version].filter(Boolean).join(" ");
  return `  ${name}  available, needs ${status.versionRange}`;
};

const summary = (plan: Plan): string => {
  const steps = plan.paths.reduce((sum, entry) => sum + entry.steps.length, 0);
  const files = plan.paths.length;
  return files === 0
    ? "No files selected, so there is nothing to plan."
    : `${files} ${files === 1 ? "file" : "files"}, ${steps} ${steps === 1 ? "step" : "steps"} planned. Nothing was run.`;
};

/** The plan as text for a person. `check` and `fix` run exactly these steps. */
export const renderPlan = (plan: Plan, context: PlanContext): string =>
  [
    [
      `Root: ${plan.root}`,
      `Config: ${context.configFile ?? "none, so the defaults apply"}`,
    ].join("\n"),
    ...plan.paths.map(pathBlock),
    ...(context.tools.length === 0
      ? []
      : [["Tools", ...context.tools.map(toolLine)].join("\n")]),
    summary(plan),
  ].join("\n\n");
