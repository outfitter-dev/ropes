import { expect, test } from "bun:test";
import path from "node:path";

import type { Adapter } from "../src/adapters/adapter.ts";
import { rulesAdapter } from "../src/adapters/ast-grep/adapter.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { changeAt } from "../src/render/diff.ts";
import { runPlan } from "../src/runner/run.ts";
import { withFixture } from "./acceptance-repo.ts";

test("the conflict recheck honors the selected shipped rewrite", async () => {
  if (Bun.which("ast-grep") === null) {
    if (process.env.CI === "true") {
      throw new Error("The rewrite conflict proof requires ast-grep on PATH.");
    }
    console.warn(
      "skipped: ast-grep is required for the rewrite conflict proof"
    );
    return;
  }

  await withFixture(async ({ main }) => {
    const { root } = main;
    const file = "tsconfig.json";
    const initial = '{"compilerOptions":{"module":"esnext"}}\n';
    const contents = Bun.file(path.join(root, file));
    await Bun.write(contents, initial);
    const other: Adapter = {
      check: ({ paths }) =>
        Promise.resolve(
          paths.map((selected) => ({
            findings: [],
            path: selected,
            status: "passed",
          }))
        ),
      descriptor: {
        enabledBy: "format.enabled",
        extensions: [".json"],
        id: "formatter",
        platforms: ["darwin", "linux", "win32"],
        tool: "formatter",
        unit: "file",
        versionRange: "*",
        writes: true,
      },
      fix: async () => {
        expect(await contents.text()).toContain('"ESNext"');
        await Bun.write(contents, initial);
        return [{ findings: [], path: file, status: "fixed" }];
      },
      probe: () => Promise.resolve({ available: true, version: "1.0.0" }),
    };
    const { source } = DEFAULT_CONFIG.include;
    const adapters = [rulesAdapter(), other];
    const plan = resolvePlan({
      config: {
        ...DEFAULT_CONFIG,
        include: { source, value: ["**/*.json"] },
        rulesPacks: { source, value: ["config-spelling"] },
        settings: [
          { key: "rules.enabled", source, value: true },
          { key: "format.enabled", source, value: true },
        ],
      },
      descriptors: adapters.map((adapter) => adapter.descriptor),
      packages: [],
      paths: [file],
      present: [file],
      root,
      selection: { kind: "workspace" },
    });
    expect(plan.batches[0]).toMatchObject({
      adapter: "ast-grep",
      paths: [file],
      writes: true,
    });
    const fixed = await runPlan(plan, adapters, { changeAt, mode: "fix" });
    expect(fixed.outcome).toBe("findings");
    expect(fixed.conflicts).toHaveLength(1);
    expect(fixed.conflicts?.[0]).toMatchObject({
      path: file,
      reportedBy: "ast-grep",
      rewrittenBy: "formatter",
      rule: "config-spelling/tsconfig-module-esnext",
    });
    expect(await contents.text()).toBe(initial);
  });
});
