import { expect, test } from "bun:test";

import type { Adapter } from "../src/adapters/adapter.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import type { CinchConfig } from "../src/contracts/config.ts";
import type { Fact, FactReport } from "../src/contracts/facts.ts";
import { PlanSchema } from "../src/contracts/plan.ts";
import {
  EXIT_CODE,
  ResultSchema,
  exitCodeOf,
} from "../src/contracts/result.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { setupOf } from "../src/policy/setup.ts";
import { renderHuman } from "../src/render/human.ts";
import { renderPlan } from "../src/render/plan.ts";
import { driftOf } from "../src/runner/facts.ts";
import { runPlan } from "../src/runner/run.ts";
import { fakeAdapter } from "./fake-adapter.ts";

const STATED: CinchConfig = {
  ...DEFAULT_CONFIG,
  editor: { indent_size: 2, line_width: 100, overrides: [] },
  file: "cinch.toml",
};

const planFor = (adapters: readonly Adapter[], config = STATED) =>
  resolvePlan({
    config,
    descriptors: adapters.map((adapter) => adapter.descriptor),
    packages: [],
    paths: ["a.md"],
    root: "/repo",
    selection: { kind: "workspace" },
  });

const width = (value: number, file = ".fake.toml"): Fact => ({
  file,
  key: "width",
  name: "line_width",
  value,
});

const reporter = (
  id: string,
  report: FactReport,
  reports: readonly string[] = ["line_width"]
) =>
  fakeAdapter({
    descriptor: { id, reports, tool: `${id}-tool` },
    facts: () => Promise.resolve(report),
  });

const check = { mode: "check", platform: "linux" } as const;

test("settings verification limits remain visible in normal check results", async () => {
  const adapter = reporter("one", {
    facts: [],
    limitations: ["The engine cannot expose resolved options"],
    ok: true,
  });
  const result = await runPlan(planFor([adapter]), [adapter], check);
  expect(result.notices).toEqual([
    "one-tool settings: The engine cannot expose resolved options",
  ]);
  expect(renderHuman(result)).toContain(
    "The engine cannot expose resolved options"
  );
  const serialized = JSON.stringify(result);
  expect(ResultSchema.parse(JSON.parse(serialized)).notices).toEqual(
    result.notices
  );
  expect(adapter.calls.filter((call) => call === "facts")).toHaveLength(1);
});

test("the plan names the stated facts and the adapters asked about them", () => {
  const plan = planFor([reporter("one", { facts: [], ok: true })]);
  expect(plan.facts).toEqual({
    reporters: [{ adapter: "one", reports: ["line_width"], tool: "one-tool" }],
    stated: [
      {
        file: "cinch.toml",
        key: "editor.indent_size",
        name: "indent_size",
        value: 2,
      },
      {
        file: "cinch.toml",
        key: "editor.line_width",
        name: "line_width",
        value: 100,
      },
    ],
  });
  expect(PlanSchema.safeParse(plan).success).toBe(true);
  expect(setupOf(plan).facts).toBeUndefined();
});

test("a plan with no adapter that has such settings compares nothing", () => {
  const plain = fakeAdapter();
  const plan = planFor([plain]);
  expect(plan.facts).toBeUndefined();
});

test("a value that differs from the config is one finding with both sources", async () => {
  const adapter = reporter("one", { facts: [width(120)], ok: true });
  const result = await runPlan(planFor([adapter]), [adapter], check);
  const findings = result.steps.flatMap((step) => step.findings);
  expect(findings).toEqual([
    {
      fixable: false,
      message:
        ".fake.toml sets `width` to 120, but cinch.toml sets `editor.line_width` to 100. Both state line_width, so they have to agree. Change one of them.",
      path: ".fake.toml",
      range: { start: { column: 1, line: 1 } },
      rule: "shared-fact/line_width",
      severity: "error",
      source: "one",
    },
  ]);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.findings);
  expect(ResultSchema.safeParse(result).success).toBe(true);
});

test("a value that agrees, or that no file sets, is no finding", async () => {
  const agrees = reporter("one", { facts: [width(100)], ok: true });
  const silent = reporter("two", { facts: [], ok: true });
  const result = await runPlan(
    planFor([agrees, silent]),
    [agrees, silent],
    check
  );
  expect(result.steps.map((step) => step.status)).toEqual(["passed", "passed"]);
  expect(agrees.calls).toContain("facts");
  expect(exitCodeOf(result)).toBe(EXIT_CODE.clean);
});

test("with nothing stated, the tools are held to each other", () => {
  const first = { adapter: "one", fact: width(80, "one.toml") };
  const second = { adapter: "two", fact: width(90, "two.toml") };
  const findings = driftOf([], [first, second]);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ path: "two.toml", source: "two" });
  expect(findings[0]?.message).toContain("one.toml sets `width` to 80");
  expect(
    driftOf([], [first, { ...second, fact: width(80, "two.toml") }])
  ).toEqual([]);
});

test("a fact the adapter was not asked for is not compared", async () => {
  const adapter = reporter(
    "one",
    { facts: [{ ...width(3), name: "indent_size" }], ok: true },
    ["line_width"]
  );
  const result = await runPlan(planFor([adapter]), [adapter], check);
  expect(exitCodeOf(result)).toBe(EXIT_CODE.clean);
});

test("a tool that could not say what it resolves leaves the run incomplete", async () => {
  const adapter = reporter("one", { ok: false, reason: "config is broken" });
  const result = await runPlan(planFor([adapter]), [adapter], check);
  expect(result.steps.at(-1)).toEqual({
    adapter: "one",
    findings: [],
    path: ".",
    reason:
      "could not read the settings one-tool resolves, so they were not compared: config is broken",
    status: "incomplete",
  });
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});

test("a tool that cannot run is not asked, since its steps already say so", async () => {
  const adapter = fakeAdapter({
    descriptor: { reports: ["line_width"] },
    facts: () => Promise.resolve({ facts: [width(1)], ok: true }),
    probe: () => Promise.resolve({ available: false, reason: "gone" }),
  });
  const result = await runPlan(planFor([adapter]), [adapter], check);
  expect(adapter.calls).not.toContain("facts");
  expect(result.steps).toHaveLength(1);
});

const at = (version: string | undefined, versionRange = "^2.0.0") =>
  fakeAdapter({
    descriptor: { reports: ["line_width"], versionRange },
    facts: () => Promise.resolve({ facts: [width(1)], ok: true }),
    probe: () =>
      Promise.resolve(
        version === undefined
          ? { available: true }
          : { available: true, version }
      ),
  });

test("a tool at a version the plan does not allow is not asked either", async () => {
  const [old, silent, fits] = [at("1.9.0"), at(undefined), at("2.1.0")];
  const [first, second, third] = await Promise.all(
    [old, silent, fits].map((adapter) =>
      runPlan(planFor([adapter]), [adapter], check)
    )
  );
  expect(old.calls).not.toContain("facts");
  expect(first?.steps).toHaveLength(1);
  expect(first?.steps[0]?.status).toBe("incomplete");
  expect(silent.calls).not.toContain("facts");
  expect(second?.steps).toHaveLength(1);
  expect(fits.calls).toContain("facts");
  expect(third?.steps.map((step) => step.status)).toEqual([
    "passed",
    "findings",
  ]);
});

test("the range that counts is the plan's, not the registered adapter's", async () => {
  const planned = at("2.0.0");
  const registered = at("1.9.0", "*");
  const result = await runPlan(planFor([planned]), [registered], check);
  expect(registered.calls).not.toContain("facts");
  expect(result.steps).toHaveLength(1);
});

test("a config nested in the shared file names its keys as that file has them", () => {
  const plan = planFor([reporter("one", { facts: [], ok: true })], {
    ...STATED,
    file: "outfitter.toml",
    prefix: "cinch.",
  });
  expect(plan.facts?.stated.map((fact) => `${fact.file}: ${fact.key}`)).toEqual(
    [
      "outfitter.toml: cinch.editor.indent_size",
      "outfitter.toml: cinch.editor.line_width",
    ]
  );
});

test("explain shows what is compared, and says when an adapter cannot report", () => {
  const can = reporter("one", { facts: [], ok: true });
  const cannot = fakeAdapter({
    descriptor: { id: "two", reports: [], tool: "two-tool" },
  });
  const shown = renderPlan(planFor([can, cannot]), {
    configFile: "cinch.toml",
    tools: [],
  });
  expect(shown).toContain(
    [
      "Shared facts",
      "  stated",
      "    indent_size = 2  (cinch.toml: editor.indent_size)",
      "    line_width = 100  (cinch.toml: editor.line_width)",
      "  compared with",
      "    one  reports line_width",
      "    two  cannot report what two-tool resolves, so its settings are not compared",
    ].join("\n")
  );
  const none = renderPlan(planFor([can], DEFAULT_CONFIG), {
    configFile: null,
    tools: [],
  });
  expect(none).toContain(
    "the Cinch config states none, so tools are compared with each other"
  );
});
