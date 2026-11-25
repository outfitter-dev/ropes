import { expect, test } from "bun:test";

import { runDoctor } from "../src/commands/doctor.ts";
import { toolStatuses } from "../src/commands/tools.ts";
import { parseConfigTable } from "../src/config/parse.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { runPlan } from "../src/runner/run.ts";
import { fakeAdapter } from "./fake-adapter.ts";
import { BASE, withRepo } from "./repo-bench.ts";

const POLICY = 'pilot = 0\n[delegates.other]\npaths = ["**/*.md"]\n';
const stated = parseConfigTable(Bun.TOML.parse(POLICY), {
  file: "rope.toml",
  prefix: "",
});
if (!stated.ok) {
  throw new Error("fixture config is invalid");
}
const config = stated.value;

const reporter = () =>
  fakeAdapter({
    descriptor: {
      reports: ["line_width"],
      tested: ">=1.0.0 <2.0.0",
      tool: "other",
      versionRange: "1.0.0",
    },
    facts: () => Promise.resolve({ facts: [], ok: true }),
    probe: () => Promise.resolve({ available: true, version: "1.1.0" }),
  });

test("strict delegated fact comparisons keep the plan's support range during probing and execution", async () => {
  const adapter = reporter();
  const { tested: _tested, ...strict } = adapter.descriptor;
  const plan = resolvePlan({
    config,
    descriptors: [strict],
    packages: [],
    paths: ["a.md"],
    root: "/repo",
    selection: { kind: "paths", paths: ["a.md"] },
  });
  const statuses = await toolStatuses(plan, [adapter]);
  expect(statuses[0]?.problem).toContain("1.0.0");
  const result = await runPlan(plan, [adapter], { mode: "check" });
  expect(result.outcome).toBe("incomplete");
  expect(adapter.calls).not.toContain("facts");
  expect(result.steps.every((step) => step.status === "incomplete")).toBe(true);
});

test("doctor compares delegated settings without creating content coverage", async () => {
  await withRepo({ ...BASE, "rope.toml": POLICY }, {}, async ({ root }) => {
    const adapter = reporter();
    const result = await runDoctor(
      { cwd: root, paths: [] },
      { adapters: () => [adapter] }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.settings?.observations[0]?.adapter).toBe("fake");
      expect(result.value.result.steps).toEqual([]);
    }
    expect(adapter.calls).toContain("facts");
    expect(adapter.calls).not.toContain("check");
    expect(adapter.calls).not.toContain("fix");
  });
});
