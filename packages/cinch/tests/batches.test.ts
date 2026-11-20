import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import type { ResolveInput } from "../src/policy/resolve.ts";
import { describeFake } from "./fake-adapter.ts";

const markdown = describeFake({ id: "fake-markdown", tool: "fake" });
const fence = describeFake({
  enabledBy: "markdown.fences",
  id: "fake-fence",
  tool: "fake",
});
const keeper = describeFake({
  enabledBy: "markdown.preset",
  extensions: [],
  id: "fake-keeper",
  owns: [".tool.toml"],
});

const resolve = (
  paths: readonly string[],
  overrides: Partial<ResolveInput> = {}
) =>
  resolvePlan({
    config: DEFAULT_CONFIG,
    descriptors: [markdown, fence],
    packages: [],
    paths,
    root: "/repo",
    selection: { kind: "workspace" },
    ...overrides,
  });

test("a file belongs to the nearest package above it, else the workspace", () => {
  const plan = resolve(
    [
      "README.md",
      "packages/a/README.md",
      "packages/a/sub/pkg/x.md",
      "packagesx.md",
    ],
    { packages: ["packages/a", "packages/a/sub/pkg"] }
  );
  expect(plan.paths.map((planned) => [planned.path, planned.package])).toEqual([
    ["README.md", "."],
    ["packages/a/README.md", "packages/a"],
    ["packages/a/sub/pkg/x.md", "packages/a/sub/pkg"],
    ["packagesx.md", "."],
  ]);
});

test("the batches hold every step once, one for each adapter and package", () => {
  const plan = resolve(["a.md", "packages/a/b.md", "packages/a/c.md", "x.ts"], {
    packages: ["packages/a"],
  });
  expect(
    plan.batches.map((batch) => [batch.adapter, batch.package, batch.paths])
  ).toEqual([
    ["fake-markdown", ".", ["a.md"]],
    ["fake-markdown", "packages/a", ["packages/a/b.md", "packages/a/c.md"]],
    ["fake-fence", ".", ["a.md"]],
    ["fake-fence", "packages/a", ["packages/a/b.md", "packages/a/c.md"]],
  ]);
  const steps = plan.paths.reduce((sum, entry) => sum + entry.steps.length, 0);
  const batched = plan.batches.reduce(
    (sum, batch) => sum + batch.paths.length,
    0
  );
  expect(batched).toBe(steps);
});

test("an adapter that keeps files is batched before the ones that read them", () => {
  const plan = resolve([".tool.toml", "a.md"], {
    descriptors: [markdown, keeper],
  });
  expect(plan.batches.map((batch) => batch.adapter)).toEqual([
    "fake-keeper",
    "fake-markdown",
  ]);
});

test("a file's steps are listed in the order its batches run", () => {
  const tomlLint = describeFake({
    enabledBy: "toml.enabled",
    extensions: [".toml"],
    id: "fake-toml",
  });
  const plan = resolve([".tool.toml"], { descriptors: [tomlLint, keeper] });
  const order = ["fake-keeper", "fake-toml"];
  expect(plan.paths[0]?.steps.map((step) => step.adapter)).toEqual(order);
  expect(plan.batches.map((batch) => batch.adapter)).toEqual(order);
});
