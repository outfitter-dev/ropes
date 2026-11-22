import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { changeAt, unifiedDiff } from "../src/render/diff.ts";
import { runPlan } from "../src/runner/run.ts";
import { FIXED, PASSED, fakeAdapter } from "./fake-adapter.ts";

const lines = (size: number) =>
  Array.from({ length: size }, (_, index) => `line ${index}\n`);
const changedLines = (diff: string) =>
  diff.split("\n").filter((line) => /^[-+][^-+]/u.test(line)).length;

test.each([2001, 20_000])(
  "distant edits preserve the unchanged middle of a %i-line file",
  (size) => {
    const before = lines(size);
    const after = before.with(0, "first\n").with(size - 1, "last\n");
    expect(
      changedLines(unifiedDiff("a.md", before.join(""), after.join("")))
    ).toBe(4);
    expect(
      changeAt("a.md", before.join(""), after.join(""), {
        from: 1000,
        to: 1000,
      })
    ).toBe("");
  }
);

test.each([5, 50])(
  "edits every %i lines in a large file retain their unchanged neighbors",
  (interval) => {
    const before = lines(20_000);
    const after = before.map((line, index) =>
      index % interval === 0 ? `changed ${index}\n` : line
    );
    const started = performance.now();
    expect(
      changedLines(unifiedDiff("a.md", before.join(""), after.join("")))
    ).toBe(40_000 / interval);
    // Keep a generous bound that still detects an accidental quadratic fallback.
    expect(performance.now() - started).toBeLessThan(2000);
  }
);

test("a large ambiguous region cannot consume unchanged anchors around it", () => {
  const before = [
    "old head\n",
    "anchor one\n",
    ...Array.from({ length: 2100 }, () => "old\n"),
    "anchor two\n",
    "old tail\n",
  ];
  const after = [
    "new head\n",
    "anchor one\n",
    ...Array.from({ length: 2100 }, () => "new\n"),
    "anchor two\n",
    "new tail\n",
  ];
  expect(
    changeAt("a.md", before.join(""), after.join(""), { from: 2, to: 2 })
  ).toBe("");
  expect(
    changeAt("a.md", before.join(""), after.join(""), { from: 2103, to: 2103 })
  ).toBe("");
});

test("a formatter's distant edits do not turn an untouched finding into a conflict", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "diff-conflict-"))
  );
  try {
    const before = lines(2001).join("");
    await Bun.write(path.join(root, "a.md"), before);
    const lint = fakeAdapter({
      check: () =>
        Promise.resolve({
          findings: [
            {
              fixable: false,
              message: "An independent finding on an untouched line.",
              path: "a.md",
              range: { start: { column: 1, line: 1000 } },
              rule: "fake/middle",
              severity: "error",
              source: "lint",
            },
          ],
          status: "findings",
        }),
      descriptor: { id: "lint" },
      fix: () => Promise.resolve(PASSED),
    });
    const formatter = fakeAdapter({
      descriptor: { id: "format" },
      fix: async () => {
        await Bun.write(
          path.join(root, "a.md"),
          before.replace("line 0\n", "first\n").replace("line 2000\n", "last\n")
        );
        return FIXED;
      },
    });
    const adapters = [lint, formatter];
    const plan = resolvePlan({
      config: DEFAULT_CONFIG,
      descriptors: adapters.map((adapter) => adapter.descriptor),
      packages: [],
      paths: ["a.md"],
      root,
      selection: { kind: "workspace" },
    });
    const result = await runPlan(plan, adapters, {
      changeAt,
      mode: "fix",
      platform: "linux",
    });
    expect(lint.calls).toEqual(["probe", "fix", "check"]);
    expect(result.conflicts).toBeUndefined();
    expect(result.outcome).toBe("clean");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
