import { expect, test } from "bun:test";
import { chmod, mkdir, symlink } from "node:fs/promises";
import path from "node:path";

import { parsePlan, parseResult } from "@ropes/core";

import {
  fixtureGit,
  json,
  runEntry,
  withFixture,
} from "../../core/tests/acceptance-repo.ts";
import type { Ran } from "../../core/tests/acceptance-repo.ts";
import {
  AFTER,
  apiPackage,
  BEFORE,
  CONFIG,
  packageAt,
  RULE,
} from "./compatibility-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);
const resultOf = (ran: Ran) => {
  const parsed = parseResult(json(ran));
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.error));
  }
  return parsed.value;
};

test("compiler API compatibility follows declared package support and native symbol identity", async () => {
  await withFixture(async ({ main, emptyPath }) => {
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    await Bun.write(
      path.join(main.root, "package.json"),
      JSON.stringify({ peerDependencies: { typescript: "^5.0.0" } })
    );
    const old = await packageAt(main.root, "old", "^4.9.0", "4-9");
    const current = await packageAt(main.root, "current", "^5.0.0");
    const inherited = await packageAt(main.root, "inherited", null);
    await Bun.write(
      path.join(inherited, "package.json"),
      JSON.stringify({ ropes: { inheritTargets: ["typescript"] } })
    );
    const absent = await packageAt(main.root, "absent", null);
    await Promise.all(
      [old, current, inherited, absent].map((directory) =>
        Bun.write(path.join(directory, "index.ts"), BEFORE)
      )
    );
    await Bun.write(
      path.join(current, "unrelated.ts"),
      "export interface Map<T> { value: T }\n"
    );
    await Bun.write(
      path.join(current, "local.ts"),
      'import type { Map as LegacyMap } from "./unrelated";\nexport type Local = LegacyMap<string>;\n'
    );
    await Bun.write(
      path.join(current, "namespace.ts"),
      "namespace ts { export interface Map<T> { value: T } }\nexport type Local = ts.Map<string>;\n"
    );
    await Bun.write(
      path.join(main.root, "rope.toml"),
      `${CONFIG.replace("[rules]\nenabled = true", "[rules]\nenabled = false")}\n[typescript]\nenabled = true\n`
    );
    const native = resultOf(
      await runEntry(
        ROPE,
        [
          "check",
          "packages/old/index.ts",
          "packages/current/index.ts",
          "--json",
        ],
        main.root
      )
    );
    expect(
      native.steps
        .flatMap((step) => step.findings)
        .map(({ path: file, rule }) => ({ path: file, rule }))
    ).toEqual([
      {
        path: "packages/current/index.ts",
        rule: "TS2305",
      },
    ]);
    await Bun.write(path.join(main.root, "rope.toml"), CONFIG);
    await Bun.write(path.join(main.root, ".gitignore"), "**/node_modules/\n");
    await fixtureGit(main.root, "add", "--all");
    await fixtureGit(
      main.root,
      "commit",
      "--quiet",
      "--message",
      "record declared compatibility support"
    );
    const before = await main.files();
    const checked = await runEntry(ROPE, ["check", "--json"], main.root);
    expect(
      resultOf(checked)
        .steps.filter((step) => step.status === "incomplete")
        .map(({ reason }) => reason)
    ).toEqual([]);
    expect(checked.exitCode).toBe(1);
    const result = resultOf(checked);
    const findings = result.steps.flatMap((step) => step.findings);
    expect(findings.map((finding) => finding.path)).toEqual([
      "packages/current/index.ts",
      "packages/inherited/index.ts",
    ]);
    expect(
      findings.every(
        (finding) => finding.rule === RULE && finding.nativeRule === "TS2305"
      )
    ).toBe(true);
    expect(findings[0]).toMatchObject({
      fixable: false,
      message: "Module '\"typescript\"' has no exported member 'Map'.",
      severity: "error",
    });
    const oldPlan = result.plan.paths.find(
      (entry) => entry.path === "packages/old/index.ts"
    );
    expect(oldPlan?.steps).toEqual([]);
    expect(oldPlan?.targets?.[0]).toMatchObject({
      decision: "inapplicable",
      fact: {
        range: "^4.9.0",
        source: {
          file: "packages/old/package.json",
          key: "peerDependencies.typescript",
        },
      },
    });
    expect(
      result.plan.paths.find(
        (entry) => entry.path === "packages/inherited/index.ts"
      )?.targets?.[0]
    ).toMatchObject({
      decision: "applicable",
      fact: {
        inheritedBy: { file: "packages/inherited/package.json" },
        package: "packages/inherited",
        source: { file: "package.json" },
      },
    });
    expect(
      result.plan.paths.find(
        (entry) => entry.path === "packages/absent/index.ts"
      )?.targets?.[0]
    ).toMatchObject({ decision: "inapplicable", fact: { state: "absent" } });
    const explained = parsePlan(
      json(await runEntry(ROPE, ["explain", "--json"], main.root))
    );
    expect(explained).toEqual({ ok: true, value: result.plan });
    const text = await runEntry(
      ROPE,
      ["explain", "packages/old/index.ts"],
      main.root
    );
    expect(text.stdout).toContain("inapplicable");
    expect(text.stdout).toContain("peerDependencies.typescript");
    const onlyNew = resultOf(
      await runEntry(ROPE, ["check", "packages/current", "--json"], main.root)
    );
    expect(onlyNew.steps.flatMap((step) => step.findings)).toEqual(
      findings.filter((finding) => finding.path.startsWith("packages/current/"))
    );
    expect(
      onlyNew.plan.paths.every((entry) => entry.package === "packages/current")
    ).toBe(true);
    expect(await main.files()).toEqual(before);
    const missing = await runEntry(
      ROPE,
      ["check", "packages/current", "--json"],
      main.root,
      emptyPath
    );
    expect(missing.exitCode).toBe(2);
    expect(resultOf(missing).outcome).toBe("incomplete");
    const oldWithoutEngine = await runEntry(
      ROPE,
      ["check", "packages/old", "--json"],
      main.root,
      emptyPath
    );
    expect(oldWithoutEngine.exitCode).toBe(0);
    const tools = path.join(main.root, "tools");
    await mkdir(tools);
    await symlink(process.execPath, path.join(tools, "bun"));
    const tsc = path.join(tools, "tsc");
    await Bun.write(tsc, "#!/bin/sh\nprintf 'Version 99.0.0\\n'\n");
    await chmod(tsc, 0o755);
    const withNewerExecutable = resultOf(
      await runEntry(
        ROPE,
        ["check", "packages/current", "--json"],
        main.root,
        tools
      )
    );
    expect(withNewerExecutable).toEqual(onlyNew);
    await Bun.write(path.join(current, "index.ts"), AFTER);
    const fixed = await runEntry(
      ROPE,
      ["check", "packages/current", "--json"],
      main.root
    );
    expect(fixed.exitCode).toBe(0);
    await apiPackage(current, "4-9");
    const mismatched = await runEntry(
      ROPE,
      ["check", "packages/current", "--json"],
      main.root
    );
    expect(mismatched.exitCode).toBe(2);
    expect(resultOf(mismatched).steps[0]?.reason).toContain(
      "resolved TypeScript API 4.9.5 does not satisfy"
    );
  });
}, 30_000);
