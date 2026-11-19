import { expect, test } from "bun:test";

import type { Adapter, StepOutcome } from "../src/adapters/adapter.ts";
import { EXIT_CODE } from "../src/contracts/result.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { exitCodeOf, runPlan } from "../src/runner/run.ts";

const clean: StepOutcome = { findings: [], status: "passed" };
const dirty: StepOutcome = {
  findings: [
    {
      column: 1,
      fixable: true,
      line: 1,
      message: "bad",
      path: "a.md",
      rule: "fake/rule",
    },
  ],
  status: "findings",
};

const fake = (options: {
  available: boolean;
  outcome: StepOutcome;
}): Adapter => ({
  check: () => Promise.resolve(options.outcome),
  descriptor: {
    extensions: [".md"],
    id: "fake",
    tool: "fake-tool",
    versionRange: "*",
    writes: true,
  },
  fix: () => Promise.resolve({ findings: [], status: "fixed" }),
  probe: () =>
    Promise.resolve(
      options.available
        ? { available: true }
        : { available: false, reason: "fake-tool missing" }
    ),
});

const planFor = (adapter: Adapter) =>
  resolvePlan({
    descriptors: [adapter.descriptor],
    paths: ["a.md"],
    root: "/repo",
  });

test("a clean run exits 0", async () => {
  const adapter = fake({ available: true, outcome: clean });
  const result = await runPlan(planFor(adapter), [adapter], "check");
  expect(exitCodeOf(result)).toBe(EXIT_CODE.clean);
});

test("findings exit 1", async () => {
  const adapter = fake({ available: true, outcome: dirty });
  const result = await runPlan(planFor(adapter), [adapter], "check");
  expect(exitCodeOf(result)).toBe(EXIT_CODE.findings);
});

test("a missing tool is incomplete and can never pass", async () => {
  const adapter = fake({ available: false, outcome: clean });
  const result = await runPlan(planFor(adapter), [adapter], "check");
  expect(result.steps[0]?.status).toBe("incomplete");
  expect(result.steps[0]?.reason).toBe("fake-tool missing");
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});

test("a planned adapter that is not registered is incomplete", async () => {
  const adapter = fake({ available: true, outcome: clean });
  const result = await runPlan(planFor(adapter), [], "check");
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});

test("check never calls fix, and fix does", async () => {
  const adapter = fake({ available: true, outcome: clean });
  const checked = await runPlan(planFor(adapter), [adapter], "check");
  const fixed = await runPlan(planFor(adapter), [adapter], "fix");
  expect(checked.steps[0]?.status).toBe("passed");
  expect(fixed.steps[0]?.status).toBe("fixed");
});
