import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Glob } from "bun";

import {
  rulesAdapter,
  SUPPORTED_RANGE,
} from "../src/adapters/ast-grep/adapter.ts";
import { parseOutput } from "../src/adapters/ast-grep/output.ts";
import { shippedRules } from "../src/adapters/ast-grep/rules.ts";
import { shippedFolder } from "../src/adapters/shipped-text.ts";
import { checkOne } from "./one-file.ts";

const RULES = path.join(import.meta.dir, "..", "rules");
const ENGINE = "ast-grep";

test("the adapter is off until asked for, defaults to read-only, and follows the pin", () => {
  expect(rulesAdapter().descriptor).toMatchObject({
    enabledBy: "rules.enabled",
    optIn: true,
    tool: ENGINE,
    versionRange: SUPPORTED_RANGE,
    writes: false,
  });
  // A pin keeps the tested range beside it, so a run outside CI can accept
  // a newer engine inside that range.
  expect(rulesAdapter({ version: "0.51.3" }).descriptor).toMatchObject({
    tested: SUPPORTED_RANGE,
    versionRange: "0.51.3",
  });
});

test("a shipped folder is read where its path has a space in it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ropes shipped "));
  try {
    await Bun.write(path.join(dir, "pack", "rule.yml"), "id: pack/rule\n");
    const files = await shippedFolder(pathToFileURL(`${dir}/`));
    expect([...files]).toEqual([["pack/rule.yml", "id: pack/rule\n"]]);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("every shipped rule is named for its pack and says what is wrong", async () => {
  const files = await Array.fromAsync(
    new Glob("**/*.yml").scan({ cwd: RULES })
  );
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const [pack, name] = file.split("/");
    // eslint-disable-next-line no-await-in-loop
    const text = await Bun.file(path.join(RULES, file)).text();
    expect(text).toContain(`id: ${pack}/${name?.replace(/\.yml$/u, "")}\n`);
    expect(text).toMatch(/^severity: (?:error|warning)$/mu);
    expect(text).toMatch(/^message: \S.*\.$/mu);
  }
  const shipped = shippedRules();
  expect(shipped.split("\n---\n")).toHaveLength(files.length);
});

test("matches become findings with one-based places, filed by path", () => {
  const match = {
    file: "a/tsconfig.json",
    message: "m",
    range: { end: { column: 0, line: 1 }, start: { column: 0, line: 0 } },
    ruleId: "config/x",
    severity: "error",
  };
  const parsed = parseOutput(
    JSON.stringify([match, { ...match, severity: "hint" }]),
    ENGINE
  );
  expect(parsed.ok && parsed.files.get("a/tsconfig.json")).toEqual([
    {
      fixable: false,
      message: "m",
      path: "a/tsconfig.json",
      range: { end: { column: 1, line: 2 }, start: { column: 1, line: 1 } },
      rule: "config/x",
      severity: "error",
      source: ENGINE,
    },
    expect.objectContaining({ severity: "warning" }),
  ]);
});

test("output that is not the expected JSON is refused", () => {
  expect(parseOutput("Error: nope", ENGINE)).toEqual({
    message: "its output was not JSON",
    ok: false,
  });
  expect(parseOutput('[{"file":"a"}]', ENGINE).ok).toBe(false);
});

test("a command that is not on PATH is not available, and its steps are incomplete", async () => {
  const adapter = rulesAdapter({ command: "ropes-no-such-engine" });
  const probed = await adapter.probe();
  expect(probed.available).toBe(false);
  const outcome = await checkOne(adapter, { path: "tsconfig.json", root: "." });
  expect(outcome).toEqual({
    findings: [],
    reason: "ropes-no-such-engine is not on PATH",
    status: "incomplete",
  });
});

test("on the real engine a compiler config that builds on nothing is a finding", async () => {
  if (Bun.which(ENGINE) === null) {
    console.warn(
      `skipped: ${ENGINE} is not on PATH, so the shipped rules did not run against it`
    );
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "ropes-rules-"));
  try {
    const check = async (file: string, text: string) => {
      await Bun.write(path.join(root, file), text);
      const outcome = await checkOne(rulesAdapter(), { path: file, root });
      return [
        outcome.status,
        ...outcome.findings.map(
          ({ range, rule }) => `${range.start.line} ${rule}`
        ),
      ];
    };
    expect(await check("tsconfig.json", '{ "compilerOptions": {} }\n')).toEqual(
      ["findings", "1 config/tsconfig-extends"]
    );
    // The kept preset extends nothing. The rule skips both managed directories.
    const base = '{ "compilerOptions": {} }\n';
    expect(await check(".ropes/configs/presets/tsconfig.json", base)).toEqual([
      "passed",
    ]);
    expect(
      await check(".outfitter/configs/presets/tsconfig.json", base)
    ).toEqual(["passed"]);
    expect(
      await check("pkg/tsconfig.json", '{ "extends": "../base.json" }\n')
    ).toEqual(["passed"]);
    // An `extends` deeper in the file is some other setting.
    expect(
      await check(
        "deep/tsconfig.json",
        '{ "compilerOptions": { "paths": { "extends": ["./src"] } } }\n'
      )
    ).toEqual(["findings", "1 config/tsconfig-extends"]);
    expect(await check("other.json", '{ "compilerOptions": {} }\n')).toEqual([
      "passed",
    ]);
    expect(
      await checkOne(rulesAdapter(), { path: "missing.json", root })
    ).toEqual({ findings: [], status: "passed" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
