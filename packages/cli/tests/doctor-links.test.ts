import { expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { doctor } from "../../core/src/index.ts";
import { fixtureGit, runEntry } from "../../core/tests/acceptance-repo.ts";

const cli = new URL("../src/cli.ts", import.meta.url);

const inRepo = async (body: (root: string) => Promise<void>) => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "rope-doctor-link-"))
  );
  try {
    await Bun.write(
      path.join(root, "rope.toml"),
      "pilot = 0\n[markdown]\npreset = true\n[toml]\nenabled = false\n"
    );
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test.each([
  ["root config", ".rumdl.toml", "config/rumdl.toml", false],
  ["dangling config", ".ropes/configs/rumdl.toml", "../../unused.toml", true],
  ["linked parent", ".ropes/configs", "../config-target", true],
])(
  "doctor rejects a %s before setup writes",
  async (_name, file, target, dangling) => {
    await inRepo(async (root) => {
      const fullPath = path.join(root, file);
      await mkdir(path.dirname(fullPath), { recursive: true });
      if (!dangling) {
        await Bun.write(
          path.resolve(path.dirname(fullPath), target),
          "[MD013]\nline-length = 88\n"
        );
      }
      await symlink(target, fullPath);
      const policy = await readFile(path.join(root, "rope.toml"));
      const index = await readFile(path.join(root, ".git/index"));
      for (const flags of [[], ["--fix", "--dry-run"], ["--fix"]]) {
        // eslint-disable-next-line no-await-in-loop -- each mode must refuse the same initial state
        const result = await runEntry(
          cli,
          ["doctor", ...flags, "--json"],
          root
        );
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("symbolic link");
        expect(result.stderr).toContain(file);
        // eslint-disable-next-line no-await-in-loop -- check each mode leaves the link untouched
        expect(await readlink(fullPath)).toBe(target);
      }
      expect(await readFile(path.join(root, "rope.toml"))).toEqual(policy);
      expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
      expect(
        await Bun.file(
          path.join(root, ".ropes/configs/presets/rumdl.toml")
        ).exists()
      ).toBe(false);
      if (!dangling) {
        expect(
          await readFile(path.resolve(path.dirname(fullPath), target), "utf-8")
        ).toBe("[MD013]\nline-length = 88\n");
      }
    });
  }
);

test("an inactive linked preset is outside the setup repair", async () => {
  await inRepo(async (root) => {
    await Bun.write(
      path.join(root, "rope.toml"),
      "pilot = 0\n[markdown]\nenabled = false\npreset = false\n[toml]\nenabled = false\n"
    );
    await symlink("unused.toml", path.join(root, ".rumdl.toml"));
    const result = await runEntry(cli, ["doctor", "--fix", "--json"], root);
    expect(result.exitCode).toBe(0);
    const linked = await lstat(path.join(root, ".rumdl.toml"));
    expect(linked.isSymbolicLink()).toBe(true);
    expect(await Bun.file(path.join(root, "unused.toml")).exists()).toBe(false);
  });
});

test("the public doctor operation rejects incompatible options before planning", async () => {
  const cwd = "/no-such-doctor-repository";
  const at = await doctor({
    at: "2026-11-23T00:00:00Z",
    cwd,
    fix: true,
    paths: [],
  });
  expect(at).toMatchObject({ ok: false });
  expect(JSON.stringify(at)).toContain("evaluation time");
  const dry = await doctor({ cwd, dryRun: true, paths: [] });
  expect(dry).toMatchObject({ ok: false });
  expect(JSON.stringify(dry)).toContain("requires fix");
});
