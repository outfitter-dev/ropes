import { expect, test } from "bun:test";

import type { Adapter, FileOutcome } from "../src/adapters/adapter.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { EXIT_CODE, exitCodeOf } from "../src/contracts/result.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { runPlan } from "../src/runner/run.ts";
import { FINDINGS, PASSED, fakeAdapter } from "./fake-adapter.ts";

const check = (outcomes: readonly FileOutcome[]) => {
  const adapter: Adapter = {
    ...fakeAdapter(),
    check: () => Promise.resolve([...outcomes]),
  };
  const plan = resolvePlan({
    config: DEFAULT_CONFIG,
    descriptors: [adapter.descriptor],
    packages: [],
    paths: ["a.md", "b.md"],
    root: "/repo",
    selection: { kind: "workspace" },
  });
  return runPlan(plan, [adapter], { mode: "check", platform: "linux" });
};

test("conflicting answers for a planned file stay incomplete in either order", async () => {
  const passed = { ...PASSED, path: "a.md" };
  const found = { ...FINDINGS, path: "a.md" };
  const neighbor = { ...PASSED, path: "b.md" };

  const results = await Promise.all([
    check([found, neighbor, passed]),
    check([passed, neighbor, found]),
  ]);
  for (const result of results) {
    expect(result.steps).toMatchObject([
      {
        findings: [],
        path: "a.md",
        reason: "fake-tool gave more than one answer for this file",
        status: "incomplete",
      },
      { path: "b.md", status: "passed" },
    ]);
    expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
  }
});

test("an answer for an unplanned path invalidates the batch and retains unique planned findings", async () => {
  const result = await check([
    { ...FINDINGS, path: "a.md" },
    { ...PASSED, path: "outside.md" },
    { ...PASSED, path: "b.md" },
  ]);

  expect(result.steps).toMatchObject([
    {
      findings: FINDINGS.findings,
      path: "a.md",
      reason: 'fake-tool gave an answer for unplanned file "outside.md"',
      status: "incomplete",
    },
    { findings: [], path: "b.md", status: "incomplete" },
  ]);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});

test("a complete batch passes and returns one answer per file in plan order", async () => {
  const result = await check([
    { ...PASSED, path: "b.md" },
    { ...PASSED, path: "a.md" },
  ]);
  expect(result.steps).toMatchObject([
    { path: "a.md", status: "passed" },
    { path: "b.md", status: "passed" },
  ]);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.clean);
});
