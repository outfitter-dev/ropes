import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import path from "node:path";

import { rumdlPresetAdapter } from "../src/adapters/rumdl/preset.ts";
import { runDoctor } from "../src/commands/doctor.ts";
import { runWrite } from "../src/commands/fix.ts";
import { prepare } from "../src/commands/prepare.ts";
import { parseConfigTable } from "../src/config/parse.ts";
import { comparePolicy } from "../src/policy/compare-policy.ts";
import { policySnapshot } from "../src/policy/policy-snapshot.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { withFixture } from "./acceptance-repo.ts";
import { describeFake, fakeAdapter } from "./fake-adapter.ts";
import { BASE, withRepo } from "./repo-bench.ts";

const ROOT_POLICY =
  'pilot = 0\n[delegates.other]\npaths = ["vendor/**"]\nconfig = [".rumdl.toml"]\n[tools.rumdl.MD013]\nline_length = 100\n';

for (const connected of [false, true]) {
  test(`a protected root ${connected ? "accepts its existing" : "rejects a disconnected"} generated settings connection without running an engine`, async () => {
    await withRepo(
      {
        ...BASE,
        ".rumdl.toml": connected
          ? 'extends = ".ropes/configs/rumdl.toml"\n[global]\nline-length = 100\n'
          : "[global]\nline-length = 80\n",
        "rope.toml": ROOT_POLICY,
      },
      {},
      async ({ root }) => {
        const preset = rumdlPresetAdapter({
          managedDir: ".ropes/configs",
          table: { MD013: { line_length: 100 } },
        });
        const deps = {
          adapters: () => [
            {
              ...preset,
              check: () => {
                throw new Error("a check must not run while explaining");
              },
              probe: () => {
                throw new Error("a probe must not run while explaining");
              },
            },
          ],
        };
        const prepared = await prepare({ cwd: root, paths: ["a.md"] }, deps);
        expect(prepared.ok).toBe(connected);
        if (!prepared.ok) {
          expect(prepared.error).toContain(
            "protected root config cannot be verified"
          );
        }
        expect(await Bun.file(path.join(root, ".rumdl.toml")).text()).toContain(
          connected
            ? 'extends = ".ropes/configs/rumdl.toml"'
            : "line-length = 80"
        );
      }
    );
  });
}

test("delegated reporters match their policy domain when tools share an executable", () => {
  const parsed = parseConfigTable(
    {
      delegates: { shared: { domains: ["typescript"], paths: ["src/**"] } },
      format: { enabled: false },
      pilot: 0,
    },
    { file: "rope.toml", prefix: "" }
  );
  if (!parsed.ok) {
    throw new Error("invalid fixture");
  }
  const typecheck = describeFake({
    enabledBy: "typescript.enabled",
    extensions: [".ts"],
    id: "types",
    reports: ["line_width"],
    tool: "shared",
  });
  const formatter = describeFake({
    enabledBy: "format.enabled",
    extensions: [".ts"],
    id: "formatter",
    reports: ["line_width"],
    tool: "shared",
  });
  const plan = resolvePlan({
    config: parsed.value,
    descriptors: [typecheck, formatter],
    packages: [],
    paths: ["src/a.ts"],
    root: "/repo",
    selection: { kind: "workspace" },
  });
  expect(plan.facts?.reporters.map(({ adapter }) => adapter)).toEqual([
    "types",
  ]);
});

test("setup repair does not require a tool used only for a delegated facts comparison", async () => {
  await withRepo(
    {
      ...BASE,
      "rope.toml": 'pilot = 0\n[delegates.other]\npaths = ["**/*.md"]\n',
    },
    {},
    async ({ root }) => {
      const adapter = fakeAdapter({
        descriptor: { reports: ["line_width"], tool: "other" },
        facts: () => {
          throw new Error("settings are not compared during repair");
        },
        probe: () =>
          Promise.resolve({ available: false, reason: "not installed" }),
      });
      const repaired = await runDoctor(
        { cwd: root, fix: true, paths: [] },
        { adapters: () => [adapter] }
      );
      expect(repaired.ok).toBe(true);
      if (repaired.ok) {
        expect(repaired.value.tools).toEqual([]);
      }
      expect(adapter.calls).toEqual([]);
    }
  );
});

test("a fix preview retains ignored delegated configs and their symlink targets", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(
      path.join(main.root, ".gitignore"),
      ".other.toml\nprivate-settings.toml\n"
    );
    await Bun.write(
      path.join(main.root, "private-settings.toml"),
      "line_width = 80\n"
    );
    await symlink("private-settings.toml", path.join(main.root, ".other.toml"));
    await Bun.write(
      path.join(main.root, "rope.toml"),
      'pilot = 0\n[editor]\nline_width = 100\n[delegates.other]\npaths = ["**/*.md"]\nconfig = [".other.toml"]\n'
    );
    const adapter = fakeAdapter({
      descriptor: { reports: ["line_width"], tool: "other" },
      facts: async (root) => ({
        facts: (await Bun.file(path.join(root, ".other.toml")).exists())
          ? [
              {
                file: ".other.toml",
                key: "line_width",
                name: "line_width",
                value: 80,
              },
            ]
          : [],
        ok: true,
      }),
    });
    const deps = { adapters: () => [adapter] };
    const preview = await runWrite(
      { cwd: main.root, dryRun: true, paths: ["README.md"] },
      deps,
      { mode: "fix" }
    );
    const real = await runWrite(
      { cwd: main.root, paths: ["README.md"] },
      deps,
      { mode: "fix" }
    );
    expect(preview.ok).toBe(true);
    expect(real.ok).toBe(true);
    if (preview.ok && real.ok) {
      expect(preview.value.result.outcome).toBe("findings");
      expect(preview.value.result.steps).toEqual(real.value.result.steps);
    }
  });
});

test("policy comparison records a change between delegated rule owners", () => {
  const descriptor = describeFake({
    enabledBy: "rules.enabled",
    id: "rule-engine",
    packs: [
      {
        about: "fixture",
        name: "sample",
        relevant: ["**/*.md"],
        rules: ["sample/one"],
      },
    ],
  });
  const snapshot = (tool: string) => {
    const parsed = parseConfigTable(
      {
        delegates: { [tool]: { domains: ["rules"], paths: ["**/*.md"] } },
        pilot: 0,
        rules: { enabled: true, packs: ["sample"] },
      },
      { file: "rope.toml", prefix: "" }
    );
    if (!parsed.ok) {
      throw new Error("invalid fixture");
    }
    const plan = resolvePlan({
      config: parsed.value,
      descriptors: [descriptor],
      packages: [],
      paths: ["a.md"],
      present: ["a.md"],
      root: "/repo",
      selection: { kind: "workspace" },
    });
    return policySnapshot({
      artifactVersion: "fixture",
      config: parsed.value,
      descriptors: [descriptor],
      plan,
      present: ["a.md"],
    });
  };
  const before = snapshot("first");
  const after = snapshot("second");
  expect(before.paths[0]?.rules[0]).toMatchObject({
    reason: "delegated to first, not run by Ropes",
    source: { key: "delegates.first" },
    state: "exempt",
  });
  expect(
    comparePolicy(before, after, ["before", "after"]).changes
  ).toHaveLength(1);
});
