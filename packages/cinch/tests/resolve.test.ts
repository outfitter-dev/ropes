import { expect, test } from "bun:test";

import type { CinchConfig } from "../src/contracts/config.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { parsePlan } from "../src/contracts/parse.ts";
import type { PolicyValue, Provenance } from "../src/contracts/plan.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import type { ResolveInput } from "../src/policy/resolve.ts";
import { describeFake } from "./fake-adapter.ts";

const markdown = describeFake({ id: "fake-markdown", tool: "fake" });
const fence = describeFake({
  enabledBy: "markdown.fences",
  id: "fake-fence",
  tool: "fake",
});

const file = (key: string): Provenance => ({
  file: "cinch.toml",
  key,
  kind: "file",
});
const enabled = (value: boolean, key: string): PolicyValue => ({
  key: "markdown.enabled",
  source: file(key),
  value,
});

const config: CinchConfig = {
  exclude: { source: file("exclude"), value: ["vendor/**"] },
  file: "cinch.toml",
  include: { source: file("include"), value: ["**/*.md"] },
  overrides: [
    {
      paths: ["docs/**"],
      settings: [enabled(false, "overrides.0.markdown.enabled")],
    },
    {
      paths: ["docs/keep/**"],
      settings: [enabled(true, "overrides.1.markdown.enabled")],
    },
  ],
  settings: [enabled(true, "markdown.enabled")],
};

const resolve = (
  paths: readonly string[],
  overrides: Partial<ResolveInput> = {}
) =>
  resolvePlan({
    config,
    descriptors: [markdown, fence],
    paths,
    root: "/repo",
    selection: { kind: "workspace" },
    ...overrides,
  });

const only = (path: string, overrides: Partial<ResolveInput> = {}) => {
  const [planned] = resolve([path], overrides).paths;
  if (!planned) {
    throw new Error(`no plan for ${path}`);
  }
  return planned;
};

const adaptersOf = (path: string, overrides: Partial<ResolveInput> = {}) =>
  only(path, overrides).steps.map((step) => step.adapter);

test("with no config file the default policy applies and names its origin", () => {
  const planned = only("README.md", { config: DEFAULT_CONFIG });
  expect(planned.policy).toEqual([
    { key: "markdown.enabled", source: { kind: "default" }, value: true },
    { key: "toml.enabled", source: { kind: "default" }, value: true },
  ]);
  expect(planned.steps.map((step) => step.adapter)).toEqual([
    "fake-markdown",
    "fake-fence",
  ]);
});

test("a path no override matches gets the base settings", () => {
  expect(only("README.md").policy).toEqual([enabled(true, "markdown.enabled")]);
});

test("one matching override replaces the base value and is named", () => {
  const planned = only("docs/guide.md");
  expect(planned.policy).toEqual([
    enabled(false, "overrides.0.markdown.enabled"),
  ]);
  expect(planned.skipped).toBeUndefined();
});

test("a setting switched off removes only the adapter it switches", () => {
  expect(adaptersOf("docs/guide.md")).toEqual(["fake-fence"]);
});

test("when nested overrides both match, the later one in the file wins", () => {
  const planned = only("docs/keep/a.md");
  expect(planned.policy).toEqual([
    enabled(true, "overrides.1.markdown.enabled"),
  ]);
  expect(planned.steps).toHaveLength(2);
});

test("an override keeps base settings it does not mention", () => {
  const other: PolicyValue = {
    key: "markdown.fences",
    source: file("markdown.fences"),
    value: false,
  };
  const planned = only("docs/guide.md", {
    config: { ...config, settings: [...config.settings, other] },
  });
  expect(planned.policy).toEqual([
    enabled(false, "overrides.0.markdown.enabled"),
    other,
  ]);
  expect(planned.steps).toEqual([]);
});

test("an excluded path stays in the plan with the setting that excluded it", () => {
  expect(only("vendor/lib/README.md")).toEqual({
    path: "vendor/lib/README.md",
    policy: [],
    skipped: { reason: "excluded", source: file("exclude") },
    steps: [],
  });
});

test("a path outside include stays in the plan and is marked", () => {
  expect(only("src/a.ts")).toEqual({
    path: "src/a.ts",
    policy: [],
    skipped: { reason: "not-included", source: file("include") },
    steps: [],
  });
});

test("exclude wins over include", () => {
  expect(only("vendor/a.md").skipped?.reason).toBe("excluded");
});

test("an empty selection gives a plan with no paths", () => {
  const plan = resolve([], { selection: { kind: "paths", paths: [] } });
  expect(plan.paths).toEqual([]);
  expect(plan.selection).toEqual({ kind: "paths", paths: [] });
});

test("an included path no adapter handles has policy and no steps", () => {
  const planned = only("README.md", { descriptors: [] });
  expect(planned.policy).toHaveLength(1);
  expect(planned.steps).toEqual([]);
});

test("an adapter that works on a package or a workspace gets no file step", () => {
  const descriptors = [
    describeFake({ id: "whole-package", unit: "package" }),
    describeFake({ id: "whole-workspace", unit: "workspace" }),
    markdown,
  ];
  expect(adaptersOf("README.md", { descriptors })).toEqual(["fake-markdown"]);
});

test("steps follow the order the adapters were given in", () => {
  expect(adaptersOf("README.md", { descriptors: [fence, markdown] })).toEqual([
    "fake-fence",
    "fake-markdown",
  ]);
});

test("the plan does not depend on the order or repetition of its paths", () => {
  const paths = ["docs/keep/a.md", "README.md", "vendor/a.md", "src/a.ts"];
  const shuffled = ["src/a.ts", "vendor/a.md", "README.md", "docs/keep/a.md"];
  const plan = resolve(paths);
  expect(resolve([...shuffled, "README.md"])).toEqual(plan);
  expect(plan.paths.map((planned) => planned.path)).toEqual(paths.toSorted());
});

test("every plan the resolver makes passes the plan contract", () => {
  const plan = resolve(["docs/guide.md", "vendor/a.md", "src/a.ts"]);
  expect(parsePlan(structuredClone(plan))).toEqual({ ok: true, value: plan });
});

const keeper = describeFake({
  enabledBy: "markdown.preset",
  extensions: [],
  id: "fake-keeper",
  owns: [".tool.toml"],
});

test("a file an adapter keeps is planned without an include entry", () => {
  const kept = only(".tool.toml", { descriptors: [markdown, keeper] });
  expect(kept.skipped).toBeUndefined();
  expect(kept.steps.map((step) => step.adapter)).toEqual(["fake-keeper"]);
  const other = only("other.toml", { descriptors: [markdown, keeper] });
  expect(other.skipped?.reason).toBe("not-included");
});

test("a kept file is still left out when excluded or switched off", () => {
  const off: PolicyValue = {
    key: "markdown.preset",
    source: file("markdown.preset"),
    value: false,
  };
  const descriptors = [markdown, keeper];
  const switched = only(".tool.toml", {
    config: { ...config, settings: [...config.settings, off] },
    descriptors,
  });
  expect(switched.skipped?.reason).toBe("not-included");
  const excluded = only(".tool.toml", {
    config: {
      ...config,
      exclude: { source: file("exclude"), value: [".tool.toml"] },
    },
    descriptors,
  });
  expect(excluded.skipped?.reason).toBe("excluded");
});
