import { expect, test } from "bun:test";
import path from "node:path";

import { fixtureGit, withFixture } from "../../cinch/tests/acceptance-repo.ts";
import {
  BEFORE,
  campaign,
  command,
  DEADLINE,
  head,
  migration,
  migrationInput,
  names,
  repair,
  save,
} from "./cleanup-stack-fixture.ts";

const ready = () => {
  if (Bun.which("ast-grep") !== null) {
    return true;
  }
  console.warn(
    "skipped: ast-grep is not on PATH, so the migration stack proof did not run"
  );
  return false;
};

test("each cleanup layer reports its own delta and cumulative full-scope progress", async () => {
  if (!ready()) {
    return;
  }
  await withFixture(async ({ main }) => {
    const stack = await campaign(main.root);
    const layers = [
      {
        candidate: stack.first,
        parent: stack.approved,
        remaining: 7,
        removed: 5,
      },
      {
        candidate: stack.second,
        parent: stack.first,
        remaining: 3,
        removed: 4,
      },
      {
        candidate: stack.third,
        parent: stack.second,
        remaining: 0,
        removed: 3,
      },
    ];
    const reports = await Promise.all(
      layers.map(async (layer) => ({
        layer,
        report: await migration(
          main.root,
          stack.approved,
          layer.parent,
          layer.candidate
        ),
      }))
    );
    for (const { layer, report } of reports) {
      expect(report.removed).toHaveLength(layer.removed);
      expect(report.inherited).toHaveLength(layer.remaining);
      expect(report.introduced).toEqual([]);
      expect(report.reintroduced).toEqual([]);
      expect(report.zero).toBe(layer.remaining === 0);
      expect(report.scans.candidate.result?.outcome).toBe(
        layer.remaining === 0 ? "clean" : "findings"
      );
      expect(report.scans.anchor.commit).toBe(stack.anchor);
      expect(report.scans.parent.commit).toBe(layer.parent);
      expect(report.scans.candidate.commit).toBe(layer.candidate);
      expect(report.evidence).toBe("simulated");
      expect(report.at).toBe(BEFORE);
    }
    const prefixAtDeadline = await migration(
      main.root,
      stack.approved,
      stack.approved,
      stack.first,
      1,
      DEADLINE
    );
    const tipAtDeadline = await migration(
      main.root,
      stack.approved,
      stack.second,
      stack.third,
      0,
      DEADLINE
    );
    expect(prefixAtDeadline.zero).toBe(false);
    expect(prefixAtDeadline.inherited).toHaveLength(7);
    expect(tipAtDeadline.zero).toBe(true);
    await fixtureGit(
      main.root,
      "switch",
      "--quiet",
      "--create",
      "invalid-middle",
      stack.first
    );
    await Bun.write(path.join(main.root, "packages/new/tsconfig.json"), "{}\n");
    await repair(main.root, names.slice(5));
    const invalid = await save(
      main.root,
      "middle layer introduces a fresh violation"
    );
    const failed = await migration(
      main.root,
      stack.approved,
      stack.first,
      invalid,
      1
    );
    expect(failed.introduced.map(({ path: file }) => file)).toEqual([
      "packages/new/tsconfig.json",
    ]);
    await repair(main.root, ["new"]);
    const repairedTip = await save(
      main.root,
      "tip repairs the introduced violation"
    );
    const repaired = await migration(
      main.root,
      stack.approved,
      invalid,
      repairedTip
    );
    expect(repaired.zero).toBe(true);
  });
}, 60_000);

test("squash landing and restack require qualification against the actual target", async () => {
  if (!ready()) {
    return;
  }
  await withFixture(async ({ main }) => {
    const stack = await campaign(main.root);
    await fixtureGit(
      main.root,
      "switch",
      "--quiet",
      "--create",
      "target",
      stack.approved
    );
    await fixtureGit(main.root, "merge", "--squash", stack.first);
    const landed = await save(
      main.root,
      "squash land only the first cleanup layer"
    );
    expect(landed).not.toBe(stack.first);
    await Bun.write(
      path.join(main.root, "ordinary.txt"),
      "unrelated work can land\n"
    );
    const ordinary = await save(
      main.root,
      "unrelated work after partial landing"
    );
    const retained = await migration(
      main.root,
      stack.approved,
      landed,
      ordinary
    );
    expect(retained.inherited).toHaveLength(7);
    expect(retained.zero).toBe(false);
    await repair(main.root, [names[5] ?? "p06"]);
    const concurrent = await save(
      main.root,
      "target independently fixes the sixth config"
    );
    await Bun.write(path.join(main.root, "packages/p06/tsconfig.json"), "{}\n");
    await repair(main.root, names.slice(6, 9));
    const undo = await save(
      main.root,
      "candidate undoes the target fix while reducing total debt"
    );
    const rejected = await migration(
      main.root,
      stack.approved,
      concurrent,
      undo,
      1
    );
    expect(rejected.reintroduced.map(({ path: file }) => file)).toEqual([
      "packages/p06/tsconfig.json",
    ]);
    expect(rejected.inherited).toHaveLength(3);
    expect(rejected.inherited.length + rejected.reintroduced.length).toBe(4);
    await fixtureGit(
      main.root,
      "switch",
      "--quiet",
      "--create",
      "restacked",
      concurrent
    );
    await fixtureGit(main.root, "cherry-pick", stack.second);
    const restackedSecond = await head(main.root);
    const rebased = await migration(
      main.root,
      stack.approved,
      concurrent,
      restackedSecond
    );
    expect(rebased.removed).toHaveLength(3);
    expect(rebased.inherited).toHaveLength(3);
    const stale = await command(
      main.root,
      migrationInput(stack.approved, stack.first, restackedSecond)
    );
    expect(stale.exitCode).toBe(2);
    await fixtureGit(main.root, "cherry-pick", stack.third);
    const tip = await head(main.root);
    const completed = await migration(
      main.root,
      stack.approved,
      restackedSecond,
      tip
    );
    expect(completed.zero).toBe(true);
    const missing = await command(
      main.root,
      migrationInput(stack.approved, "0".repeat(40), tip)
    );
    expect(missing.exitCode).toBe(2);
    await Bun.write(path.join(main.root, "cinch.toml"), "pilot = 0\n");
    const changedPolicy = await save(main.root, "unreviewed policy change");
    const incompatible = await command(
      main.root,
      migrationInput(stack.approved, tip, changedPolicy)
    );
    expect(incompatible.exitCode).toBe(2);
  });
}, 60_000);
