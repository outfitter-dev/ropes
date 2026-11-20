import { expect, test } from "bun:test";

import type { Finding } from "../src/contracts/finding.ts";
import { parseResult } from "../src/contracts/parse.ts";
import type { PlannedPath } from "../src/contracts/plan.ts";
import { outcomeOf } from "../src/contracts/result.ts";
import type { Result, StepResult } from "../src/contracts/result.ts";
import { renderHuman } from "../src/render/human.ts";
import { renderJson } from "../src/render/json.ts";

const finding: Finding = {
  fixable: true,
  message: "Duplicate heading",
  path: "docs/a.md",
  range: { start: { column: 1, line: 14 } },
  rule: "MD024",
  severity: "error",
  source: "fake",
};

const planned = (path: string): PlannedPath => ({
  package: ".",
  path,
  policy: [],
  steps: [{ adapter: "fake", tool: "fake", versionRange: "*", writes: true }],
});

const resultOf = (
  steps: readonly StepResult[],
  paths: readonly PlannedPath[] = steps.map((step) => planned(step.path))
): Result => ({
  outcome: outcomeOf(steps),
  plan: {
    batches: [],
    paths,
    root: "/repo",
    schemaVersion: 1,
    selection: { kind: "workspace" },
  },
  schemaVersion: 1,
  steps,
});

const passed: StepResult = {
  adapter: "fake",
  findings: [],
  path: "README.md",
  status: "passed",
};
const withFinding: StepResult = {
  adapter: "fake",
  findings: [finding],
  path: "docs/a.md",
  status: "findings",
};
const missing: StepResult = {
  adapter: "fake",
  findings: [],
  path: "docs/b.md",
  reason: "fake is not installed",
  status: "incomplete",
};

test("a clean run says so and names exit code 0", () => {
  expect(renderHuman(resultOf([passed]))).toBe(
    "1 file selected, 1 step ran, 0 findings.\n\nClean. Exit code 0."
  );
});

test("a finding is shown under its file with position, rule and source", () => {
  const text = renderHuman(resultOf([passed, withFinding]));
  expect(text).toContain(
    "docs/a.md\n  14:1  error  MD024  Duplicate heading  [fake]  (fixable)"
  );
  expect(text).toContain("2 files selected, 2 steps ran, 1 finding.");
  expect(text).toEndWith("Findings remain. Exit code 1.");
  expect(text).not.toContain("README.md");
});

test("an incomplete step is named with its reason and is never a pass", () => {
  const text = renderHuman(resultOf([passed, missing]));
  expect(text).toContain(
    "docs/b.md\n  incomplete  fake: fake is not installed"
  );
  expect(text).toContain("1 step incomplete");
  expect(text).toEndWith("this is not a pass. Exit code 2.");
});

test("incomplete wins over findings in the verdict", () => {
  const text = renderHuman(resultOf([withFinding, missing]));
  expect(text).toContain("MD024");
  expect(text).toEndWith("Exit code 2.");
});

test("a fixed step is reported", () => {
  const text = renderHuman(resultOf([{ ...passed, status: "fixed" }]));
  expect(text).toContain("README.md\n  fixed  fake");
  expect(text).toContain("1 step fixed");
  expect(text).toEndWith("Clean. Exit code 0.");
});

test("an empty selection is clean and says nothing ran", () => {
  expect(renderHuman(resultOf([]))).toBe(
    "No files selected, so nothing ran.\n\nClean. Exit code 0."
  );
});

test("files the config leaves out are counted, and zero steps is visible", () => {
  const skipped: PlannedPath = {
    package: ".",
    path: "vendor/a.md",
    policy: [],
    skipped: { reason: "excluded", source: { kind: "default" } },
    steps: [],
  };
  expect(renderHuman(resultOf([], [skipped]))).toBe(
    "1 file selected, 0 steps ran, 0 findings, 1 file left out by config.\n\nClean. Exit code 0."
  );
});

test("the JSON form is the result itself and parses back unchanged", () => {
  const result = resultOf([passed, withFinding, missing]);
  const parsed: unknown = JSON.parse(renderJson(result));
  expect(parseResult(parsed)).toEqual({ ok: true, value: result });
});

test("a finding sits under the file it names, not the file its step ran on", () => {
  const elsewhere: Finding = { ...finding, path: "docs/b.md" };
  const step: StepResult = { ...withFinding, findings: [finding, elsewhere] };
  const text = renderHuman(resultOf([step]));
  expect(text).toContain(
    "docs/a.md\n  14:1  error  MD024  Duplicate heading  [fake]  (fixable)\n\ndocs/b.md\n  14:1"
  );
});
