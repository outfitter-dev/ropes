import { expect, test } from "bun:test";
import path from "node:path";

import { explainRule } from "@ropes/core";

import { runEntry, withFixture } from "../../cinch/tests/acceptance-repo.ts";

const CLI = new URL("../src/cli.ts", import.meta.url);
const CONFIG = `pilot = 0
include = ["**/*.ts", "**/tsconfig.json"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[rules]
enabled = true
local = ["rules"]
`;
const RULE = `id: no-debugger
language: typescript
severity: error
rule:
  pattern: debugger
`;

const needsEngine = (): boolean => {
  if (Bun.which("ast-grep") !== null) {
    return false;
  }
  if (process.env.CI === "true") {
    throw new Error("The native rule scope proof requires ast-grep on PATH.");
  }
  console.warn("skipped: ast-grep is required for the native rule scope proof");
  return true;
};

test("native glob objects and arbitrary metadata preserve local and unrelated rule lookups", async () => {
  await withFixture(async ({ main, emptyPath }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    await Bun.write(
      path.join(main.root, "src/nested/example.ts"),
      "debugger;\n"
    );
    await Bun.write(
      path.join(main.root, "rules/no-debugger.yml"),
      `${RULE}
files: null
ignores:
  - glob: '**/generated.ts'
    caseInsensitive: true
metadata:
  rationale:
    category: safety
`
    );
    const request = { cwd: main.root, paths: ["src/nested/example.ts"] };
    const local = await explainRule({ ...request, rule: "local/no-debugger" });
    if (!local.ok) {
      throw new Error(local.error);
    }
    expect(local.value.rule.files).toBeUndefined();
    expect(local.value.rule.ignores).toEqual([
      { caseInsensitive: true, glob: "**/generated.ts" },
    ]);
    expect(local.value.rule.metadata).toEqual({
      rationale: { category: "safety" },
    });
    expect(local.value.rule.rationale).toBeUndefined();
    expect(local.value.paths[0]?.state).toBe("planned");
    const shipped = await explainRule({
      ...request,
      rule: "config/tsconfig-extends",
    });
    expect(shipped.ok).toBe(true);
    const human = await runEntry(
      CLI,
      ["explain", "--rule", "local/no-debugger", "--trace", ...request.paths],
      main.root,
      emptyPath
    );
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("ast-grep is not on PATH");
    expect(human.stdout).toContain("Native ignores:");
    expect(human.stdout).toContain("No engine was started");

    await Bun.write(
      path.join(main.root, "rules/no-debugger.yml"),
      `${RULE}\nfiles: null\nignores: null\nmetadata: null\n`
    );
    const nullable = await explainRule({
      ...request,
      rule: "local/no-debugger",
    });
    expect(nullable.ok && nullable.value.rule).toMatchObject({
      id: "local/no-debugger",
    });
  });
});

test("native wildcard scopes stay with the engine while lookup reports literal argument coverage", async () => {
  if (needsEngine()) {
    return;
  }
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    await Bun.write(
      path.join(main.root, "src/nested/example.ts"),
      "debugger;\n"
    );
    const ruleFile = path.join(main.root, "rules/no-debugger.yml");
    await Bun.write(
      ruleFile,
      `${RULE}\nfiles: ['src/*.ts']\nmetadata: { rationale: 'Keep debugging local.' }\n`
    );
    const request = {
      cwd: main.root,
      paths: ["src/nested/example.ts"],
      rule: "local/no-debugger",
    };
    const included = await explainRule(request);
    expect(included.ok && included.value.paths[0]?.state).toBe("planned");
    expect(included.ok && included.value.rule.rationale).toBe(
      "Keep debugging local."
    );
    const found = await runEntry(
      CLI,
      ["check", ...request.paths, "--json"],
      main.root
    );
    expect(found.exitCode).toBe(1);
    expect(found.stdout).toContain('"rule": "local/no-debugger"');
    await Bun.write(ruleFile, `${RULE}\nignores: ['src/*.ts']\n`);
    const ignored = await explainRule(request);
    expect(ignored.ok && ignored.value.paths[0]?.state).toBe("planned");
    expect(ignored.ok && ignored.value.limitations.join(" ")).toContain(
      "evaluated by the engine"
    );
    const clean = await runEntry(
      CLI,
      ["check", ...request.paths, "--json"],
      main.root
    );
    expect(clean.exitCode).toBe(0);
  });
});

test("missing kept paths stay visible without being marked as literal engine arguments", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(
      path.join(main.root, "cinch.toml"),
      `${CONFIG.replace('local = ["rules"]\n', "")}\npacks = ["config"]\n[typescript]\npreset = true\n`
    );
    await Bun.write(path.join(main.root, "packages/ui/tsconfig.json"), "{}\n");
    const result = await explainRule({
      cwd: main.root,
      paths: [],
      rule: "config/tsconfig-extends",
      trace: true,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(
      result.value.paths.find(
        ({ path: entry }) => entry.path === "tsconfig.json"
      )?.state
    ).toBe("inactive");
    expect(
      result.value.paths.find(
        ({ path: entry }) => entry.path === "packages/ui/tsconfig.json"
      )?.state
    ).toBe("planned");
    const literalPaths = result.value.trace?.flatMap(({ description }) =>
      description.ok ? (description.value.paths ?? []) : []
    );
    expect(literalPaths).toContain("packages/ui/tsconfig.json");
    expect(literalPaths).not.toContain("tsconfig.json");
  });
});
