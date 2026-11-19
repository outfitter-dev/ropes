import type { Finding } from "../contracts/finding.ts";
import { exitCodeOf, outcomeOf } from "../contracts/result.ts";
import type { Outcome, Result, StepResult } from "../contracts/result.ts";

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

const findingLine = (finding: Finding): string => {
  const { column, line } = finding.range.start;
  const fixable = finding.fixable ? "  (fixable)" : "";
  return `  ${line}:${column}  ${finding.severity}  ${finding.rule}  ${finding.message}  [${finding.source}]${fixable}`;
};

/** Step-level notices. They belong to the file the step ran on. */
const noticeLines = (step: StepResult): string[] => {
  if (step.status === "incomplete") {
    return [
      `  incomplete  ${step.adapter}: ${step.reason ?? "no reason given"}`,
    ];
  }
  return step.status === "fixed" ? [`  fixed  ${step.adapter}`] : [];
};

/**
 * One block per path that has something to say, in the order paths first
 * appear. A finding sits under the file it names, which is not always the
 * file its step ran on.
 */
const pathBlocks = (result: Result): string[] => {
  const byPath = new Map<string, string[]>();
  const add = (path: string, line: string) => {
    byPath.set(path, [...(byPath.get(path) ?? []), line]);
  };
  for (const step of result.steps) {
    for (const finding of step.findings) {
      add(finding.path, findingLine(finding));
    }
    for (const notice of noticeLines(step)) {
      add(step.path, notice);
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
  const verdict = VERDICT[outcomeOf(result.steps)];
  return [
    ...pathBlocks(result),
    summary(result),
    `${verdict} Exit code ${exitCodeOf(result)}.`,
  ].join("\n\n");
};
