import { expect, test } from "bun:test";
import path from "node:path";

import { fixtureGit, withFixture } from "../../cinch/tests/acceptance-repo.ts";
import {
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
    const prefixAtDeadline = await migration(
      main.root,
      stack.approved,
      stack.approved,
      landed,
      1,
      DEADLINE
    );
    expect(prefixAtDeadline.inherited).toHaveLength(7);
    expect(prefixAtDeadline.scans.candidate.commit).toBe(landed);
    expect(prefixAtDeadline.zero).toBe(false);
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
    const middleAtDeadline = await migration(
      main.root,
      stack.approved,
      concurrent,
      restackedSecond,
      1,
      DEADLINE
    );
    expect(middleAtDeadline.inherited).toHaveLength(3);
    expect(middleAtDeadline.scans.candidate.commit).toBe(restackedSecond);
    const tipAtDeadline = await migration(
      main.root,
      stack.approved,
      restackedSecond,
      tip,
      0,
      DEADLINE
    );
    expect(tipAtDeadline.zero).toBe(true);
    expect(tipAtDeadline.scans.candidate.commit).toBe(tip);
    const missing = await command(
      main.root,
      migrationInput(stack.approved, "0".repeat(40), tip)
    );
    expect(missing.exitCode).toBe(2);
    const configFile = path.join(main.root, "rope.toml");
    const adopted = await Bun.file(configFile).text();
    await Bun.write(configFile, `${adopted}\n# unreviewed context change\n`);
    const changedPolicy = await save(main.root, "unreviewed policy change");
    const incompatible = await command(
      main.root,
      migrationInput(stack.approved, tip, changedPolicy)
    );
    expect(incompatible.exitCode).toBe(2);
    expect(incompatible.stderr).toContain(
      "changes configuration, package evidence, or pins"
    );
  });
}, 60_000);
