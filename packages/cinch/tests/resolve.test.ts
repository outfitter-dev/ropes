import { expect, test } from "bun:test";

import type { AdapterDescriptor } from "../src/adapters/adapter.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import type { ResolveInput } from "../src/policy/resolve.ts";

const markdown: AdapterDescriptor = {
  extensions: [".md"],
  id: "fake-markdown",
  tool: "fake",
  versionRange: "*",
  writes: true,
};

test("a path gets the steps of the adapters that handle its extension", () => {
  const plan = resolvePlan({
    descriptors: [markdown],
    paths: ["src/a.ts", "README.md"],
    root: "/repo",
    selection: { kind: "workspace" },
  });
  expect(plan.paths.map((planned) => planned.path)).toEqual([
    "README.md",
    "src/a.ts",
  ]);
  expect(plan.paths[0]?.steps.map((step) => step.adapter)).toEqual([
    "fake-markdown",
  ]);
  expect(plan.paths[1]?.steps).toEqual([]);
});

test("the same input gives the same plan", () => {
  const input: ResolveInput = {
    descriptors: [markdown],
    paths: ["b.md", "a.md"],
    root: "/repo",
    selection: { kind: "workspace" },
  };
  expect(resolvePlan(input)).toEqual(resolvePlan(input));
});
