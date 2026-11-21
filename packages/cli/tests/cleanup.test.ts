import { expect, test } from "bun:test";
import { rename } from "node:fs/promises";
import path from "node:path";

import { parseCleanup } from "@ropes/core";

import { gitText } from "../../cinch/src/commands/cleanup/git.ts";
import { CleanupReportSchema } from "../../cinch/src/contracts/cleanup.ts";
import { compareCleanup } from "../../cinch/src/policy/cleanup.ts";
import {
  fixtureGit,
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";
import { accepted, args, commit, fixed } from "./cleanup-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

test("cleanup preserves accepted debt and blocks replacements and reintroductions", async () => {
  if (Bun.which("ast-grep") === null) {
    console.warn(
      "skipped: ast-grep is not on PATH, so cleanup proof did not run"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    const policy = await accepted(main.root);
    await fixed(main.root, "a");
    const first = await commit(main.root);
    const invoke = (parent: string, candidate: string) =>
      runEntry(
        ROPE,
        ["check", ...args(policy.approved, parent, candidate)],
        main.root
      );
    const ran = await invoke(policy.approved, first);
    expect(ran.exitCode).toBe(0);
    const report = CleanupReportSchema.parse(json(ran));
    expect(parseCleanup(json(ran)).ok).toBe(true);
    expect(parseCleanup({ ...report, schemaVersion: 99 })).toEqual({
      error: { found: 99, kind: "unknown-version" },
      ok: false,
    });
    expect(report.zero).toBe(false);
    expect(report.inherited.map(({ path: file }) => file)).toEqual([
      "b/tsconfig.json",
      "c/tsconfig.json",
    ]);
    expect(report.removed.map(({ path: file }) => file)).toEqual([
      "a/tsconfig.json",
    ]);
    expect(report.scans.candidate.commit).toBe(first);
    expect(report.scans.candidate.result?.outcome).toBe("findings");
    const plan = await runEntry(
      ROPE,
      ["explain", ...args(policy.approved, policy.approved, first)],
      main.root
    );
    expect(plan.exitCode).toBe(0);
    expect(json(plan)).toMatchObject({ evidence: "planned", zero: null });
    await Bun.write(path.join(main.root, "b/tsconfig.json"), "\n\n{}\n");
    const shifted = await commit(main.root);
    const shiftedRun = await invoke(first, shifted);
    expect(shiftedRun.exitCode).toBe(0);
    await Bun.write(path.join(main.root, "a/tsconfig.json"), "{}\n");
    await fixed(main.root, "b");
    const restored = await commit(main.root);
    const failed = await invoke(shifted, restored);
    expect(failed.exitCode).toBe(1);
    expect(json(failed)).toMatchObject({
      reintroduced: [{ path: "a/tsconfig.json" }],
      zero: false,
    });
    await rename(path.join(main.root, "c"), path.join(main.root, "new"));
    const renamed = await commit(main.root);
    const renameResult = await invoke(restored, renamed);
    expect(renameResult.exitCode).toBe(1);
    expect(json(renameResult)).toMatchObject({
      introduced: [{ path: "new/tsconfig.json" }],
    });
    const unchanged = await commit(main.root);
    const descendant = await invoke(renamed, unchanged);
    expect(descendant.exitCode).toBe(1);
    expect(json(descendant)).toMatchObject({
      reintroduced: [{ path: "a/tsconfig.json" }],
    });
    await Bun.write(path.join(main.root, "note.txt"), "staged work\n");
    await fixtureGit(main.root, "add", "note.txt");
    await Bun.write(
      path.join(main.root, "a/tsconfig.json"),
      "dirty worktree\n"
    );
    const beforeIndex = await gitText(main.root, "ls-files", "--stage", "-z");
    const beforeDiff = await gitText(main.root, "diff", "--binary");
    await invoke(renamed, unchanged);
    expect(await gitText(main.root, "ls-files", "--stage", "-z")).toBe(
      beforeIndex
    );
    expect(await gitText(main.root, "diff", "--binary")).toBe(beforeDiff);

    const duplicate = {
      ...report.scans.candidate,
      result: report.scans.candidate.result,
    };
    if (duplicate.result === undefined) {
      throw new Error("missing scan");
    }
    const firstStep = duplicate.result.steps.find(
      ({ findings }) => findings.length > 0
    );
    if (firstStep === undefined) {
      throw new Error("missing finding");
    }
    const compared = compareCleanup(
      {
        ...report.scans,
        candidate: {
          ...duplicate,
          result: {
            ...duplicate.result,
            steps: [...duplicate.result.steps, firstStep],
          },
        },
      },
      report.policy,
      report.at,
      false,
      []
    );
    expect(compared.outcome).toBe("incomplete");
    expect(compared.uncertainty.join(", ")).toContain("repeated occurrences");
  });
}, 30_000);
