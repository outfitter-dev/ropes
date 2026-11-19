import { expect, test } from "bun:test";

import {
  EXIT_CODE,
  StepStatusSchema,
  exitCodeOf,
  outcomeOf,
} from "../src/contracts/result.ts";
import type {
  Outcome,
  StepResult,
  StepStatus,
} from "../src/contracts/result.ts";

const step = (status: StepStatus): StepResult => ({
  adapter: "fake",
  findings: [],
  path: "a.md",
  status,
});

const STATUSES = StepStatusSchema.options;

/** Every non-empty set of statuses: 15 combinations of the four. */
const combinations: StepStatus[][] = [];
for (let mask = 1; mask < 2 ** STATUSES.length; mask += 1) {
  combinations.push(
    STATUSES.filter((_status, index) => Math.floor(mask / 2 ** index) % 2 === 1)
  );
}

const expected = (set: readonly StepStatus[]): Outcome => {
  if (set.includes("incomplete")) {
    return "incomplete";
  }
  return set.includes("findings") ? "findings" : "clean";
};

test("there are four step statuses, so the table below is complete", () => {
  expect([...STATUSES].toSorted()).toEqual([
    "findings",
    "fixed",
    "incomplete",
    "passed",
  ]);
  expect(combinations).toHaveLength(15);
});

test.each(
  combinations.map((set): [string, StepStatus[]] => [set.join(" + "), set])
)("%s", (_name, set) => {
  const outcome = expected(set);
  for (const order of [set, set.toReversed()]) {
    const steps = order.map(step);
    expect(outcomeOf(steps)).toBe(outcome);
    expect(exitCodeOf({ steps })).toBe(EXIT_CODE[outcome]);
  }
});

test("the exit codes are 0 clean, 1 findings, 2 incomplete", () => {
  expect(EXIT_CODE).toEqual({ clean: 0, findings: 1, incomplete: 2 });
});

test("one missing tool with no findings exits 2, not 0", () => {
  expect(exitCodeOf({ steps: [step("passed"), step("incomplete")] })).toBe(2);
});

test("a run with no steps is clean", () => {
  expect(outcomeOf([])).toBe("clean");
  expect(exitCodeOf({ steps: [] })).toBe(0);
});

test("the exit code follows the steps, not a recorded outcome", () => {
  const forged = { outcome: "clean", steps: [step("incomplete")] };
  expect(exitCodeOf(forged)).toBe(2);
});
