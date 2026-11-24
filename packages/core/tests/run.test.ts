import { expect, test } from "bun:test";

import type { Adapter } from "../src/adapters/adapter.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import {
  EXIT_CODE,
  ResultSchema,
  exitCodeOf,
} from "../src/contracts/result.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { runPlan } from "../src/runner/run.ts";
import type { RunOptions } from "../src/runner/run.ts";
import { FINDINGS, fakeAdapter } from "./fake-adapter.ts";

const planFor = (
  adapter: Adapter,
  paths: readonly string[] = ["a.md"],
  packages: readonly string[] = []
) =>
  resolvePlan({
    config: DEFAULT_CONFIG,
    descriptors: [adapter.descriptor],
    packages,
    paths,
    root: "/repo",
    selection: { kind: "workspace" },
  });

const check: RunOptions = { mode: "check", platform: "linux" };
const fix: RunOptions = { mode: "fix", platform: "linux" };

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

test("fix only checks the Cinch setup, and doctor writes nothing else", async () => {
  const setup = fakeAdapter({ descriptor: { setup: true } });
  await runPlan(planFor(setup), [setup], fix);
  await runPlan(planFor(setup), [setup], { ...fix, mode: "doctor" });
  expect(setup.calls).toEqual(["probe", "check", "probe", "fix"]);
  const own = fakeAdapter();
  await runPlan(planFor(own), [own], { ...fix, mode: "doctor" });
  expect(own.calls).toEqual(["probe", "check"]);
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

test("an adapter is probed once and started once, however many files it handles", async () => {
  const adapter = fakeAdapter();
  const plan = planFor(adapter, ["a.md", "b.md", "c.md"]);
  const result = await runPlan(plan, [adapter], check);
  expect(adapter.calls).toEqual(["probe", "check"]);
  expect(adapter.batches).toEqual([
    { package: ".", paths: ["a.md", "b.md", "c.md"], root: "/repo" },
  ]);
  expect(result.steps.map((step) => step.path)).toEqual([
    "a.md",
    "b.md",
    "c.md",
  ]);
});

test("a run holds the tool to the range in the plan, not the registry", async () => {
  const planned = fakeAdapter({ descriptor: { versionRange: ">=2.0.0" } });
  const registered = fakeAdapter({
    probe: () => Promise.resolve({ available: true, version: "1.0.0" }),
  });
  const result = await runPlan(planFor(planned), [registered], check);
  expect(result.steps[0]?.reason).toBe(
    "fake-tool 1.0.0 does not satisfy >=2.0.0"
  );
  expect(registered.calls).toEqual(["probe"]);
});

test("each package is one start, and the steps come back in plan order", async () => {
  const adapter = fakeAdapter();
  const plan = planFor(
    adapter,
    ["z.md", "packages/a/x.md", "packages/a/y.md", "packages/b/x.md"],
    ["packages/a", "packages/b"]
  );
  const result = await runPlan(plan, [adapter], check);
  expect(adapter.batches.map((batch) => [batch.package, batch.paths])).toEqual([
    [".", ["z.md"]],
    ["packages/a", ["packages/a/x.md", "packages/a/y.md"]],
    ["packages/b", ["packages/b/x.md"]],
  ]);
  expect(result.steps.map((step) => step.path)).toEqual(
    plan.paths.map((planned) => planned.path)
  );
});

test("a step that cannot run leaves every file of its batch incomplete", async () => {
  const missing = fakeAdapter({
    probe: () => Promise.resolve({ available: false, reason: "not here" }),
  });
  const plan = planFor(missing, ["a.md", "b.md"]);
  const result = await runPlan(plan, [missing], check);
  expect(result.steps.map((step) => [step.path, step.status])).toEqual([
    ["a.md", "incomplete"],
    ["b.md", "incomplete"],
  ]);
  expect(missing.calls).toEqual(["probe"]);
});

test("a file the adapter gave no answer for is incomplete, never passed", async () => {
  const quiet: Adapter = {
    ...fakeAdapter(),
    check: (input) =>
      Promise.resolve(
        input.paths
          .slice(0, 1)
          .map((path) => ({ findings: [], path, status: "passed" }))
      ),
  };
  const result = await runPlan(
    planFor(quiet, ["a.md", "b.md"]),
    [quiet],
    check
  );
  expect(result.steps).toMatchObject([
    { path: "a.md", status: "passed" },
    {
      path: "b.md",
      reason: "fake-tool gave no answer for this file",
      status: "incomplete",
    },
  ]);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});
