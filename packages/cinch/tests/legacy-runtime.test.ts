import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../src/config/load.ts";
import { managedDirFor } from "../src/config/managed.ts";
import { discoverRoot } from "../src/config/root.ts";
import {
  check,
  doctor,
  explain,
  explainRule,
  fix,
  init,
  preset,
  previewMigration,
  rules,
  rulesAdopt,
  snapshotPolicy,
  trace,
} from "../src/index.ts";
import { fixtureGit, runEntry } from "./acceptance-repo.ts";

const cli = new URL("../../cli/src/cli.ts", import.meta.url);
const fresh = async () =>
  await realpath(await mkdtemp(path.join(tmpdir(), "rope-retired-")));

test.each(["cinch.toml", ".outfitter/configs"])(
  "%s is rejected from metadata even when its content cannot be read",
  async (retired) => {
    const root = await fresh();
    try {
      await mkdir(path.dirname(path.join(root, retired)), { recursive: true });
      await symlink(path.join(root, "absent-target"), path.join(root, retired));
      await Bun.write(path.join(root, "rope.toml"), "pilot = 0\n");
      const loaded = await loadConfig(root);
      expect(loaded).toMatchObject({
        error: { file: path.join(root, retired), kind: "legacy" },
        ok: false,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
);

test("all quality operations reject retired policy before applying defaults", async () => {
  const root = await fresh();
  try {
    await mkdir(path.join(root, ".git"));
    await Bun.write(path.join(root, "cinch.toml"), "this is not valid TOML");
    const request = { cwd: root, paths: [] };
    const operations = await Promise.all([
      check(request),
      explain(request),
      explainRule({ ...request, rule: "config/tsconfig-extends" }),
      fix(request),
      doctor(request),
      doctor({ ...request, fix: true }),
      init({ cwd: root }),
      preset({ ...request, action: "list" }),
      rules(request),
      rulesAdopt(request),
      snapshotPolicy(request),
      trace(request),
    ]);
    for (const result of operations) {
      expect(result).toMatchObject({ ok: false });
      expect(result.ok ? "" : result.error).toContain("cinch.toml");
      expect(result.ok ? "" : result.error).toContain("rope.toml");
      expect(result.ok ? "" : result.error).not.toContain("not valid TOML");
    }
    expect(await Bun.file(path.join(root, "cinch.toml")).text()).toBe(
      "this is not valid TOML"
    );
    expect(await Bun.file(path.join(root, "rope.toml")).exists()).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("shared Cinch policy is detected without interpreting its settings", async () => {
  const root = await fresh();
  try {
    await Bun.write(
      path.join(root, "outfitter.toml"),
      '[app]\nname = "sample"\n[cinch]\npilot = "unsupported"\n'
    );
    const shared = await loadConfig(root);
    expect(shared).toMatchObject({ error: { kind: "legacy" }, ok: false });
    expect(
      shared.ok || shared.error.kind !== "legacy"
        ? ""
        : shared.error.replacement
    ).toContain("[cinch]");
    await Bun.write(
      path.join(root, "outfitter.toml"),
      '[app]\nname = "sample"\n'
    );
    await mkdir(path.join(root, ".outfitter/other"), { recursive: true });
    const loaded = await loadConfig(root);
    expect(loaded.ok && loaded.value.file).toBeNull();
    expect(managedDirFor(null)).toBe(".ropes/configs");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("nested supported policy cannot hide a retired ancestor inside its checkout", async () => {
  const root = await fresh();
  try {
    const nested = path.join(root, "packages/app");
    await mkdir(nested, { recursive: true });
    await mkdir(path.join(root, ".git"));
    await Bun.write(path.join(root, "cinch.toml"), "retired content");
    await Bun.write(path.join(nested, "rope.toml"), "pilot = 0\n");
    const found = await discoverRoot(nested);
    expect(found).toMatchObject({
      error: {
        error: { file: path.join(root, "cinch.toml"), kind: "legacy" },
        kind: "configuration",
      },
      ok: false,
    });
    await rm(path.join(root, "cinch.toml"));
    await Bun.write(path.join(root, "outfitter.toml"), "malformed shared =");
    const supported = await discoverRoot(nested);
    expect(supported.ok && supported.value.root).toBe(nested);
    expect(await loadConfig(root)).toMatchObject({ ok: false });
    await Bun.write(path.join(root, "outfitter.toml"), "[cinch]\npilot = 0\n");
    expect(await discoverRoot(nested)).toMatchObject({ ok: false });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("informational CLI and manual migration guidance leave retired config alone", async () => {
  const root = await fresh();
  try {
    await fixtureGit(root, "init", "--quiet");
    await Bun.write(path.join(root, "cinch.toml"), "retired content");
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    for (const args of [["--help"], ["--version"], ["schema", "config"]]) {
      // eslint-disable-next-line no-await-in-loop -- inspect each informational entry point
      const informational = await runEntry(cli, args, root);
      expect(informational.exitCode).toBe(0);
    }
    const migration = await runEntry(cli, ["migrate", "--json"], root);
    expect(migration.exitCode).toBe(2);
    expect(migration.stdout).toBe("");
    expect(migration.stderr).toContain("Manual migration required");
    expect(migration.stderr).toContain(".ropes/configs");
    const guidance = await previewMigration(
      path.join(root, "missing-directory")
    );
    expect(guidance.ok).toBe(false);
    expect(guidance.ok ? "" : guidance.error).toContain(
      "Manual migration required"
    );
    expect(await Bun.file(path.join(root, "cinch.toml")).text()).toBe(
      "retired content"
    );
    expect(await Bun.file(path.join(root, "rope.toml")).exists()).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
