import { expect, test } from "bun:test";
import { chmod, mkdir, symlink } from "node:fs/promises";
import path from "node:path";

import { parsePlan, parseResult } from "@ropes/core";

import { SCHEMA_VERSION } from "../../core/src/contracts/plan.ts";
import {
  json,
  runEntry,
  withFixture,
} from "../../core/tests/acceptance-repo.ts";
import type { Ran } from "../../core/tests/acceptance-repo.ts";
import {
  ADVISORY,
  BASE,
  BLOCKING,
  MIXED,
  PATHS,
  RULE,
  TRY_RULE,
} from "./enforcement-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

const resultOf = (ran: Ran) => {
  const parsed = parseResult(json(ran));
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.error));
  }
  return parsed.value;
};

test("explicit rule policy changes the verdict while preserving native diagnostics", async () => {
  const engine = Bun.which("ast-grep");
  if (engine === null) {
    console.warn(
      "skipped: ast-grep is not on PATH, so the enforcement proof did not run"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    const join = (file: string) => path.join(main.root, file);
    await Promise.all(PATHS.map((file) => Bun.write(join(file), "{}\n")));
    await Bun.write(join("rope.toml"), BASE);
    const baseline = await runEntry(
      ROPE,
      ["check", ...PATHS, "--json"],
      main.root
    );
    expect(baseline.exitCode).toBe(1);
    const original = resultOf(baseline).steps.flatMap((step) => step.findings);
    expect(original).toHaveLength(2);
    expect(original[0]).toMatchObject({
      fixable: false,
      rule: RULE,
      severity: "error",
    });
    expect(original[0]?.enforcement).toBeUndefined();

    await Bun.write(join("rope.toml"), TRY_RULE);
    const before = await main.files();
    const advisory = await runEntry(
      ROPE,
      ["check", ...PATHS, "--json"],
      main.root
    );
    expect(advisory.exitCode).toBe(0);
    const tried = resultOf(advisory);
    expect(tried).toMatchObject({
      outcome: "clean",
      schemaVersion: SCHEMA_VERSION,
    });
    const matches = tried.steps.flatMap((step) => step.findings);
    expect(
      matches.map(({ enforcement: _policy, ...native }) => native)
    ).toEqual(original);
    expect(matches[0]?.enforcement).toEqual({
      level: "advisory",
      source: {
        file: "rope.toml",
        key: `rules.enforcement.${RULE}`,
        kind: "file",
      },
    });
    const text = await runEntry(ROPE, ["check", ...PATHS], main.root);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain(`error  ${RULE}`);
    expect(text.stdout).toContain("2 advisory");
    expect(text.stdout).toContain("No blocking findings. Exit code 0.");
    expect(await main.files()).toEqual(before);

    expect(parseResult({ ...tried, schemaVersion: 1 })).toEqual({
      error: { found: 1, kind: "unknown-version" },
      ok: false,
    });

    await Bun.write(join("rope.toml"), MIXED);
    const mixed = await runEntry(
      ROPE,
      ["check", ...PATHS, "--json"],
      main.root
    );
    expect(mixed.exitCode).toBe(1);
    const mixedResult = resultOf(mixed);
    const findings = mixedResult.steps.flatMap((step) => step.findings);
    expect(findings).toHaveLength(2);
    expect(
      findings.find((finding) => finding.path === ADVISORY)?.enforcement?.level
    ).toBe("advisory");
    expect(
      findings.find((finding) => finding.path === BLOCKING)?.enforcement
    ).toEqual({
      level: "blocking",
      source: {
        file: "rope.toml",
        key: `overrides.0.rules.enforcement.${RULE}`,
        kind: "file",
      },
    });
    const explained = await runEntry(
      ROPE,
      ["explain", ...PATHS, "--json"],
      main.root
    );
    const plan = parsePlan(json(explained));
    if (!plan.ok) {
      throw new Error(JSON.stringify(plan.error));
    }
    expect(plan.value).toEqual(mixedResult.plan);
    expect(
      plan.value.paths.find((entry) => entry.path === BLOCKING)?.policy
    ).toContainEqual({
      key: `rules.enforcement.${RULE}`,
      source: {
        file: "rope.toml",
        key: `overrides.0.rules.enforcement.${RULE}`,
        kind: "file",
      },
      value: "blocking",
    });
    const fix = await runEntry(
      ROPE,
      ["fix", ...PATHS, "--dry-run", "--json"],
      main.root
    );
    expect(fix.exitCode).toBe(1);
    expect(json(fix)).toMatchObject({ changed: [], diff: "", dryRun: true });

    const onlyEngine = join("only-engine");
    await mkdir(onlyEngine);
    await symlink(engine, path.join(onlyEngine, "ast-grep"));
    await Bun.write(join("data.toml"), "answer = 42\n");
    await Bun.write(
      join("rope.toml"),
      MIXED.replace(
        'include = ["**/tsconfig.json"]',
        'include = ["**/tsconfig.json", "*.toml"]'
      ).replace("[toml]\nenabled = false", "[toml]\nenabled = true")
    );
    const incomplete = await runEntry(
      ROPE,
      ["check", ...PATHS, "data.toml", "--json"],
      main.root,
      onlyEngine
    );
    expect(incomplete.exitCode).toBe(2);
    const missing = resultOf(incomplete);
    expect(missing.outcome).toBe("incomplete");
    expect(missing.steps.flatMap((step) => step.findings)).toHaveLength(2);
    expect(missing.steps.some((step) => step.status === "incomplete")).toBe(
      true
    );

    await Bun.write(
      join("rope.toml"),
      `${MIXED}
[[overrides]]
paths = ["packages/blocking/**"]
[overrides.rules.enforcement]
"${RULE}" = "advisory"
`
    );
    const later = await runEntry(
      ROPE,
      ["check", ...PATHS, "--json"],
      main.root
    );
    expect(later.exitCode).toBe(0);
    expect(
      resultOf(later)
        .steps.flatMap((step) => step.findings)
        .find((finding) => finding.path === BLOCKING)?.enforcement?.source
    ).toMatchObject({ key: `overrides.1.rules.enforcement.${RULE}` });

    const unused = join("unused-engine/ast-grep");
    const marker = join("probed");
    await Bun.write(
      unused,
      `#!/bin/sh\necho called > ${JSON.stringify(marker)}\nexit 1\n`
    );
    await chmod(unused, 0o755);
    await Bun.write(
      join("rope.toml"),
      TRY_RULE.replace('packs = ["config"]', "packs = []")
    );
    const unadopted = await runEntry(
      ROPE,
      ["check", ...PATHS, "--json"],
      main.root,
      path.dirname(unused)
    );
    expect(unadopted.exitCode).toBe(0);
    expect(resultOf(unadopted).steps).toEqual([]);
    expect(await Bun.file(marker).exists()).toBe(false);

    await Bun.write(
      join("rope.toml"),
      TRY_RULE.replace(RULE, "config/misspelled")
    );
    const typo = await runEntry(ROPE, ["check", ...PATHS, "--json"], main.root);
    expect(typo.exitCode).toBe(2);
    expect(typo.stderr).toContain("config/misspelled");
  });
}, 30_000);
