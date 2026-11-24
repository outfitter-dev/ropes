import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FixReportSchema } from "../../cinch/src/contracts/fix.ts";
import { PresetReportSchema } from "../../cinch/src/contracts/preset.ts";
import { RelocateReportSchema } from "../../cinch/src/contracts/relocate.ts";
import {
  checkoutAt,
  fixtureGit,
  runEntry,
} from "../../cinch/tests/acceptance-repo.ts";

const cli = new URL("../src/cli.ts", import.meta.url);
const GENERATED = ".ropes/configs/rumdl.toml";
const PRESET = ".ropes/configs/presets/rumdl.toml";

const resolved = async (root: string): Promise<string> => {
  const child = Bun.spawn(["rumdl", "config", "--color", "never"], {
    cwd: root,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(stderr);
  }
  return stdout.replaceAll(/\s*\[from [^\]]*\]/gu, "");
};

test("rope preset lists, updates, adopts and ejects without changing effective settings", async () => {
  if (Bun.which("rumdl") === null) {
    if (process.env.CI === "true") {
      throw new Error("The preset round trip requires rumdl on PATH.");
    }
    console.warn("skipped: rumdl is required for the Ropes preset round trip");
    return;
  }
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "rope-preset-"))
  );
  const run = (...args: readonly string[]) => runEntry(cli, args, root);
  try {
    await Bun.write(
      path.join(root, "rope.toml"),
      "pilot = 0\n[toml]\nenabled = false\n"
    );
    await Bun.write(
      path.join(root, ".rumdl.toml"),
      `extends = "${GENERATED}"\n\n[MD007]\nindent = 4\n`
    );
    await Bun.write(path.join(root, "README.md"), "# Guide\n\nText.\n");
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    const checkout = checkoutAt(root);
    const before = await checkout.files();
    const index = Bun.file(path.join(root, ".git/index"));
    const indexed = await index.bytes();
    const list = await run("preset", "--json");
    expect(list.exitCode).toBe(1);
    const listed = PresetReportSchema.parse(JSON.parse(list.stdout));
    expect(listed.presets.flatMap((item) => item.files)).toContainEqual({
      path: PRESET,
      state: "missing",
    });
    expect(await checkout.files()).toEqual(before);
    const preview = await run(
      "preset",
      "add",
      "markdown",
      "--dry-run",
      "--json"
    );
    expect(preview.exitCode).toBe(0);
    expect(FixReportSchema.parse(JSON.parse(preview.stdout)).changed).toContain(
      PRESET
    );
    expect(await checkout.files()).toEqual(before);
    const added = await run("preset", "add", "markdown", "--json");
    expect(added.exitCode).toBe(0);
    await Bun.write(path.join(root, PRESET), "# stale\n");
    const updated = await run("preset", "update", "markdown", "--json");
    expect(updated.exitCode).toBe(0);
    expect(FixReportSchema.parse(JSON.parse(updated.stdout)).changed).toContain(
      PRESET
    );
    const effective = await resolved(root);
    expect(effective).toContain("indent = 4");
    const beforeAdopt = await checkout.files();
    const adoption = await run("preset", "adopt", "markdown", "--json");
    expect(adoption.exitCode).toBe(0);
    const adoptPreview = RelocateReportSchema.parse(
      JSON.parse(adoption.stdout)
    );
    expect(adoptPreview.changed).toContain("rope.toml");
    expect(adoptPreview.written).toBe(false);
    expect(await checkout.files()).toEqual(beforeAdopt);
    const forcedPreview = await run(
      "preset",
      "adopt",
      "markdown",
      "--yes",
      "--dry-run",
      "--json"
    );
    expect(forcedPreview).toEqual(adoption);
    expect(await checkout.files()).toEqual(beforeAdopt);
    const adopted = await run("preset", "adopt", "markdown", "--yes", "--json");
    expect(adopted.exitCode).toBe(0);
    expect(RelocateReportSchema.parse(JSON.parse(adopted.stdout)).diff).toBe(
      adoptPreview.diff
    );
    expect(await readFile(path.join(root, "rope.toml"), "utf-8")).toContain(
      "[tools.rumdl.MD007]"
    );
    expect(await resolved(root)).toBe(effective);
    const ejected = await run("preset", "eject", "markdown", "--yes", "--json");
    expect(ejected.exitCode).toBe(0);
    const ejectedReport = RelocateReportSchema.parse(
      JSON.parse(ejected.stdout)
    );
    expect(ejectedReport).toMatchObject({ action: "eject", written: true });
    expect(ejectedReport.changed).toContain("rope.toml");
    expect(await resolved(root)).toBe(effective);
    expect(await index.bytes()).toEqual(indexed);
    await rm(path.join(root, "rope.toml"));
    const rejected = await run(
      "preset",
      "adopt",
      "markdown",
      "--yes",
      "--json"
    );
    expect(rejected.exitCode).toBe(2);
    expect(rejected.stderr).toContain("rope init");
    expect(await Bun.file(path.join(root, "cinch.toml")).exists()).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
