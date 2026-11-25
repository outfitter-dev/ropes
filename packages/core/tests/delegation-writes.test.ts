import { expect, test } from "bun:test";
import path from "node:path";

import { editorFileAdapter } from "../src/adapters/editorconfig/adapter.ts";
import { managedAdapter } from "../src/adapters/managed.ts";
import { runDoctor } from "../src/commands/doctor.ts";
import { runFix } from "../src/commands/fix.ts";
import { prepare } from "../src/commands/prepare.ts";
import { runRopesPreset } from "../src/commands/preset.ts";
import { oldConfigs } from "../src/commands/retire.ts";
import { runRopesInit } from "../src/commands/ropes-init.ts";
import { adoptRules } from "../src/commands/rules-adopt.ts";
import { fakeAdapter } from "./fake-adapter.ts";
import { BASE, withRepo } from "./repo-bench.ts";

const TEXT =
  'pilot = 0\ninclude = ["**/*"]\n[editor]\nindent_size = 2\n[delegates.other]\npaths = ["src/**"]\nconfig = [".editorconfig", ".other.toml", "rope.toml"]\n';
const OWN = "root = true\n[*]\nindent_size = 8\n";

test("all setup and content write modes preserve delegated authored configs", async () => {
  await withRepo(
    {
      ...BASE,
      ".editorconfig": OWN,
      ".other.toml": "authored = true\n",
      "rope.toml": TEXT,
    },
    {},
    async ({ root }) => {
      const content = fakeAdapter({
        descriptor: { extensions: ["*"], writes: true },
        fix: async ({ path: file, root: cwd }) => {
          await Bun.write(path.join(cwd, file), "changed\n");
          return { findings: [], status: "fixed" };
        },
      });
      const deps = {
        adapters: () => [
          editorFileAdapter({ indent_size: 2, overrides: [] }),
          content,
        ],
      };
      const setup = await runDoctor({ cwd: root, fix: true, paths: [] }, deps);
      expect(setup.ok).toBe(true);
      const init = await runRopesInit({ cwd: root, yes: true }, deps);
      expect(init.ok).toBe(true);
      const fixed = await runFix(
        { cwd: root, paths: [".editorconfig", ".other.toml", "rope.toml"] },
        deps
      );
      expect(fixed.ok).toBe(true);
      expect(content.calls).not.toContain("fix");
      expect(await Bun.file(path.join(root, ".editorconfig")).text()).toBe(OWN);
      expect(await Bun.file(path.join(root, ".other.toml")).text()).toBe(
        "authored = true\n"
      );
      expect(await Bun.file(path.join(root, "rope.toml")).text()).toBe(TEXT);
    }
  );
});

for (const action of ["adopt", "eject"]) {
  test(`preset ${action} refuses a multi-file move that includes a protected config`, async () => {
    await withRepo(
      { ...BASE, ".editorconfig": OWN, "rope.toml": TEXT },
      {},
      async ({ root }) => {
        const result = await runRopesPreset(
          { action, cwd: root, paths: ["editor"], yes: true },
          {
            adapters: () => [
              editorFileAdapter({ indent_size: 2, overrides: [] }),
            ],
          }
        );
        expect(result.ok).toBe(false);
        expect(await Bun.file(path.join(root, ".editorconfig")).text()).toBe(
          OWN
        );
        expect(await Bun.file(path.join(root, "rope.toml")).text()).toBe(TEXT);
      }
    );
  });
}

test("rules adoption never edits a protected policy file", async () => {
  await withRepo({ ...BASE, "rope.toml": TEXT }, {}, async ({ root }) => {
    const result = await adoptRules(
      { cwd: root, paths: [], yes: true },
      { adapters: () => [] }
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain("protected by rope.toml: delegates.other");
    }
    expect(await Bun.file(path.join(root, "rope.toml")).text()).toBe(TEXT);
  });
});

test("legacy migration discovery never offers to retire a protected config outside the selected paths", async () => {
  await withRepo({ ...BASE, "rope.toml": TEXT }, {}, async ({ root }) => {
    const adapter = managedAdapter({
      enabledBy: "markdown.enabled",
      files: [
        {
          path: "managed.toml",
          want: () => Promise.resolve({ ok: true, text: "managed = true\n" }),
        },
      ],
      id: "keeper",
      migrates: [
        {
          id: "other",
          retires: () =>
            Promise.resolve({
              files: [".other.toml"],
              keep: [],
              leftovers: [],
              needs: ["managed.toml"],
            }),
        },
      ],
    });
    const prepared = await prepare(
      { cwd: root, paths: ["managed.toml"] },
      { adapters: () => [adapter] }
    );
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      const old = await oldConfigs(
        [adapter],
        prepared.value.plan,
        root,
        prepared.value.config
      );
      expect(old.files).toEqual([]);
    }
  });
});
