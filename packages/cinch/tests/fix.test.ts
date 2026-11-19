import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import path from "node:path";

import type { StepInput, StepOutcome } from "../src/adapters/adapter.ts";
import { FixReportSchema } from "../src/contracts/fix.ts";
import type { FixReport } from "../src/contracts/fix.ts";
import { FINDINGS, FIXED, PASSED } from "./fake-adapter.ts";
import { BASE, snapshot, withRepo } from "./repo-bench.ts";
import type { Tree } from "./repo-bench.ts";

const TREE: Tree = {
  ...BASE,
  "a.md": "# A\n\nTODO one\nkeep\n",
  "docs/b.md": "# B\nTODO two",
};

/** A fixer that rewrites TODO to DONE, and is a no-op the second time. */
const rewrite = async (input: StepInput): Promise<StepOutcome> => {
  const file = Bun.file(path.join(input.root, input.path));
  const before = await file.text();
  const after = before.replaceAll("TODO", "DONE");
  await Bun.write(file, after);
  return after === before ? PASSED : FIXED;
};

const flaky = (input: StepInput): Promise<StepOutcome> => {
  if (input.path === "docs/b.md") {
    throw new Error("boom");
  }
  return rewrite(input);
};

const partial = async (input: StepInput): Promise<StepOutcome> => {
  await rewrite(input);
  return FINDINGS;
};

/** A fixer that only works when it can read an installed dependency. */
const withDep = async (input: StepInput): Promise<StepOutcome> => {
  const rule = Bun.file(path.join(input.root, "node_modules/dep/rule.txt"));
  const found = await rule.exists();
  return found ? await rewrite(input) : FINDINGS;
};

const reportOf = (output: string | undefined): FixReport =>
  FixReportSchema.parse(JSON.parse(output ?? "null"));

test("a dry run shows the diff a real fix then produces, and writes nothing", async () => {
  await withRepo(TREE, { fix: rewrite }, async ({ root, run }) => {
    const before = await snapshot(root);
    const preview = await run("fix", [], { dryRun: true, json: true });
    expect(await snapshot(root)).toEqual(before);
    const applied = await run("fix", [], { json: true });
    const dry = reportOf(preview.output);
    const real = reportOf(applied.output);
    expect(dry.dryRun).toBe(true);
    expect(real.dryRun).toBe(false);
    expect(dry.diff).toBe(real.diff);
    expect(dry.changed).toEqual(["a.md", "docs/b.md"]);
    expect(real.changed).toEqual(dry.changed);
    expect(dry.result).toEqual(real.result);
    expect(real.result.plan.root).toBe(root);
    expect(preview.exitCode).toBe(0);
    expect(real.diff).toBe(
      [
        "--- a/a.md\n+++ b/a.md\n@@ -1,4 +1,4 @@\n # A\n \n-TODO one\n+DONE one\n keep\n",
        "--- a/docs/b.md\n+++ b/docs/b.md\n@@ -1,2 +1,2 @@\n # B\n-TODO two\n\\ No newline at end of file\n+DONE two\n\\ No newline at end of file\n",
      ].join("")
    );
    const written = await snapshot(root);
    expect(written["a.md"]).toBe("# A\n\nDONE one\nkeep\n");
  });
});

test("a second fix changes nothing and exits 0", async () => {
  await withRepo(TREE, { fix: rewrite }, async ({ root, run }) => {
    await run("fix");
    const settled = await snapshot(root);
    const again = await run("fix", [], { json: true });
    expect(again.exitCode).toBe(0);
    expect(reportOf(again.output)).toMatchObject({ changed: [], diff: "" });
    expect(await snapshot(root)).toEqual(settled);
    const third = await run("fix");
    expect(third.output).toContain("No files changed.");
  });
});

test("a fix that stops partway still names what it wrote", async () => {
  await withRepo(TREE, { fix: flaky }, async ({ run }) => {
    const response = await run("fix");
    expect(response.exitCode).toBe(2);
    expect(response.output).toContain("Changed:\n  a.md\n\n");
    expect(response.output).toContain("docs/b.md\n  incomplete  fake:");
    expect(response.output).toContain("boom");
  });
});

test("findings that remain after a fix exit 1", async () => {
  await withRepo(TREE, { fix: partial }, async ({ run }) => {
    const response = await run("fix", ["a.md"]);
    expect(response.exitCode).toBe(1);
    expect(response.output).toContain("Changed:\n  a.md");
    expect(response.output).toContain("fake/rule");
  });
});

test("a dry run prints the diff and says nothing was written", async () => {
  await withRepo(TREE, { fix: rewrite }, async ({ run }) => {
    const response = await run("fix", ["a.md"], { dryRun: true });
    expect(response.output).toStartWith(
      "--- a/a.md\n+++ b/a.md\n@@ -1,4 +1,4 @@"
    );
    expect(response.output).toContain(
      "Dry run: 1 file would change. Nothing was written."
    );
  });
});

test("a step that does not write is checked, not fixed", async () => {
  await withRepo(
    TREE,
    { descriptor: { writes: false }, fix: rewrite },
    async ({ adapter, root, run }) => {
      const before = await snapshot(root);
      const response = await run("fix", ["a.md"]);
      expect(response.exitCode).toBe(0);
      expect(adapter.calls).toEqual(["probe", "check"]);
      expect(await snapshot(root)).toEqual(before);
    }
  );
});

test("a dry run previews a named file that git ignores", async () => {
  const tree = { ...TREE, ".gitignore": "notes.md\n", "notes.md": "TODO\n" };
  await withRepo(tree, { fix: rewrite }, async ({ root, run }) => {
    Bun.spawnSync(["git", "init", "-q"], { cwd: root });
    const preview = await run("fix", ["notes.md"], {
      dryRun: true,
      json: true,
    });
    const applied = await run("fix", ["notes.md"], { json: true });
    expect(reportOf(preview.output).changed).toEqual(["notes.md"]);
    expect(reportOf(preview.output).result).toEqual(
      reportOf(applied.output).result
    );
  });
});

test("a dry run keeps a link inside the root a link, as a real fix sees it", async () => {
  await withRepo(TREE, { fix: rewrite }, async ({ root, run }) => {
    await symlink("a.md", path.join(root, "alias.md"));
    const before = await snapshot(root);
    const preview = await run("fix", [], { dryRun: true, json: true });
    expect(await snapshot(root)).toEqual(before);
    const applied = await run("fix", [], { json: true });
    const dry = reportOf(preview.output);
    expect(dry.result).toEqual(reportOf(applied.output).result);
    expect(dry.diff).toBe(reportOf(applied.output).diff);
  });
});

test("a dry run can read the dependencies installed at the root", async () => {
  const tree = { ...TREE, "node_modules/dep/rule.txt": "DONE" };
  await withRepo(tree, { fix: withDep }, async ({ root, run }) => {
    Bun.spawnSync(["git", "init", "-q"], { cwd: root });
    await Bun.write(path.join(root, ".gitignore"), "node_modules\n");
    const before = await snapshot(root);
    const preview = await run("fix", [], { dryRun: true, json: true });
    expect(await snapshot(root)).toEqual(before);
    expect(preview.exitCode).toBe(0);
    expect(reportOf(preview.output).changed).toEqual(["a.md", "docs/b.md"]);
  });
});
