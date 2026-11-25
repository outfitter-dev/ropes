import { expect, test } from "bun:test";
import { link, unlink } from "node:fs/promises";
import path from "node:path";

import { FixReportSchema } from "../../cinch/src/contracts/fix.ts";
import { ResultSchema } from "../../cinch/src/contracts/result.ts";
import {
  fixtureGit,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";

const CLI = new URL("../src/cli.ts", import.meta.url);
const RULE = "config-spelling/tsconfig-module-esnext";
const BEFORE = '{"compilerOptions":{"module":"esnext","target":"es2022"}}\n';
const AFTER = BEFORE.replace('"esnext"', '"ESNext"');
const CONFIG = `pilot = 0
include = ["**/tsconfig.json"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[rules]
enabled = true
local = ["rules"]
`;

test("only the adopted shipped rewrite can change a selected file", async () => {
  if (Bun.which("ast-grep") === null) {
    if (process.env.CI === "true") {
      throw new Error("The native rewrite proof requires ast-grep on PATH.");
    }
    console.warn("skipped: ast-grep is required for the native rewrite proof");
    return;
  }

  await withFixture(async ({ main }) => {
    const { root } = main;
    const selected = Bun.file(path.join(root, "tsconfig.json"));
    const unselected = Bun.file(path.join(root, "nested/tsconfig.json"));
    const policy = Bun.file(path.join(root, "rope.toml"));
    await Promise.all([
      Bun.write(policy, CONFIG),
      Bun.write(selected, BEFORE),
      Bun.write(unselected, BEFORE),
      Bun.write(path.join(root, "sgconfig.yml"), "ruleDirs: [rules]\n"),
      Bun.write(
        path.join(root, "rules/local-spelling.yml"),
        `id: local-spelling
language: JSON
severity: error
message: Local target spelling.
rule:
  pattern: '"es2022"'
fix: '"ES2022"'
`
      ),
    ]);
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "rewrite fixture");

    const run = (...args: string[]) =>
      runEntry(CLI, [...args, "tsconfig.json", "--json"], root);
    const unadopted = await run("fix");
    expect(unadopted.stderr).toBe("");
    expect(FixReportSchema.parse(JSON.parse(unadopted.stdout))).toMatchObject({
      changed: [],
    });
    expect(await selected.text()).toBe(BEFORE);

    const adoption = await runEntry(
      CLI,
      ["rules", "adopt", "config-spelling", "--yes"],
      root
    );
    expect(adoption.exitCode).toBe(0);
    const check = await run("check");
    expect(check.exitCode).toBe(1);
    const observed = ResultSchema.parse(JSON.parse(check.stdout));
    const findings = observed.steps.flatMap((step) => step.findings);
    expect(findings.find((finding) => finding.rule === RULE)?.fixable).toBe(
      true
    );
    expect(
      findings.find((finding) => finding.rule === "local/local-spelling")
        ?.fixable
    ).toBe(false);

    const preview = await run("fix", "--dry-run");
    const proposed = FixReportSchema.parse(JSON.parse(preview.stdout));
    expect(proposed).toMatchObject({
      changed: ["tsconfig.json"],
      dryRun: true,
    });
    expect(proposed.diff).toContain(`+${AFTER.trimEnd()}`);
    expect(await selected.text()).toBe(BEFORE);
    await fixtureGit(root, "diff", "--cached", "--quiet");

    const result = await run("fix");
    expect(FixReportSchema.parse(JSON.parse(result.stdout))).toMatchObject({
      changed: ["tsconfig.json"],
      diff: proposed.diff,
    });
    expect(result.stdout).toContain("local/local-spelling");
    expect(result.stdout).not.toContain('"fixable": true');
    expect(await selected.text()).toBe(AFTER);
    expect(await unselected.text()).toBe(BEFORE);
    const repeated = await run("fix");
    expect(FixReportSchema.parse(JSON.parse(repeated.stdout))).toMatchObject({
      changed: [],
      diff: "",
    });

    await Bun.write(selected, BEFORE);
    const alias = path.join(root, "tsconfig-alias.json");
    await link(path.join(root, "tsconfig.json"), alias);
    const linkedPreview = await run("fix", "--dry-run");
    const linkedApply = await run("fix");
    expect(linkedPreview.exitCode).toBe(2);
    expect(linkedApply.exitCode).toBe(2);
    for (const attempt of [linkedPreview, linkedApply]) {
      expect(FixReportSchema.parse(JSON.parse(attempt.stdout))).toMatchObject({
        changed: [],
        diff: "",
      });
      expect(attempt.stdout).toContain("expected a regular file without links");
    }
    expect(await Bun.file(alias).text()).toBe(BEFORE);
    expect(await selected.text()).toBe(BEFORE);

    await unlink(alias);
    const adopted = await policy.text();
    await Bun.write(policy, `${adopted.trimEnd()}\noff = ["${RULE}"]\n`);
    const disabled = await run("fix");
    expect(FixReportSchema.parse(JSON.parse(disabled.stdout))).toMatchObject({
      changed: [],
    });
    expect(await selected.text()).toBe(BEFORE);
  });
});
