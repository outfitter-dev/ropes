import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { parsePlan } from "@ropes/core";

import { loadConfig } from "../../cinch/src/config/load.ts";
import { RulesAdoptReportSchema } from "../../cinch/src/contracts/rules-report.ts";
import {
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";
import { BEFORE, CONFIG, packageAt } from "./compatibility-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);

test("the compatibility pilot requires adoption by name through init and bulk adoption", async () => {
  await withFixture(async ({ main }) => {
    await rm(path.join(main.root, "cinch.toml"));
    await Bun.write(path.join(main.root, "example.ts"), "export {};\n");
    await runEntry(ROPE, ["init", "--yes", "--json"], main.root);
    const starter = await loadConfig(main.root);
    expect(starter.ok).toBe(true);
    if (starter.ok) {
      expect(starter.value.rulesPacks?.value ?? []).not.toContain(
        "typescript-api"
      );
    }
    const bulk = RulesAdoptReportSchema.parse(
      json(
        await runEntry(ROPE, ["rules", "adopt", "--yes", "--json"], main.root)
      )
    );
    expect(bulk.adopted).not.toContain("typescript-api");
    const named = RulesAdoptReportSchema.parse(
      json(
        await runEntry(
          ROPE,
          ["rules", "adopt", "typescript-api", "--yes", "--json"],
          main.root
        )
      )
    );
    expect(named.adopted).toContain("typescript-api");
    const adopted = await loadConfig(main.root);
    expect(
      adopted.ok && adopted.value.rulesPacks?.value.includes("typescript-api")
    ).toBe(true);
  });
}, 30_000);

test("manifest evidence hashes its raw BOM bytes and unresolved explanations leave tools unprobed", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    const directory = await packageAt(main.root, "current", "^5.0.0");
    await Bun.write(path.join(directory, "index.ts"), BEFORE);
    const manifest = path.join(directory, "package.json");
    await Bun.write(
      manifest,
      `\uFEFF${JSON.stringify({ peerDependencies: { typescript: "^5.0.0" } })}`
    );
    const explained = parsePlan(
      json(
        await runEntry(
          ROPE,
          ["explain", "packages/current/index.ts", "--json"],
          main.root
        )
      )
    );
    expect(explained.ok).toBe(true);
    if (explained.ok) {
      const bytes = await Bun.file(manifest).bytes();
      expect(explained.value.paths[0]?.targets?.[0]?.fact?.source.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex")
      );
    }
    await Bun.write(
      manifest,
      JSON.stringify({ peerDependencies: { typescript: ">=4.9 <6" } })
    );
    const tools = path.join(main.root, "tools");
    const marker = path.join(main.root, "probed");
    await mkdir(tools);
    const fake = path.join(tools, "bun");
    await Bun.write(
      fake,
      `#!/bin/sh\nprintf called > '${marker}'\nprintf '1.4.4\\n'\n`
    );
    await chmod(fake, 0o755);
    const human = await runEntry(
      ROPE,
      ["explain", "packages/current/index.ts"],
      main.root,
      tools
    );
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("unresolved");
    expect(await Bun.file(marker).exists()).toBe(false);
  });
});
