import { expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import path from "node:path";

import { parsePlan, parseResult, trace } from "@ropes/core";

import {
  json,
  runEntry,
  withFixture,
} from "../../core/tests/acceptance-repo.ts";
import { FILES, PATHS, RATIONALE } from "./trace-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

test("trace predicts the local convention's check without starting the engine", async () => {
  const engine = Bun.which("ast-grep");
  if (engine === null) {
    console.warn(
      "skipped: ast-grep is not on PATH, so the trace/check proof did not run"
    );
    return;
  }
  await withFixture(async ({ main, emptyPath }) => {
    await Promise.all(
      Object.entries(FILES).map(([file, text]) =>
        Bun.write(path.join(main.root, file), text)
      )
    );
    const log = path.join(main.root, "../engine.log");
    const wrapper = path.join(main.root, "bin/ast-grep");
    await Bun.write(
      wrapper,
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const child = Bun.spawn([${JSON.stringify(engine)}, ...args], { stdout: "inherit", stderr: "inherit" });
process.exit(await child.exited);
`
    );
    await chmod(wrapper, 0o755);
    const searchPath = [path.dirname(wrapper), process.env.PATH].join(
      path.delimiter
    );
    const before = await main.files();
    const normal = await runEntry(
      ROPE,
      ["explain", ...PATHS, "--json"],
      main.root,
      searchPath
    );
    const traced = await runEntry(
      ROPE,
      ["explain", ...PATHS, "--trace", "--json"],
      main.root,
      searchPath
    );
    expect(traced.exitCode).toBe(0);
    expect(await Bun.file(log).exists()).toBe(false);
    expect(await main.files()).toEqual(before);
    const data = await trace({ cwd: main.root, paths: PATHS });
    if (!data.ok) {
      throw new Error(data.error);
    }
    const plan = parsePlan(json(normal));
    if (!plan.ok) {
      throw new Error(JSON.stringify(plan.error));
    }
    // The only difference is the PATH-resolved executable in the CLI subprocess.
    expect(json(traced)).toMatchObject({
      evidence: "planned",
      plan: plan.value,
      schemaVersion: plan.value.schemaVersion,
    });
    const excluded = data.value.plan.paths.find(
      (entry) => entry.path === "excluded/old.ts"
    );
    expect(excluded).toMatchObject({
      skipped: {
        reason: "excluded",
        source: { file: "rope.toml", key: "exclude" },
      },
      steps: [],
    });
    const overridden = data.value.plan.paths.find(
      (entry) => entry.path === "legacy/old.ts"
    );
    expect(overridden?.steps).toEqual([]);
    expect(overridden?.policy).toContainEqual({
      key: "rules.enabled",
      source: {
        file: "rope.toml",
        key: "overrides.0.rules.enabled",
        kind: "file",
      },
      value: false,
    });
    const inherited = data.value.plan.paths.find(
      (entry) => entry.path === "src/a file.ts"
    );
    expect(inherited?.policy).toContainEqual({
      key: "rules.enabled",
      source: { file: "rope.toml", key: "rules.enabled", kind: "file" },
      value: true,
    });
    const checked = await runEntry(
      ROPE,
      ["check", ...PATHS, "--json"],
      main.root,
      searchPath
    );
    expect(checked.exitCode).toBe(1);
    const parsed = parseResult(json(checked));
    if (!parsed.ok) {
      throw new Error(JSON.stringify(parsed.error));
    }
    expect(parsed.value.plan).toEqual(data.value.plan);
    expect(
      parsed.value.steps.flatMap((step) =>
        step.findings.map(({ path: file, rule }) => ({ path: file, rule }))
      )
    ).toEqual([{ path: "src/a file.ts", rule: "local/private-import" }]);
    const logged = await Bun.file(log).text();
    const commands = logged
      .trim()
      .split("\n")
      .map((line): unknown => JSON.parse(line));
    const expected = data.value.batches[0]?.description;
    if (expected === undefined || !expected.ok) {
      throw new Error("the adapter did not describe its invocation");
    }
    const [invocation] = expected.value.invocations;
    expect(invocation?.cwd).toBe(main.root);
    expect(commands).toContainEqual(invocation?.argv.slice(1));
    expect(expected.value.rules).toEqual(["local/private-import"]);
    expect(expected.value.sources).toEqual(["rules/private-import.yml"]);
    expect(invocation?.argv[3]).toContain(RATIONALE);
    const missing = await runEntry(
      ROPE,
      ["explain", ...PATHS, "--trace", "--json"],
      main.root,
      emptyPath
    );
    expect(missing.exitCode).toBe(0);
    expect(missing.stdout).toContain("ast-grep is not on PATH");
    expect(missing.stdout).toContain("local/private-import");
    const human = await runEntry(
      ROPE,
      ["explain", ...PATHS, "--trace"],
      main.root,
      emptyPath
    );
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("authored rule: rules/private-import.yml");
    expect(human.stdout).toContain("cwd:");
    expect(human.stdout).toContain("argv:");
  });
}, 30_000);
