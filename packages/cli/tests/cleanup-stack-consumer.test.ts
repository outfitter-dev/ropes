import { expect, test } from "bun:test";

import { parseCleanup } from "@ropes/core";

import { gitText } from "../../core/src/commands/cleanup/git.ts";
import { json, withFixture } from "../../core/tests/acceptance-repo.ts";
import { campaign, command, migration } from "./cleanup-stack-fixture.ts";

/** A consumer supplies these identities from its target, outside the candidate report. */
const replay = (
  value: unknown,
  trusted: { policy: string; parent: string; candidate: string; tree: string },
  simulated = false
) => {
  const parsed = parseCleanup(value);
  if (!parsed.ok) {
    throw new Error("Unknown or invalid cleanup report");
  }
  const report = parsed.value;
  if (
    report.policy.commit !== trusted.policy ||
    report.scans.parent.commit !== trusted.parent ||
    report.scans.candidate.commit !== trusted.candidate ||
    report.scans.candidate.tree !== trusted.tree
  ) {
    throw new Error(
      "Report identities differ from the consumer's actual target and candidate"
    );
  }
  if (
    report.evidence !== "observed" &&
    !(simulated && report.evidence === "simulated")
  ) {
    throw new Error("Current qualification needs an observed report");
  }
  return {
    campaignRemaining:
      report.inherited.length +
      report.introduced.length +
      report.reintroduced.length,
    layerRemoved: report.removed.length,
    migrationComplies: report.outcome === "clean",
    scopeZero: report.zero,
  };
};

const context = async (
  root: string,
  policy: string,
  parent: string,
  candidate: string
) => {
  const tree = await gitText(root, "rev-parse", `${candidate}^{tree}`);
  return { candidate, parent, policy, tree: tree.trim() };
};

test("a plain consumer distinguishes layer progress, campaign debt and full zero", async () => {
  if (Bun.which("ast-grep") === null) {
    console.warn(
      "skipped: ast-grep is not on PATH, so the migration consumer replay did not run"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    const stack = await campaign(main.root);
    const reports = await Promise.all([
      migration(main.root, stack.approved, stack.approved, stack.first),
      migration(main.root, stack.approved, stack.first, stack.second),
      migration(main.root, stack.approved, stack.second, stack.third),
    ]);
    const expected = await Promise.all([
      context(main.root, stack.approved, stack.approved, stack.first),
      context(main.root, stack.approved, stack.first, stack.second),
      context(main.root, stack.approved, stack.second, stack.third),
    ]);
    const views = reports.map((report, index) => {
      const identities = expected[index];
      if (identities === undefined) {
        throw new Error("Missing trusted identities");
      }
      return replay(report, identities, true);
    });
    expect(views).toEqual([
      {
        campaignRemaining: 7,
        layerRemoved: 5,
        migrationComplies: true,
        scopeZero: false,
      },
      {
        campaignRemaining: 3,
        layerRemoved: 4,
        migrationComplies: true,
        scopeZero: false,
      },
      {
        campaignRemaining: 0,
        layerRemoved: 3,
        migrationComplies: true,
        scopeZero: true,
      },
    ]);
    const [first, second, third] = reports;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("Missing campaign layer");
    }
    const [firstContext, secondContext, thirdContext] = expected;
    if (
      firstContext === undefined ||
      secondContext === undefined ||
      thirdContext === undefined
    ) {
      throw new Error("Missing trusted identities");
    }
    expect(() =>
      replay(second, { ...secondContext, parent: stack.approved }, true)
    ).toThrow("actual target");
    expect(() => replay(second, thirdContext, true)).toThrow("actual target");
    expect(() => replay(first, firstContext)).toThrow("observed report");
    const observed = await command(main.root, [
      "check",
      "--migration",
      `${stack.approved}:migration.json`,
      "--parent",
      stack.approved,
      "--candidate",
      stack.first,
      "--json",
    ]);
    expect(observed.exitCode).toBe(0);
    expect(replay(json(observed), firstContext).migrationComplies).toBe(true);
    expect(() =>
      replay({ ...third, schemaVersion: 99 }, thirdContext, true)
    ).toThrow("Unknown or invalid");
  });
}, 60_000);
