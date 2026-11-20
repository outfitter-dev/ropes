import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { check, saveRepair } from "../src/index.ts";
import type { RepairInput, Result } from "../src/index.ts";
import { withFixture } from "./acceptance-repo.ts";

const missing = async (file: string): Promise<boolean> => {
  try {
    await stat(file);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
};

const inputFor = (result: Result): RepairInput => ({
  convention: {
    authored: {
      failing: "private import",
      passing: "public import",
      rationale: "Use the public entry point.",
    },
    file: "rules/private-import.yml",
    hash: "rule-version",
    rule: "local/private-import",
  },
  edit: { baseFiles: {}, baseRevision: "fixture", patch: "" },
  event: { host: "claude-code", id: "event", session: "session" },
  original: result,
  policy: { file: "cinch.toml", hash: "policy-version" },
  repository: "fixture",
  result,
  tools: [],
});

test("repair storage rejects aliases and the entire checkout before creating directories", async () => {
  const history = await realpath(
    await mkdtemp(path.join(tmpdir(), "ropes-storage-"))
  );
  try {
    await withFixture(async ({ main }) => {
      const nested = path.join(main.root, "nested");
      await Bun.write(
        path.join(nested, "cinch.toml"),
        "pilot = 0\n[markdown]\nenabled = false\npreset = false\n[toml]\nenabled = false\n"
      );
      const checked = await check({ cwd: nested, paths: [] });
      if (!checked.ok) {
        throw new Error(checked.error);
      }
      expect(checked.value.plan.root).toBe(nested);
      const input = inputFor(checked.value);
      const sibling = path.join(main.root, "records");
      expect(await saveRepair(sibling, input)).toMatchObject({ ok: false });
      expect(await missing(sibling)).toBe(true);
      const alias = path.join(history, "alias");
      await symlink(main.root, alias, "dir");
      const throughAlias = path.join(alias, "new", "records");
      expect(await saveRepair(throughAlias, input)).toMatchObject({
        ok: false,
      });
      expect(await missing(path.join(main.root, "new"))).toBe(true);
      const directory = path.join(history, "private", "records");
      const saved = await saveRepair(directory, input);
      if (!saved.ok) {
        throw new Error(saved.error);
      }
      if (process.platform !== "win32") {
        const permissions = await Promise.all([
          stat(path.dirname(directory)),
          stat(directory),
          stat(path.join(directory, `${saved.value.id}.json`)),
        ]);
        expect(
          permissions.map((value) => value.mode.toString(8).slice(-3))
        ).toEqual(["700", "700", "600"]);
      }
    });
  } finally {
    await rm(history, { force: true, recursive: true });
  }
});
