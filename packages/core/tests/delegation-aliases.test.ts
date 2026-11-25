import { expect, test } from "bun:test";
import { link, symlink } from "node:fs/promises";
import path from "node:path";

import { managedAdapter } from "../src/adapters/managed.ts";
import { runDoctor } from "../src/commands/doctor.ts";
import { runFix } from "../src/commands/fix.ts";
import { prepare } from "../src/commands/prepare.ts";
import { runRopesPreset } from "../src/commands/preset.ts";
import { oldConfigs } from "../src/commands/retire.ts";
import { adoptRules } from "../src/commands/rules-adopt.ts";
import { fakeAdapter } from "./fake-adapter.ts";
import { BASE, withRepo } from "./repo-bench.ts";

const OWN = "authored configuration\n";
const policy = (file: string) =>
  `pilot = 0\n[delegates.other]\npaths = ["src/**"]\nconfig = [${JSON.stringify(file)}]\n`;
const writer = () =>
  fakeAdapter({
    fix: async ({ path: file, root }) => {
      await Bun.write(path.join(root, file), "replaced\n");
      return { findings: [], status: "fixed" };
    },
  });

for (const kind of ["symlink", "hardlink"]) {
  test(`explicit selection preserves the target of a protected config ${kind}`, async () => {
    await withRepo(
      { ...BASE, "authored.md": OWN, "rope.toml": policy(".editorconfig") },
      {},
      async ({ root }) => {
        const source = path.join(root, "authored.md");
        const named = path.join(root, ".editorconfig");
        await (kind === "symlink"
          ? symlink("authored.md", named)
          : link(source, named));
        const adapter = writer();
        const result = await runFix(
          {
            cwd: root,
            paths: [kind === "symlink" ? ".editorconfig" : "authored.md"],
          },
          { adapters: () => [adapter] }
        );
        expect(result.ok).toBe(true);
        expect(adapter.calls).not.toContain("fix");
        expect(await Bun.file(source).text()).toBe(OWN);
        if (result.ok) {
          expect(result.value.result.plan.paths[0]?.protected?.[0]?.tool).toBe(
            "other"
          );
        }
      }
    );
  });
}

test("directory-expanded aliases of a protected config remain read-only", async () => {
  await withRepo(
    {
      ...BASE,
      ".editorconfig": OWN,
      "docs/keep.md": "# Keep\n",
      "rope.toml": policy(".editorconfig"),
    },
    {},
    async ({ root }) => {
      await symlink("../.editorconfig", path.join(root, "docs/config.md"));
      const adapter = writer();
      const result = await runFix(
        { cwd: root, paths: ["docs"] },
        { adapters: () => [adapter] }
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const alias = result.value.result.plan.paths.find(
          (entry) => entry.path === "docs/config.md"
        );
        expect(alias?.protected?.[0]?.tool).toBe("other");
        expect(alias?.steps.every((step) => !step.writes)).toBe(true);
      }
      expect(await Bun.file(path.join(root, ".editorconfig")).text()).toBe(OWN);
    }
  );
});

test("a managed setup writer cannot reach a protected config through an alias", async () => {
  await withRepo(
    { ...BASE, ".editorconfig": OWN, "rope.toml": policy(".editorconfig") },
    {},
    async ({ root }) => {
      await symlink(".editorconfig", path.join(root, "managed.md"));
      const keeper = managedAdapter({
        enabledBy: "markdown.enabled",
        files: [
          {
            path: "managed.md",
            want: () => Promise.resolve({ ok: true, text: "replaced\n" }),
          },
        ],
        id: "keeper",
      });
      const result = await runDoctor(
        { cwd: root, fix: true, paths: [] },
        { adapters: () => [keeper] }
      );
      expect(result.ok).toBe(true);
      expect(await Bun.file(path.join(root, ".editorconfig")).text()).toBe(OWN);
    }
  );
});

const move = () =>
  Promise.resolve({
    files: [
      { path: "move.json", text: "replaced\n" },
      { path: "rope.toml", text: "replaced\n" },
    ],
    notes: [],
    ok: true,
  } as const);

for (const action of ["adopt", "eject"]) {
  test(`preset ${action} guards physical aliases before a multi-file write`, async () => {
    const text = policy("protected.json");
    await withRepo(
      { ...BASE, "protected.json": OWN, "rope.toml": text },
      {},
      async ({ root }) => {
        await symlink("protected.json", path.join(root, "move.json"));
        const adapter = managedAdapter({
          enabledBy: "format.preset",
          files: [],
          id: "move",
          moves: { files: ["move.json"], name: "move" },
          relocates: { adopt: move, eject: move },
        });
        const result = await runRopesPreset(
          { action, cwd: root, paths: ["move"], yes: true },
          { adapters: () => [adapter] }
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain(
            "protected by rope.toml: delegates.other"
          );
        }
        expect(await Bun.file(path.join(root, "protected.json")).text()).toBe(
          OWN
        );
        expect(await Bun.file(path.join(root, "rope.toml")).text()).toBe(text);
      }
    );
  });
}

test("rules adoption protects a policy reached through a config alias without changing the authored snapshot", async () => {
  const text = policy(".other.toml");
  await withRepo({ ...BASE, "rope.toml": text }, {}, async ({ root }) => {
    await symlink("rope.toml", path.join(root, ".other.toml"));
    const result = await adoptRules(
      { cwd: root, paths: [], yes: true },
      { adapters: () => [] }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("protected by rope.toml: delegates.other");
    }
    expect(await Bun.file(path.join(root, "rope.toml")).text()).toBe(text);
  });
});

test("retirement discovery preserves an alias of a protected config", async () => {
  await withRepo(
    { ...BASE, "protected.md": OWN, "rope.toml": policy("protected.md") },
    {},
    async ({ root }) => {
      await symlink("protected.md", path.join(root, "old.md"));
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
                files: ["old.md"],
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
    }
  );
});
