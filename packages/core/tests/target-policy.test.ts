import { expect, test } from "bun:test";

import { compilerApiAdapter } from "../src/adapters/bun-check/compatibility.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { targetDecision } from "../src/policy/targets.ts";
import { runPlan } from "../src/runner/run.ts";
import { fakeAdapter } from "./fake-adapter.ts";

const { descriptor } = compilerApiAdapter(undefined, "tsconfig.json");

const decision = (range: string) =>
  targetDecision(descriptor, "pkg", [
    {
      dependency: "typescript",
      package: "pkg",
      range,
      source: {
        file: "pkg/package.json",
        key: "peerDependencies.typescript",
      },
      state: "declared",
    },
  ]);

test("support ranges must establish a single side of the declared threshold", () => {
  expect(decision("4.9.5")?.decision).toBe("inapplicable");
  expect(decision("^4.9.0")?.decision).toBe("inapplicable");
  expect(decision("5.0.0")?.decision).toBe("applicable");
  expect(decision("^5.0.0")?.decision).toBe("applicable");
  expect(decision("^4.9.0 || ^5.0.0")?.decision).toBe("unresolved");
  expect(decision("*")?.decision).toBe("unresolved");
  expect(decision(">=6.0.0 <5.0.0")?.decision).toBe("unresolved");
  expect(decision("workspace:*")?.decision).toBe("unresolved");
  expect(decision("5.0.0-beta.1")?.decision).toBe("unresolved");
});

test("a missing required target never probes a tool or announces that it ran", async () => {
  const adapter = fakeAdapter({
    descriptor: {
      target: { atLeast: "5.0.0", dependency: "example" },
      tested: "^1.0.0",
      versionRange: "1.0.0",
    },
    probe: () => Promise.resolve({ available: true, version: "1.1.0" }),
  });
  const plan = resolvePlan({
    config: DEFAULT_CONFIG,
    descriptors: [adapter.descriptor],
    packages: [],
    paths: ["a.md"],
    root: "/repo",
    selection: { kind: "workspace" },
  });
  const result = await runPlan(plan, [adapter], { mode: "check" });
  expect(result.outcome).toBe("incomplete");
  expect(result.steps[0]?.reason).toContain(
    "required package target was not collected"
  );
  expect(result.notices).toBeUndefined();
  expect(adapter.calls).toEqual([]);
});
