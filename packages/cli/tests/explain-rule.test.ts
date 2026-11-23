import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { explainRule, parseResult } from "@ropes/core";

import type { PolicyValue } from "../../cinch/src/contracts/plan.ts";
import {
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";
import { BASE as ENFORCEMENT } from "./enforcement-fixture.ts";
import { FILES, PATHS, RATIONALE } from "./trace-fixture.ts";

const CLI = new URL("../src/cli.ts", import.meta.url);

test("rule lookup retains inherited, overridden and excluded scope without running an engine", async () => {
  await withFixture(async ({ main, emptyPath }) => {
    await Promise.all(
      Object.entries(FILES).map(([file, text]) =>
        Bun.write(path.join(main.root, file), text)
      )
    );
    const before = await main.files();
    const index = await readFile(path.join(main.root, ".git/index"));
    const result = await explainRule({
      cwd: main.root,
      paths: PATHS,
      rule: "local/private-import",
      trace: true,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.value.rule).toMatchObject({
      id: "local/private-import",
      rationale: RATIONALE,
      source: "rules/private-import.yml",
    });
    expect(
      result.value.paths.map(({ path: entry, state }) => [entry.path, state])
    ).toEqual([
      ["excluded/old.ts", "excluded"],
      ["legacy/old.ts", "inactive"],
      ["src/a file.ts", "planned"],
      ["src/clean.ts", "planned"],
    ]);
    expect(result.value.paths[1]?.path.policy).toContainEqual({
      key: "rules.enabled",
      source: {
        file: "cinch.toml",
        key: "overrides.0.rules.enabled",
        kind: "file",
      },
      value: false,
    });
    const human = await runEntry(
      CLI,
      ["explain", "--rule", "local/private-import", ...PATHS],
      main.root,
      emptyPath
    );
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain(RATIONALE);
    expect(human.stdout).toContain("excluded/old.ts: excluded");
    const structured = await runEntry(
      CLI,
      [
        "explain",
        "--rule",
        "local/private-import",
        "--trace",
        "--json",
        ...PATHS,
      ],
      main.root,
      emptyPath
    );
    expect(structured.exitCode).toBe(0);
    expect(json(structured)).toMatchObject({
      evidence: "planned",
      rule: result.value.rule,
    });
    const workspace = await explainRule({
      cwd: main.root,
      paths: [],
      rule: "local/private-import",
    });
    expect(
      workspace.ok &&
        workspace.value.paths.some(
          ({ path: entry, state }) =>
            entry.path === "excluded/old.ts" && state === "excluded"
        )
    ).toBe(true);
    const narrowed = await explainRule({
      cwd: main.root,
      paths: ["src/clean.ts"],
      rule: "local/private-import",
    });
    expect(
      narrowed.ok && narrowed.value.paths.map(({ path: entry }) => entry.path)
    ).toEqual(["src/clean.ts"]);
    const unknown = await runEntry(
      CLI,
      ["explain", "--rule", "local/unknown", "--json"],
      main.root,
      emptyPath
    );
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain("No rule named");
    expect(await main.files()).toEqual(before);
    expect(await readFile(path.join(main.root, ".git/index"))).toEqual(index);
  });
});

test("rule lookup agrees with check input and describes an unadopted shipped rule", async () => {
  if (Bun.which("ast-grep") === null) {
    if (process.env.CI === "true") {
      throw new Error("The rule check proof requires ast-grep on PATH.");
    }
    console.warn(
      "skipped: ast-grep is required to compare rule lookup with a real check"
    );
    return;
  }
  await withFixture(async ({ main }) => {
    await Promise.all(
      Object.entries(FILES).map(([file, text]) =>
        Bun.write(path.join(main.root, file), text)
      )
    );
    const result = await explainRule({
      cwd: main.root,
      paths: PATHS,
      rule: "local/private-import",
    });
    const checked = await runEntry(
      CLI,
      ["check", ...PATHS, "--json"],
      main.root
    );
    expect(checked.exitCode).toBe(1);
    const parsed = parseResult(json(checked));
    if (!result.ok || !parsed.ok) {
      throw new Error("Expected valid rule explanation and check result");
    }
    const planned = result.value.paths
      .filter(({ state }) => state === "planned")
      .map(({ path: entry }) => entry.path);
    expect(
      parsed.value.plan.batches
        .filter(({ adapter }) => adapter === result.value.rule.adapter)
        .flatMap(({ paths }) => paths)
    ).toEqual(planned);
    const shipped = await explainRule({
      cwd: main.root,
      paths: [],
      rule: "config/tsconfig-extends",
    });
    if (!shipped.ok) {
      throw new Error(shipped.error);
    }
    expect(shipped.value.rule.source).toBe(
      "@ropes/core/rules/config/tsconfig-extends.yml"
    );
    expect(shipped.value.paths.every(({ state }) => state !== "planned")).toBe(
      true
    );
  });
});

test("a shipped rule lookup retains its effective UTC deadline and policy source", async () => {
  await withFixture(async ({ main, emptyPath }) => {
    await Bun.write(
      path.join(main.root, "cinch.toml"),
      `${ENFORCEMENT}
[rules.enforcement]
"config/tsconfig-extends" = "2027-01-01"
`
    );
    await Bun.write(path.join(main.root, "tsconfig.json"), "{}\n");
    const request = {
      cwd: main.root,
      paths: ["tsconfig.json"],
      rule: "config/tsconfig-extends",
    };
    const before = await explainRule({
      ...request,
      at: "2026-12-31T23:59:59.000Z",
    });
    const after = await explainRule({
      ...request,
      at: "2027-01-01T00:00:00.000Z",
    });
    if (!before.ok || !after.ok) {
      throw new Error("Expected deadline lookup to succeed");
    }
    expect(before.value.paths[0]?.state).toBe("planned");
    const expected: Omit<PolicyValue, "value"> = {
      blockingAt: "2027-01-01T00:00:00.000Z",
      key: "rules.enforcement.config/tsconfig-extends",
      source: {
        file: "cinch.toml",
        key: "rules.enforcement.config/tsconfig-extends",
        kind: "file",
      },
    };
    expect(before.value.paths[0]?.path.policy).toContainEqual({
      ...expected,
      value: "advisory",
    });
    expect(after.value.paths[0]?.path.policy).toContainEqual({
      ...expected,
      value: "blocking",
    });
    const human = await runEntry(
      CLI,
      ["explain", "--rule", request.rule, "--at", "2026-12-31T23:59:59.000Z"],
      main.root,
      emptyPath
    );
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("blocks at 2027-01-01T00:00:00.000Z");
  });
});
