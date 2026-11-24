import { expect } from "bun:test";
import path from "node:path";

import { FixReportSchema } from "../src/contracts/fix.ts";
import { parsePlan, parseResult } from "../src/contracts/parse.ts";
import type { Plan } from "../src/contracts/plan.ts";
import { exitCodeOf } from "../src/contracts/result.ts";
import type { Result } from "../src/contracts/result.ts";
import { CONFIG, FILES, json, proof } from "./acceptance-repo.ts";
import type { Ran } from "./acceptance-repo.ts";

/**
 * The proofs the Forge pilot asks for, rehearsed on a fixture
 * repository. Every run goes through the `rope` executable in a child
 * process, and every Markdown step runs the real engine.
 */

const planOf = (ran: Ran): Plan => {
  const parsed = parsePlan(json(ran));
  if (!parsed.ok) {
    throw new Error(`not a plan: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.value;
};

const resultOf = (ran: Ran): Result => {
  const parsed = parseResult(json(ran));
  if (!parsed.ok) {
    throw new Error(`not a result: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.value;
};

const stepsOf = (plan: Plan, file: string): readonly string[] =>
  plan.paths
    .filter((entry) => entry.path === file)
    .flatMap((entry) => entry.steps.map((step) => step.adapter));

const rulesOf = (result: Result, file: string): readonly string[] =>
  result.steps
    .filter((step) => step.path === file)
    .flatMap((step) => step.findings.map((finding) => finding.rule));

const LEGACY = "legacy/old.md";
const NOTES = "packages/app/docs/notes.md";

proof(
  "proof 1: a nested package and a linked worktree each resolve to their own root",
  async ({ main, worktree }) => {
    const fromRoot = planOf(await main.rope(["explain", "--json"]));
    const fromPackage = planOf(
      await main.rope(["explain", "--json"], { cwd: "packages/app" })
    );
    expect(fromPackage).toEqual(fromRoot);
    expect(fromRoot.paths.map((entry) => entry.path)).toContain(NOTES);

    const scoped = planOf(
      await main.rope(["explain", "docs/notes.md", "--json"], {
        cwd: "packages/app",
      })
    );
    expect(scoped.paths.map((entry) => entry.path)).toEqual([NOTES]);

    const linked = await worktree();
    await Bun.write(path.join(linked.root, "rope.toml"), "pilot = 0\n");
    const inLinked = planOf(
      await linked.rope(["explain", "--json"], { cwd: "packages/app" })
    );
    expect(stepsOf(inLinked, LEGACY)).toEqual(["rumdl"]);
    expect(stepsOf(fromRoot, LEGACY)).toEqual([]);
    expect(await Bun.file(path.join(main.root, "rope.toml")).text()).toBe(
      CONFIG
    );
  }
);

proof(
  "proof 2: an override changes both what explain says and what check runs",
  async ({ main }) => {
    const plan = planOf(await main.rope(["explain", "--json"]));
    const legacy = plan.paths.find((entry) => entry.path === LEGACY);
    expect(legacy?.steps).toEqual([]);
    expect(legacy?.policy).toEqual([
      {
        key: "markdown.enabled",
        source: {
          file: "rope.toml",
          key: "overrides.0.markdown.enabled",
          kind: "file",
        },
        value: false,
      },
      { key: "toml.enabled", source: { kind: "default" }, value: true },
    ]);
    expect(stepsOf(plan, "README.md")).toEqual(["rumdl"]);

    const text = await main.rope(["explain", LEGACY]);
    expect(text.stdout).toContain("overrides.0.markdown.enabled");
    expect(text.stdout).toContain("no step applies");

    const ran = await main.rope(["check", "--json"]);
    const result = resultOf(ran);
    expect(ran.exitCode).toBe(1);
    expect(rulesOf(result, "README.md")).toEqual(["MD025"]);
    expect(result.steps.some((step) => step.path === LEGACY)).toBe(false);

    await Bun.write(path.join(main.root, "rope.toml"), "pilot = 0\n");
    const without = resultOf(await main.rope(["check", "--json"]));
    expect(rulesOf(without, LEGACY)).toEqual(["MD025"]);
  }
);

proof(
  "proof 3: fix is previewed, then applied, then has nothing left to do",
  async ({ main }) => {
    expect(await main.files()).toEqual({ ...FILES });
    await main.rope(["doctor", "--fix"]);
    const before = await main.files();

    const preview = await main.rope(["fix", "--dry-run", "--json"]);
    const previewed = FixReportSchema.parse(json(preview));
    expect(previewed.dryRun).toBe(true);
    expect(previewed.changed).toContain("README.md");
    expect(previewed.changed).toContain(NOTES);
    expect(previewed.diff).toContain("-# Second title\n+## Second title");
    expect(await main.files()).toEqual(before);
    expect(before["README.md"]).toBe(FILES["README.md"]);

    const apply = await main.rope(["fix", "--json"]);
    const applied = FixReportSchema.parse(json(apply));
    expect(apply.exitCode).toBe(0);
    expect(applied.changed).toEqual(previewed.changed);
    expect(applied.diff).toBe(previewed.diff);
    const after = await main.files();
    expect(after["README.md"]).toBe("# Guide\n\n## Second title\n\nText.\n");
    expect(after[NOTES]).toBe("# App\n\nToo many blanks above.\n");
    expect(after[LEGACY]).toBe(FILES[LEGACY]);

    const again = await main.rope(["fix", "--json"]);
    const repeated = FixReportSchema.parse(json(again));
    expect(repeated.changed).toEqual([]);
    expect(repeated.diff).toBe("");
    expect(await main.files()).toEqual(after);

    const check = await main.rope(["check"]);
    expect(check.exitCode).toBe(0);
  }
);

proof(
  "proof 4: a missing tool makes the run incomplete and exits 2",
  async ({ emptyPath, main }) => {
    const ran = await main.rope(["check", "--json"], { path: emptyPath });
    const result = resultOf(ran);
    expect(ran.exitCode).toBe(2);
    expect(result.outcome).toBe("incomplete");
    const readme = result.steps.find((step) => step.path === "README.md");
    expect(readme?.status).toBe("incomplete");
    expect(readme?.reason).toContain("not on PATH");
    expect(readme?.findings).toEqual([]);

    const text = await main.rope(["check"], { path: emptyPath });
    expect(text.exitCode).toBe(2);
    expect(text.stdout).toContain("Exit code 2");

    await main.rope(["doctor", "--fix"]);
    const fix = await main.rope(["fix"], { path: emptyPath });
    expect(fix.exitCode).toBe(2);
    const left = await main.files();
    expect(left["README.md"]).toBe(FILES["README.md"]);
  }
);

proof(
  "proof 5: the JSON a run prints parses with the published parser",
  async ({ main }) => {
    const explain = await main.rope(["explain", "--json"]);
    expect(parsePlan(json(explain)).ok).toBe(true);
    expect(explain.stderr).toBe("");

    const check = await main.rope(["check", "--json"]);
    const result = resultOf(check);
    expect(check.stderr).toBe("");
    expect(check.exitCode).toBe(exitCodeOf(result));
    expect(result.plan).toEqual(planOf(explain));
    expect(result.steps.length).toBeGreaterThan(0);

    const newer: unknown = { ...result, schemaVersion: 99 };
    expect(parseResult(newer)).toEqual({
      error: { found: 99, kind: "unknown-version" },
      ok: false,
    });
  }
);
