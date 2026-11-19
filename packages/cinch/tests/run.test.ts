import { expect, test } from "bun:test";

import type { Adapter } from "../src/adapters/adapter.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { EXIT_CODE, ResultSchema } from "../src/contracts/result.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { exitCodeOf, runPlan } from "../src/runner/run.ts";
import { FINDINGS, fakeAdapter } from "./fake-adapter.ts";

const planFor = (adapter: Adapter, paths: readonly string[] = ["a.md"]) =>
  resolvePlan({
    config: DEFAULT_CONFIG,
    descriptors: [adapter.descriptor],
    paths,
    root: "/repo",
    selection: { kind: "workspace" },
  });

const check = { mode: "check", platform: "linux" } as const;
const fix = { mode: "fix", platform: "linux" } as const;

test("a clean run exits 0 and is a valid result", async () => {
  const adapter = fakeAdapter();
  const result = await runPlan(planFor(adapter), [adapter], check);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.clean);
  expect(ResultSchema.safeParse(result).success).toBe(true);
});

test("findings exit 1", async () => {
  const adapter = fakeAdapter({ check: () => Promise.resolve(FINDINGS) });
  const result = await runPlan(planFor(adapter), [adapter], check);
  expect(result.steps[0]?.findings).toHaveLength(1);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.findings);
});

test("check never calls fix, and fix does", async () => {
  const adapter = fakeAdapter();
  const checked = await runPlan(planFor(adapter), [adapter], check);
  const fixed = await runPlan(planFor(adapter), [adapter], fix);
  expect(checked.steps[0]?.status).toBe("passed");
  expect(fixed.steps[0]?.status).toBe("fixed");
  expect(adapter.calls).toEqual(["probe", "check", "probe", "fix"]);
});

test("fix only checks with an adapter that does not write", async () => {
  const adapter = fakeAdapter({ descriptor: { writes: false } });
  await runPlan(planFor(adapter), [adapter], fix);
  expect(adapter.calls).toEqual(["probe", "check"]);
});

test("a missing tool is incomplete and can never pass", async () => {
  const adapter = fakeAdapter({
    probe: () =>
      Promise.resolve({ available: false, reason: "fake-tool missing" }),
  });
  const result = await runPlan(planFor(adapter), [adapter], check);
  expect(result.steps[0]?.status).toBe("incomplete");
  expect(result.steps[0]?.reason).toBe("fake-tool missing");
  expect(adapter.calls).toEqual(["probe"]);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});

test("a tool at the wrong version is incomplete", async () => {
  const adapter = fakeAdapter({
    descriptor: { versionRange: ">=2.0.0" },
    probe: () => Promise.resolve({ available: true, version: "1.9.0" }),
  });
  const result = await runPlan(planFor(adapter), [adapter], check);
  expect(result.steps[0]?.reason).toBe(
    "fake-tool 1.9.0 does not satisfy >=2.0.0"
  );
  expect(adapter.calls).toEqual(["probe"]);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});

test("a tool at an acceptable version runs", async () => {
  const adapter = fakeAdapter({
    descriptor: { versionRange: ">=2.0.0" },
    probe: () => Promise.resolve({ available: true, version: "2.1.0" }),
  });
  const result = await runPlan(planFor(adapter), [adapter], check);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.clean);
});

test("a required version that the tool does not report is incomplete", async () => {
  const adapter = fakeAdapter({ descriptor: { versionRange: ">=2.0.0" } });
  const result = await runPlan(planFor(adapter), [adapter], check);
  expect(result.steps[0]?.status).toBe("incomplete");
  expect(adapter.calls).toEqual(["probe"]);
});

test("an unsupported platform is incomplete and the tool is not probed", async () => {
  const adapter = fakeAdapter({ descriptor: { platforms: ["darwin"] } });
  const result = await runPlan(planFor(adapter), [adapter], check);
  expect(result.steps[0]?.reason).toBe("fake-tool does not run on linux");
  expect(adapter.calls).toEqual([]);
});

test("an adapter that throws is incomplete, and the run continues", async () => {
  const adapter = fakeAdapter({
    check: () => Promise.reject(new Error("boom")),
  });
  const plan = planFor(adapter, ["a.md", "b.md"]);
  const result = await runPlan(plan, [adapter], check);
  expect(result.steps.map((step) => step.status)).toEqual([
    "incomplete",
    "incomplete",
  ]);
  expect(result.steps[0]?.reason).toBe("fake-tool threw: boom");
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});

test("a probe that throws is incomplete", async () => {
  const adapter = fakeAdapter({
    probe: () => Promise.reject(new Error("no PATH")),
  });
  const result = await runPlan(planFor(adapter), [adapter], check);
  expect(result.steps[0]?.reason).toBe("probing fake-tool threw: no PATH");
});

test("a planned adapter that is not registered is incomplete", async () => {
  const adapter = fakeAdapter();
  const result = await runPlan(planFor(adapter), [], check);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});

test("an adapter is probed once per run, however many files it handles", async () => {
  const adapter = fakeAdapter();
  const plan = planFor(adapter, ["a.md", "b.md", "c.md"]);
  await runPlan(plan, [adapter], check);
  expect(adapter.calls).toEqual(["probe", "check", "check", "check"]);
});
