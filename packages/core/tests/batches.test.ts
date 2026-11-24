import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { StepOutcome } from "../src/adapters/adapter.ts";
import type { FileInput } from "../src/adapters/batch.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import type { ResolveInput } from "../src/policy/resolve.ts";
import { runPlan } from "../src/runner/run.ts";
import { describeFake, fakeAdapter, FIXED } from "./fake-adapter.ts";

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

const setupKeeper = describeFake({
  enabledBy: "markdown.preset",
  extensions: [],
  id: "fake-setup",
  layers: { ".tool/preset.md": "preset", "tool.md": "root" },
  owns: [".tool/preset.md", "tool.md"],
  setup: true,
});

test("another adapter reads a file Ropes writes whole, and never writes it", () => {
  const plan = resolve([".tool/preset.md", "a.md", "tool.md"], {
    descriptors: [markdown, setupKeeper],
  });
  const writes = (file: string) =>
    plan.paths
      .find((entry) => entry.path === file)
      ?.steps.map((step) => [step.adapter, step.writes]);
  expect(writes(".tool/preset.md")).toEqual([
    ["fake-setup", true],
    ["fake-markdown", false],
  ]);
  // A root config is a person's file, and an ordinary file is too.
  expect(writes("tool.md")).toEqual([
    ["fake-setup", true],
    ["fake-markdown", true],
  ]);
  expect(writes("a.md")).toEqual([["fake-markdown", true]]);
  expect(
    plan.batches.map((batch) => [batch.adapter, batch.writes, batch.paths])
  ).toEqual([
    ["fake-setup", true, [".tool/preset.md", "tool.md"]],
    ["fake-markdown", true, ["tool.md", "a.md"]],
    ["fake-markdown", false, [".tool/preset.md"]],
  ]);
});

const rewrite = async (input: FileInput): Promise<StepOutcome> => {
  await Bun.write(path.join(input.root, input.path), "DONE\n");
  return FIXED;
};

test("a fix leaves a file Ropes writes whole as it was, byte for byte", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-kept-"));
  try {
    const files = { ".tool/preset.md": "TODO\n", "a.md": "TODO\n" };
    await Promise.all(
      Object.entries(files).map(([name, text]) =>
        Bun.write(path.join(root, name), text)
      )
    );
    const lint = fakeAdapter({ descriptor: markdown, fix: rewrite });
    const keep = fakeAdapter({ descriptor: setupKeeper });
    const plan = resolve(Object.keys(files), {
      descriptors: [markdown, setupKeeper],
      root,
    });
    await runPlan(plan, [lint, keep], { mode: "fix" });
    const text = (name: string) => Bun.file(path.join(root, name)).text();
    expect(await text(".tool/preset.md")).toBe("TODO\n");
    expect(await text("a.md")).toBe("DONE\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
