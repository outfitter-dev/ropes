import type { Finding } from "../contracts/finding.ts";
import { EXIT_CODE, outcomeOf } from "../contracts/result.ts";
import type { Outcome, Result, StepResult } from "../contracts/result.ts";

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

const findingLine = (finding: Finding): string => {
  const { column, line } = finding.range.start;
  const fixable = finding.fixable ? "  (fixable)" : "";
  return `  ${line}:${column}  ${finding.severity}  ${finding.rule}  ${finding.message}  [${finding.source}]${fixable}`;
};

const stepLines = (step: StepResult): string[] => {
  const lines = step.findings.map(findingLine);
  if (step.status === "incomplete") {
    lines.push(
      `  incomplete  ${step.adapter}: ${step.reason ?? "no reason given"}`
    );
  }
  if (step.status === "fixed") {
    lines.push(`  fixed  ${step.adapter}`);
  }
  return lines;
};

/** One block per path that has something to say, in plan order. */
const pathBlocks = (result: Result): string[] => {
  const byPath = new Map<string, string[]>();
  for (const step of result.steps) {
    const lines = stepLines(step);
    if (lines.length > 0) {
      byPath.set(step.path, [...(byPath.get(step.path) ?? []), ...lines]);
    }
  }
  return [...byPath].map(([path, lines]) => [path, ...lines].join("\n"));
};

const VERDICT: Readonly<Record<Outcome, string>> = {
  clean: "Clean.",
  findings: "Findings remain.",
  incomplete:
    "Incomplete: at least one step could not run, so this is not a pass.",
};

const summary = (result: Result): string => {
  const { paths } = result.plan;
  const ran = result.steps.length;
  if (paths.length === 0) {
    return "No files selected, so nothing ran.";
  }
  const skipped = paths.filter((path) => path.skipped !== undefined).length;
  const counts = [
    `${plural(paths.length, "file")} selected`,
    `${plural(ran, "step")} ran`,
    plural(
      result.steps.reduce((sum, step) => sum + step.findings.length, 0),
      "finding"
    ),
  ];
  const count = (status: StepResult["status"]) =>
    result.steps.filter((step) => step.status === status).length;
  if (count("fixed") > 0) {
    counts.push(`${plural(count("fixed"), "step")} fixed`);
  }
  if (count("incomplete") > 0) {
    counts.push(`${plural(count("incomplete"), "step")} incomplete`);
  }
  if (skipped > 0) {
    counts.push(`${plural(skipped, "file")} left out by config`);
  }
  return `${counts.join(", ")}.`;
};

/**
 * Text for a person. It takes a result and nothing else, and it derives the
 * verdict from the steps the same way the exit code does.
 */
export const renderHuman = (result: Result): string => {
  const outcome = outcomeOf(result.steps);
  return [
    ...pathBlocks(result),
    summary(result),
    `${VERDICT[outcome]} Exit code ${EXIT_CODE[outcome]}.`,
  ].join("\n\n");
};
