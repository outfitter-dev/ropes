import { expect, test } from "bun:test";

import { SCHEMA_VERSION } from "../src/contracts/plan.ts";
import { FINDINGS } from "./fake-adapter.ts";
import { BASE, CONFIG, planPaths, snapshot, withRepo } from "./repo-bench.ts";

test("check exits 0 when every step passes, and never asks an adapter to write", async () => {
  await withRepo(BASE, {}, async ({ adapter, root, run }) => {
    const before = await snapshot(root);
    const response = await run("check");
    expect(response.exitCode).toBe(0);
    expect(response.output).toContain("3 files selected, 2 steps ran");
    expect(adapter.calls).toEqual(["probe", "check"]);
    expect(await snapshot(root)).toEqual(before);
  });
});

test("check exits 1 when a finding remains", async () => {
  await withRepo(
    BASE,
    { check: () => Promise.resolve(FINDINGS) },
    async ({ run }) => {
      const response = await run("check", ["a.md"]);
      expect(response.exitCode).toBe(1);
      expect(response.output).toContain("fake/rule");
    }
  );
});

test("check exits 2 when the tool is missing, and says it is not a pass", async () => {
  await withRepo(
    BASE,
    { probe: () => Promise.resolve({ available: false, reason: "not here" }) },
    async ({ adapter, run }) => {
      const response = await run("check", ["a.md"]);
      expect(response.exitCode).toBe(2);
      expect(response.output).toContain("incomplete  fake: not here");
      expect(adapter.calls).toEqual(["probe"]);
    }
  );
});

test("the plan inside a check result is the plan explain prints", async () => {
  await withRepo(BASE, {}, async ({ run }) => {
    const [explained, checked] = await Promise.all([
      run("explain", ["docs", "a.md"], { json: true }),
      run("check", ["docs", "a.md"], { json: true }),
    ]);
    const result: unknown = JSON.parse(checked.output ?? "null");
    expect(result).toMatchObject({
      outcome: "clean",
      schemaVersion: SCHEMA_VERSION,
    });
    expect(result).toHaveProperty("plan", JSON.parse(explained.output ?? ""));
  });
});

test("explain shows policy, origin, steps and the root without running a step", async () => {
  await withRepo(BASE, {}, async ({ adapter, root, run }) => {
    const response = await run("explain", ["a.md"]);
    expect(response.exitCode).toBe(0);
    expect(response.output).toBe(
      [
        `Root: ${root}\nConfig: rope.toml`,
        "a.md\n  package: the workspace\n  policy\n    markdown.enabled = true  (default)\n    toml.enabled = true  (default)\n  steps\n    fake  fake-tool *  checks and fixes",
        "Tools\n  fake-tool  available, needs *",
        "1 file, 1 step planned in 1 batch. Nothing was run.",
      ].join("\n\n")
    );
    expect(adapter.calls).toEqual(["probe"]);
  });
});

test("explain still shows the whole plan when the tool is missing", async () => {
  await withRepo(
    BASE,
    { probe: () => Promise.resolve({ available: false, reason: "not here" }) },
    async ({ run }) => {
      const response = await run("explain");
      expect(response.exitCode).toBe(0);
      expect(response.output).toContain("fake-tool  unavailable: not here");
      expect(response.output).toContain("3 files, 2 steps planned");
    }
  );
});

test("an override shows up in explain with the key that set it", async () => {
  const tree = {
    ...BASE,
    "rope.toml": `${CONFIG}\n[[overrides]]\npaths = ["docs/**"]\n[overrides.markdown]\nenabled = false\n`,
  };
  await withRepo(tree, {}, async ({ adapter, run }) => {
    const explained = await run("explain", ["docs/b.md"]);
    expect(explained.output).toContain(
      "markdown.enabled = false  (rope.toml: overrides.0.markdown.enabled)"
    );
    expect(explained.output).toContain("no step applies to this file");
    await run("check", ["docs/b.md"]);
    expect(adapter.calls).not.toContain("check");
  });
});

test("a kept file joins the workspace before it exists, and only the workspace", async () => {
  const keeps = { descriptor: { extensions: [], owns: [".kept.toml"] } };
  await withRepo(BASE, keeps, async ({ run }) => {
    const all = await run("explain", [], { json: true });
    expect(planPaths(all)).toEqual([
      ".kept.toml",
      "a.md",
      "docs/b.md",
      "rope.toml",
    ]);
    const named = await run("explain", ["a.md"], { json: true });
    expect(planPaths(named)).toEqual(["a.md"]);
  });
});
