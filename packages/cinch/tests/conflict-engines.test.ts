import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { bunFmtAdapter } from "../src/adapters/bun-fmt/adapter.ts";
import { whichLocal } from "../src/adapters/local.ts";
import { oxlintAdapter } from "../src/adapters/oxlint/adapter.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { changeAt } from "../src/render/diff.ts";
import { runPlan } from "../src/runner/run.ts";

const installed = whichLocal("oxlint") !== null && Bun.which("bun") !== null;

/** A rule that wants hexadecimal digits in capitals. The formatter lowers them. */
const RULES = JSON.stringify({
  plugins: ["unicorn"],
  rules: { "unicorn/number-literal-case": "error" },
});

const source = { kind: "default" } as const;

test("a real lint rule that the real formatter undoes is one conflict", async () => {
  if (!installed) {
    console.warn(
      "skipped: oxlint or bun is not installed, so the conflict between them was not run"
    );
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "cinch-cfe-"));
  try {
    await Bun.write(path.join(root, ".oxlintrc.json"), RULES);
    await Bun.write(path.join(root, "a.ts"), "export const mask = 0xabcdef;\n");
    await Bun.write(path.join(root, "b.ts"), "export const one = 1;\n");
    const adapters = [oxlintAdapter(), bunFmtAdapter()];
    const plan = resolvePlan({
      config: {
        ...DEFAULT_CONFIG,
        include: { source, value: ["**/*.ts"] },
        settings: [
          { key: "lint.enabled", source, value: true },
          { key: "format.enabled", source, value: true },
        ],
      },
      descriptors: adapters.map((adapter) => adapter.descriptor),
      packages: [],
      paths: ["a.ts", "b.ts"],
      root,
      selection: { kind: "workspace" },
    });
    const fix = () => runPlan(plan, adapters, { changeAt, mode: "fix" });
    const first = await fix();
    expect(first.conflicts).toHaveLength(1);
    expect(first.conflicts?.[0]).toMatchObject({
      path: "a.ts",
      rule: "unicorn(number-literal-case)",
    });
    expect(first.conflicts?.[0]?.diff).toContain(
      "-export const mask = 0xABCDEF;\n+export const mask = 0xabcdef;\n"
    );
    expect(first.outcome).toBe("findings");
    // Neither tool is run again to settle it, so the file is as it was.
    const text = await Bun.file(path.join(root, "a.ts")).text();
    expect(text).toBe("export const mask = 0xabcdef;\n");
    const second = await fix();
    expect(second.conflicts).toHaveLength(1);
    expect(await Bun.file(path.join(root, "a.ts")).text()).toBe(text);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
