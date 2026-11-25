import { afterAll, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { StepOutcome } from "../src/adapters/adapter.ts";
import type { FileInput } from "../src/adapters/batch.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { CONFLICT_RULE } from "../src/contracts/conflict.ts";
import { ResultSchema } from "../src/contracts/result.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { changeAt } from "../src/render/diff.ts";
import { renderHuman } from "../src/render/human.ts";
import { runPlan } from "../src/runner/run.ts";
import { FIXED, PASSED, fakeAdapter } from "./fake-adapter.ts";
import type { FakeOptions } from "./fake-adapter.ts";

const roots: string[] = [];
afterAll(() =>
  Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })))
);

const repo = async (files: Readonly<Record<string, string>>) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ropes-cf-")));
  roots.push(root);
  await Promise.all(
    Object.entries(files).map(([name, text]) =>
      Bun.write(path.join(root, name), text)
    )
  );
  return root;
};

const edit = async (
  input: FileInput,
  change: (text: string) => string
): Promise<StepOutcome> => {
  const file = Bun.file(path.join(input.root, input.path));
  const before = await file.text();
  const after = change(before);
  await Bun.write(file, after);
  return after === before ? PASSED : FIXED;
};

/** A linter that wants `LOUD` in capitals and can fix it. */
const loud = (finds: string): FakeOptions => ({
  check: async (input) => {
    const text = await Bun.file(path.join(input.root, input.path)).text();
    const findings = text.split("\n").flatMap((line, index) =>
      line.includes(finds)
        ? [
            {
              fixable: true,
              message: "Write it in capitals.",
              path: input.path,
              range: { start: { column: 1, line: index + 1 } },
              rule: "fake/capitals",
              severity: "error" as const,
              source: "lint",
            },
          ]
        : []
    );
    return findings.length === 0 ? PASSED : { findings, status: "findings" };
  },
  descriptor: { id: "lint", tool: "lint-tool" },
  fix: (input) => edit(input, (text) => text.replaceAll("loud", "LOUD")),
});

const PASSED_SOON = Promise.resolve(PASSED);

/** A formatter that writes every word in lower case, or one that tidies. */
const format = (change: (text: string) => string): FakeOptions => ({
  descriptor: { id: "format", tool: "format-tool" },
  fix: (input) => edit(input, change),
});

const run = async (
  root: string,
  options: readonly FakeOptions[],
  mode: "check" | "fix" = "fix"
) => {
  const adapters = options.map((option) => fakeAdapter(option));
  const plan = resolvePlan({
    config: DEFAULT_CONFIG,
    descriptors: adapters.map((adapter) => adapter.descriptor),
    packages: [],
    paths: ["a.md", "b.md"],
    root,
    selection: { kind: "workspace" },
  });
  const result = await runPlan(plan, adapters, {
    changeAt,
    mode,
    platform: "linux",
  });
  return { adapters, result };
};

const TEXT = "one\n\n\n\n\n\n\n\nthe loud word\n";

test("a lint rule set against the formatter is one conflict, with the rule and the diff", async () => {
  const root = await repo({ "a.md": TEXT, "b.md": "quiet\n" });
  const { adapters, result } = await run(root, [
    loud("loud"),
    format((text) => text.toLowerCase()),
  ]);
  expect(ResultSchema.safeParse(result).success).toBe(true);
  expect(result.conflicts).toHaveLength(1);
  const [conflict] = result.conflicts ?? [];
  expect(conflict).toMatchObject({
    path: "a.md",
    reportedBy: "lint",
    rewrittenBy: "format",
    rule: "fake/capitals",
  });
  expect(conflict?.diff).toContain("-the LOUD word\n+the loud word\n");
  const found = result.steps.flatMap((step) => step.findings);
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({
    fixable: false,
    path: "a.md",
    range: { start: { line: 9 } },
    rule: CONFLICT_RULE,
  });
  expect(found[0]?.message).toContain("fake/capitals");
  expect(result.outcome).toBe("findings");
  // The second look is a check, and only of the file the formatter changed.
  expect(adapters[0]?.calls).toEqual(["probe", "fix", "check"]);
  expect(adapters[0]?.batches.at(-1)?.paths).toEqual(["a.md"]);
  expect(renderHuman(result)).toContain(
    "Conflict in a.md: format rewrote what fake/capitals [lint] then reported."
  );
});

test("a lint fix and a format change that agree are no conflict, and a second run changes nothing", async () => {
  const root = await repo({ "a.md": `${TEXT}tail   \n`, "b.md": "quiet\n" });
  const steps = [
    loud("loud"),
    format((text) => text.replaceAll(/ +\n/gu, "\n")),
  ];
  const first = await run(root, steps);
  expect(first.result.conflicts).toBeUndefined();
  expect(first.result.outcome).toBe("clean");
  expect(first.adapters[0]?.calls).toEqual(["probe", "fix", "check"]);
  const text = await Bun.file(path.join(root, "a.md")).text();
  const second = await run(root, steps);
  expect(await Bun.file(path.join(root, "a.md")).text()).toBe(text);
  // Nothing was rewritten, so nothing was checked again.
  expect(second.adapters[0]?.calls).toEqual(["probe", "fix"]);
});

/** The same linter, with nothing it can fix: its findings stay. */
const stuck = (finds: string): FakeOptions => {
  const lint = loud(finds);
  return { ...lint, fix: (input) => lint.check?.(input) ?? PASSED_SOON };
};

test("a finding the linter already had is not a conflict, though its line was rewritten", async () => {
  const root = await repo({ "a.md": "the shout word\n", "b.md": "quiet\n" });
  const { adapters, result } = await run(root, [
    stuck("shout"),
    format((text) => text.replace("word", "words")),
  ]);
  expect(adapters[0]?.calls).toEqual(["probe", "fix", "check"]);
  expect(result.conflicts).toBeUndefined();
});

test("a finding the linter already had does not hide the same finding made new above it", async () => {
  const root = await repo({
    "a.md": "calm\n\n\n\n\n\n\n\nthe shout word\n",
    "b.md": "quiet\n",
  });
  const { result } = await run(root, [
    stuck("shout"),
    format((text) => text.replace("calm", "shout")),
  ]);
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts?.[0]?.finding.range.start.line).toBe(1);
});

test("a new finding on lines the formatter left alone is not a conflict", async () => {
  const root = await repo({ "a.md": TEXT, "b.md": "quiet\n" });
  let looks = 0;
  const lint = loud("never");
  const { result } = await run(root, [
    {
      ...lint,
      check: (input) => {
        looks += 1;
        return Promise.resolve({
          findings: [
            {
              fixable: false,
              message: "Far away.",
              path: input.path,
              range: { start: { column: 1, line: 1 } },
              rule: "fake/far",
              severity: "error",
              source: "lint",
            },
          ],
          status: "findings",
        });
      },
    },
    format((text) => text.replace("word", "words")),
  ]);
  expect(looks).toBe(1);
  expect(result.conflicts).toBeUndefined();
});

test("a second look that cannot run is incomplete, never passed", async () => {
  const root = await repo({ "a.md": TEXT, "b.md": "quiet\n" });
  const { result } = await run(root, [
    {
      ...loud("loud"),
      check: () => {
        throw new Error("boom");
      },
    },
    format((text) => text.toLowerCase()),
  ]);
  expect(result.outcome).toBe("incomplete");
  expect(
    result.steps.find((step) => step.status === "incomplete")?.reason
  ).toBe(
    "lint-tool could not check this file again after format-tool rewrote it: lint-tool threw: boom"
  );
});

test("check looks once and reports no conflicts", async () => {
  const root = await repo({ "a.md": TEXT, "b.md": "quiet\n" });
  const { adapters, result } = await run(
    root,
    [loud("loud"), format((text) => text.toLowerCase())],
    "check"
  );
  expect(result.conflicts).toBeUndefined();
  expect(adapters[0]?.calls).toEqual(["probe", "check"]);
});
