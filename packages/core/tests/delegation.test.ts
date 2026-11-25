import { expect, test } from "bun:test";

import { parseConfigTable } from "../src/config/parse.ts";
import type { RopesConfig } from "../src/contracts/config.ts";
import { PlanSchema } from "../src/contracts/plan.ts";
import { ResultSchema } from "../src/contracts/result.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { renderHuman } from "../src/render/human.ts";
import { renderPlan } from "../src/render/plan.ts";
import { runPlan } from "../src/runner/run.ts";
import { describeFake, fakeAdapter } from "./fake-adapter.ts";
import { BASE, CONFIG, withRepo } from "./repo-bench.ts";

const config = (table: unknown): RopesConfig => {
  const parsed = parseConfigTable(table, { file: "rope.toml", prefix: "" });
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.error));
  }
  return parsed.value;
};

const delegated = config({
  delegates: { other: { domains: ["lint"], paths: ["src/**"] } },
  include: ["**/*.ts"],
  lint: { enabled: true },
  pilot: 0,
});

const descriptors = [
  describeFake({
    enabledBy: "lint.enabled",
    extensions: [".ts"],
    id: "linter",
  }),
  describeFake({
    enabledBy: "format.enabled",
    extensions: [".ts"],
    id: "formatter",
  }),
];
const planFor = (stated: RopesConfig, paths = ["src/a.ts", "other.ts"]) =>
  resolvePlan({
    config: stated,
    descriptors,
    packages: [],
    paths,
    root: "/repo",
    selection: { kind: "workspace" },
  });

test("delegation removes only the domain and paths handed over", () => {
  const plan = planFor(delegated);
  expect(
    plan.paths
      .find((entry) => entry.path === "src/a.ts")
      ?.steps.map((step) => step.adapter)
  ).toEqual(["formatter"]);
  expect(
    plan.paths
      .find((entry) => entry.path === "other.ts")
      ?.steps.map((step) => step.adapter)
  ).toEqual(["linter", "formatter"]);
  expect(
    plan.paths.find((entry) => entry.path === "src/a.ts")?.delegated
  ).toEqual([
    {
      domains: ["lint"],
      source: { file: "rope.toml", key: "delegates.other", kind: "file" },
      tool: "other",
    },
  ]);
  expect(PlanSchema.safeParse(plan).success).toBe(true);
});

test("a paths-only table delegates all domains, including a type absent from include", () => {
  const plan = planFor(
    config({
      delegates: { actionlint: { paths: [".github/workflows/**"] } },
      pilot: 0,
    }),
    [".github/workflows/check.yml"]
  );
  expect(plan.paths[0]?.skipped).toBeUndefined();
  expect(plan.paths[0]?.steps).toEqual([]);
  expect(plan.paths[0]?.delegated?.[0]?.domains).toContain("format");
  const text = renderPlan(plan, { configFile: "rope.toml", tools: [] });
  expect(text).toContain("delegated to actionlint, not run by Ropes");
  expect(text).toContain("rope.toml: delegates.actionlint");
});

test("a formatter's content domain and format domain both respect delegation", () => {
  const rumdl = describeFake({ formats: true });
  const plan = resolvePlan({
    config: config({
      delegates: { other: { domains: ["format"], paths: ["**/*.md"] } },
      pilot: 0,
    }),
    descriptors: [rumdl],
    packages: [],
    paths: ["a.md"],
    root: "/repo",
    selection: { kind: "workspace" },
  });
  expect(plan.batches).toEqual([]);
});

test("human and versioned results retain external ownership without a passed step", async () => {
  await withRepo(
    {
      ...BASE,
      "rope.toml": `${CONFIG}\n[delegates.other]\npaths = ["a.md"]\n`,
    },
    {},
    async ({ adapter, run }) => {
      const checked = await run("check", ["a.md"], { json: true });
      const result = ResultSchema.parse(JSON.parse(checked.output ?? ""));
      expect(result.steps).toEqual([]);
      expect(adapter.calls).not.toContain("check");
      expect(result.plan.paths[0]?.delegated?.[0]?.tool).toBe("other");
      expect(renderHuman(result)).toContain(
        "1 selected path delegated to external tools"
      );
      expect(renderHuman(result)).toContain(
        "delegated to other, not run by Ropes"
      );
    }
  );
});

for (const bad of [
  { nope: true, paths: ["src/**"] },
  { domains: ["build"], paths: ["src/**"] },
  { domains: [], paths: ["src/**"] },
  { paths: [] },
  { config: ["../outside.json"], paths: ["src/**"] },
  { config: ["configs/*.json"], paths: ["src/**"] },
  { config: ["/outside.json"], paths: ["src/**"] },
  { config: ["configs/./file.json"], paths: ["src/**"] },
]) {
  test(`reject invalid delegation ${JSON.stringify(bad)}`, () => {
    expect(
      parseConfigTable(
        { delegates: { other: bad }, pilot: 0 },
        { file: "rope.toml", prefix: "" }
      ).ok
    ).toBe(false);
  });
}

test("an enabled override conflicts with delegation even outside a partial selection", async () => {
  const text = `${CONFIG}\n[delegates.other]\ndomains = ["markdown"]\npaths = ["docs/**"]\n[[overrides]]\npaths = ["docs/**"]\n[overrides.markdown]\nenabled = true\n`;
  await withRepo({ ...BASE, "rope.toml": text }, {}, async ({ run }) => {
    const checked = await run("check", ["a.md"]);
    expect(checked.exitCode).toBe(2);
    expect(checked.error).toContain("overrides.0.markdown.enabled");
    expect(checked.error).toContain("docs/b.md");
    expect(checked.error).toContain("delegates.other");
  });
});

test("delegated read-only settings are compared without running the content engine", async () => {
  const adapter = fakeAdapter({
    descriptor: { reports: ["line_width"], tool: "other" },
    facts: () =>
      Promise.resolve({
        facts: [
          { file: ".other.toml", key: "width", name: "line_width", value: 80 },
        ],
        ok: true,
      }),
  });
  const plan = resolvePlan({
    config: config({
      delegates: { other: { paths: ["a.md"] } },
      editor: { line_width: 100 },
      pilot: 0,
    }),
    descriptors: [adapter.descriptor],
    packages: [],
    paths: ["a.md"],
    root: "/repo",
    selection: { kind: "workspace" },
  });
  expect(plan.batches).toEqual([]);
  expect(plan.facts?.reporters[0]?.paths).toEqual(["a.md"]);
  const result = await runPlan(plan, [adapter], { mode: "fix" });
  expect(adapter.calls).toEqual(["probe", "facts"]);
  expect(result.steps.map((step) => step.status)).toEqual(["findings"]);
  expect(result.steps[0]?.findings[0]?.rule).toBe("shared-fact/line_width");
});

test("delegation keeps an omitted path visible without activating sibling domains", () => {
  const stated = config({
    delegates: { other: { domains: ["lint"], paths: ["src/**"] } },
    pilot: 0,
  });
  const plan = planFor(stated, ["src/a.ts"]);
  expect(plan.paths[0]?.delegated?.[0]?.tool).toBe("other");
  expect(plan.paths[0]?.steps).toEqual([]);
});
