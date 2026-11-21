import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";

import { parseResult } from "@ropes/core";

import {
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";
import type { Ran } from "../../cinch/tests/acceptance-repo.ts";
import { BEFORE, CONFIG, packageAt, RULE } from "./compatibility-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);
const resultOf = (ran: Ran) => {
  const parsed = parseResult(json(ran));
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.error));
  }
  return parsed.value;
};

test("unresolved required target evidence stays incomplete and scoped", async () => {
  await withFixture(async ({ main, emptyPath }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    const known = await packageAt(main.root, "known", "^5.0.0");
    const ambiguous = await packageAt(main.root, "ambiguous", ">=4.9.0 <6.0.0");
    await Promise.all(
      [known, ambiguous].map((directory) =>
        Bun.write(path.join(directory, "index.ts"), BEFORE)
      )
    );
    const mixed = await runEntry(ROPE, ["check", "--json"], main.root);
    expect(mixed.exitCode).toBe(2);
    expect(
      resultOf(mixed)
        .steps.flatMap((step) => step.findings)
        .map(({ rule }) => rule)
    ).toContain(RULE);
    const unresolved = resultOf(mixed).plan.paths.find(
      (entry) => entry.path === "packages/ambiguous/index.ts"
    );
    expect(unresolved?.targets?.[0]).toMatchObject({
      decision: "unresolved",
      fact: { range: ">=4.9.0 <6.0.0", state: "declared" },
    });
    expect(unresolved?.steps[0]?.incomplete).toContain("spans 5.0.0");
    await Bun.write(
      path.join(ambiguous, "package.json"),
      JSON.stringify({ peerDependencies: { typescript: "catalog:" } })
    );
    const unsupported = resultOf(
      await runEntry(
        ROPE,
        ["check", "packages/ambiguous", "--json"],
        main.root,
        emptyPath
      )
    );
    expect(unsupported.steps[0]?.reason).toContain(
      "unsupported declared support range"
    );
    await Bun.write(path.join(ambiguous, "package.json"), "{");
    const malformed = await runEntry(
      ROPE,
      ["check", "packages/ambiguous", "--json"],
      main.root,
      emptyPath
    );
    expect(malformed.exitCode).toBe(2);
    expect(resultOf(malformed).steps[0]?.reason).toContain(
      "cannot read declared target"
    );
    const overridden = `${CONFIG}\n[[overrides]]\npaths = ["packages/ambiguous/**"]\n[overrides.rules]\nenabled = false\n`;
    await Bun.write(path.join(main.root, "cinch.toml"), overridden);
    const disabled = await runEntry(
      ROPE,
      ["check", "packages/ambiguous", "--json"],
      main.root,
      emptyPath
    );
    expect(disabled.exitCode).toBe(0);
    expect(
      resultOf(disabled).plan.paths.every(
        (entry) => entry.targets === undefined
      )
    ).toBe(true);
    await Bun.write(
      path.join(main.root, "cinch.toml"),
      CONFIG.replace(
        'exclude = ["**/node_modules/**"]',
        'exclude = ["**/node_modules/**", "packages/ambiguous/**"]'
      )
    );
    const excluded = await runEntry(
      ROPE,
      ["check", "packages/ambiguous/index.ts", "--json"],
      main.root,
      emptyPath
    );
    expect(excluded.exitCode).toBe(0);
    expect(resultOf(excluded).plan.paths[0]).toMatchObject({
      skipped: { reason: "excluded" },
      steps: [],
    });
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    await Bun.write(path.join(main.root, "index.ts"), BEFORE);
    await rm(path.join(main.root, "package.json"), { force: true });
    const missing = await runEntry(
      ROPE,
      ["check", "index.ts", "--json"],
      main.root,
      emptyPath
    );
    expect(missing.exitCode).toBe(2);
    expect(resultOf(missing).plan.paths[0]?.targets?.[0]).toMatchObject({
      decision: "unresolved",
      fact: { source: { file: "package.json" }, state: "unresolved" },
    });
  });
}, 30_000);

test("unsupported compiler diagnostics cannot claim a successful compatibility proof", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    const current = await packageAt(main.root, "current", "^5.0.0");
    await Bun.write(
      path.join(current, "index.ts"),
      'import * as ts from "typescript";\nexport type Legacy = ts.Map<string>;\n'
    );
    const ran = await runEntry(
      ROPE,
      ["check", "packages/current", "--json"],
      main.root
    );
    expect(ran.exitCode).toBe(2);
    const result = resultOf(ran);
    expect(result.steps[0]).toMatchObject({ status: "incomplete" });
    expect(result.steps[0]?.findings[0]?.rule).toBe("TS2694");
  });
});

test("compiler aliases cannot substitute another module for the API proof", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    const current = await packageAt(main.root, "current", "^5.0.0");
    await Bun.write(path.join(current, "index.ts"), BEFORE);
    await Bun.write(
      path.join(current, "fake.ts"),
      "export interface Map<T> { value: T }\n"
    );
    const verifyConfig = async (text: string, reason: string) => {
      await Bun.write(path.join(current, "tsconfig.json"), text);
      const ran = await runEntry(
        ROPE,
        ["check", "packages/current/index.ts", "--json"],
        main.root
      );
      expect(ran.exitCode).toBe(2);
      expect(resultOf(ran).steps[0]?.reason).toContain(reason);
    };
    await verifyConfig(
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
          paths: { typescript: ["./fake.ts"] },
        },
      }),
      "module-resolution overrides"
    );
    await verifyConfig(
      JSON.stringify({
        compilerOptions: { moduleResolution: "bundler" },
        extends: "./base.json",
      }),
      "without extends"
    );
    await verifyConfig(
      '{ // compiler config\n "compilerOptions": { "moduleResolution": "bundler" } }',
      "plain JSON"
    );
  });
});
