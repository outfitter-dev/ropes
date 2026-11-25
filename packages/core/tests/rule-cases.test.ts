import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Glob, YAML } from "bun";
import { z } from "zod";

const RULES = path.join(import.meta.dir, "..", "rules");
const CASES = path.join(import.meta.dir, "rules");
const ENGINE = "ast-grep";

/** A cases file, as `ast-grep test` reads it. */
const CasesSchema = z.strictObject({
  id: z.string().min(1),
  invalid: z.array(z.string()).min(1),
  valid: z.array(z.string()).min(1),
});

const listed = async (folder: string): Promise<string[]> => {
  const files = await Array.fromAsync(
    new Glob("*/*.yml").scan({ cwd: folder })
  );
  return files.toSorted();
};

test("every shipped rule has a case it passes and a case it reports", async () => {
  const rules = await listed(RULES);
  expect(await listed(CASES)).toEqual(rules);
  const texts = await Promise.all(
    rules.map((file) => Bun.file(path.join(CASES, file)).text())
  );
  for (const [index, file] of rules.entries()) {
    const cases = CasesSchema.parse(YAML.parse(texts[index] ?? ""));
    expect(cases.id).toBe(file.replace(/\.yml$/u, ""));
  }
});

test("on the real engine every rule passes its cases", async () => {
  if (Bun.which(ENGINE) === null) {
    console.warn(
      `skipped: ${ENGINE} is not on PATH, so no rule was run against its cases`
    );
    return;
  }
  const dir = await mkdtemp(path.join(tmpdir(), "ropes-rule-cases-"));
  try {
    // The engine reads every YAML file under a rules folder as a rule, so
    // the cases sit in a folder of their own and a config names both.
    const config = path.join(dir, "sgconfig.yml");
    await Bun.write(
      config,
      YAML.stringify({ ruleDirs: [RULES], testConfigs: [{ testDir: CASES }] })
    );
    const child = Bun.spawn(
      [ENGINE, "test", "--config", config, "--skip-snapshot-tests"],
      { stderr: "pipe", stdout: "pipe" }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ exitCode, stderr, stdout }).toMatchObject({ exitCode: 0 });
    const rules = await listed(RULES);
    expect(stdout).toContain(`${rules.length} passed; 0 failed`);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
