import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { parsePlan } from "../src/contracts/parse.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { renderPlan } from "../src/render/plan.ts";
import { runPlan } from "../src/runner/run.ts";
import { describeFake, fakeAdapter, FINDINGS, PASSED } from "./fake-adapter.ts";

const rootFile = "README.md";
const lastFile = "packages/b/c.md";
const selected = [rootFile, "packages/a/a.md", "packages/a/b.md", lastFile];
const workspace = describeFake({ id: "workspace-check", unit: "workspace" });
const packageCheck = describeFake({ id: "package-check", unit: "package" });
const resolve = (descriptors = [packageCheck, workspace]) =>
  resolvePlan({
    config: DEFAULT_CONFIG,
    descriptors,
    packages: ["packages/a", "packages/b"],
    paths: selected,
    present: [...selected, "packages/b/omitted.md"],
    root: "/repo",
    selection: { kind: "paths", paths: selected },
  });

test("a package engine starts per selected package and a workspace engine starts once", async () => {
  const scoped = [packageCheck, workspace].map((descriptor) =>
    fakeAdapter({ descriptor })
  );
  const plan = resolve();
  expect(parsePlan(plan)).toEqual({ ok: true, value: plan });
  expect(
    plan.batches.map(({ unit, package: directory, paths }) => [
      unit,
      directory,
      paths,
    ])
  ).toEqual([
    ["package", ".", [rootFile]],
    ["package", "packages/a", selected.slice(1, 3)],
    ["package", "packages/b", [lastFile]],
    ["workspace", ".", selected],
  ]);
  const explained = renderPlan(plan, { configFile: null, tools: [] });
  expect(explained).toContain(
    "Package packages/a step for package-check covers\n  packages/a/a.md\n  packages/a/b.md"
  );
  expect(explained).toContain(
    `Workspace step for workspace-check covers\n  ${selected.join("\n  ")}`
  );
  expect(explained).not.toContain("omitted.md");

  const result = await runPlan(plan, scoped, { mode: "check" });
  expect(
    scoped.map(({ batches }) => batches.map(({ paths }) => paths))
  ).toEqual([[[rootFile], selected.slice(1, 3), [lastFile]], [selected]]);
  expect(
    result.steps.map(({ path, adapter, status }) => [path, adapter, status])
  ).toEqual(
    selected.flatMap((path) =>
      [packageCheck, workspace].map(({ id }) => [path, id, "passed"])
    )
  );
});

test("a workspace engine's silence leaves the unanswered file incomplete", async () => {
  const adapter = {
    ...fakeAdapter({ descriptor: workspace }),
    check: () => Promise.resolve([{ ...PASSED, path: "README.md" }]),
  };
  const result = await runPlan(resolve([workspace]), [adapter], {
    mode: "check",
  });
  expect(result.steps.map(({ status }) => status)).toEqual([
    "passed",
    "incomplete",
    "incomplete",
    "incomplete",
  ]);
  expect(result.steps[1]?.reason).toContain("gave no answer");
});

test("workspace outcomes and diagnostics outside the selection are rejected", async () => {
  const outside = "packages/b/omitted.md";
  const findings = FINDINGS.findings.flatMap((finding) => [
    { ...finding, path: "README.md" },
    { ...finding, path: outside },
  ]);
  const fake = fakeAdapter({ descriptor: workspace });
  const unplannedOutcome = {
    ...fake,
    check: () => Promise.resolve([{ ...PASSED, path: outside }]),
  };
  const unplannedFinding = {
    ...fake,
    check: () =>
      Promise.resolve([{ ...FINDINGS, findings, path: "README.md" }]),
  };
  const plan = resolve([workspace]);
  const [outcomes, diagnostics] = await Promise.all([
    runPlan(plan, [unplannedOutcome], { mode: "check" }),
    runPlan(plan, [unplannedFinding], { mode: "check" }),
  ]);
  for (const result of [outcomes, diagnostics]) {
    expect(result.steps.map(({ path }) => path)).toEqual(selected);
    expect(result.outcome).toBe("incomplete");
    expect(result.steps.every(({ status }) => status === "incomplete")).toBe(
      true
    );
    expect(result.steps[0]?.reason).toContain(`unplanned file "${outside}"`);
  }
  expect(
    diagnostics.steps.flatMap(({ findings: visible }) =>
      visible.map(({ path }) => path)
    )
  ).toEqual(["README.md"]);
});

test("a kept file makes its project batch read-only as a whole", async () => {
  const keeper = describeFake({
    extensions: [],
    id: "keeper",
    owns: ["README.md"],
    setup: true,
  });
  const plan = resolve([workspace, packageCheck, keeper]);
  expect(
    plan.batches.map(({ adapter, package: directory, writes }) => [
      adapter,
      directory,
      writes,
    ])
  ).toEqual([
    ["keeper", ".", true],
    ["workspace-check", ".", false],
    ["package-check", ".", false],
    ["package-check", "packages/a", true],
    ["package-check", "packages/b", true],
  ]);
  expect(
    plan.paths.every(
      ({ steps }) =>
        steps.find(({ adapter }) => adapter === workspace.id)?.writes === false
    )
  ).toBe(true);
  const fake = fakeAdapter({ descriptor: workspace });
  const adapters = [
    fake,
    ...[packageCheck, keeper].map((descriptor) => fakeAdapter({ descriptor })),
  ];
  await runPlan(plan, adapters, { mode: "fix" });
  expect(fake.calls).toEqual(["probe", "check"]);
});

test("a project diagnostic must be attributed to the file it describes", async () => {
  const adapter = {
    ...fakeAdapter({ descriptor: workspace }),
    check: () =>
      Promise.resolve([
        {
          ...FINDINGS,
          findings: FINDINGS.findings.map((finding) => ({
            ...finding,
            path: lastFile,
          })),
          path: rootFile,
        },
      ]),
  };
  const result = await runPlan(resolve([workspace]), [adapter], {
    mode: "check",
  });
  expect(result.outcome).toBe("incomplete");
  expect(result.steps[0]?.reason).toContain(
    `gave a diagnostic for "${lastFile}" in the answer for "${rootFile}"`
  );
  expect(result.steps.flatMap(({ findings }) => findings)).toEqual([]);
});
