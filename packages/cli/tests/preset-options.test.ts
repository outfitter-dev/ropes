import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { preset } from "@ropes/core";

import { PresetReportSchema } from "../../cinch/src/contracts/preset.ts";
import { RelocateReportSchema } from "../../cinch/src/contracts/relocate.ts";
import {
  checkoutAt,
  fixtureGit,
  runEntry,
} from "../../cinch/tests/acceptance-repo.ts";

const cli = new URL("../src/cli.ts", import.meta.url);
const legacy = new URL("../../cinch/src/cli.ts", import.meta.url);

const withFixture = async (body: (root: string) => Promise<void>) => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "rope-preset-options-"))
  );
  try {
    await Bun.write(
      path.join(root, "rope.toml"),
      "pilot = 0\n[toml]\nenabled = false\n[typescript]\npreset = true\n"
    );
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test("public preset commands honor single-name scope while legacy commands keep their arguments", async () => {
  await withFixture(async (root) => {
    const run = (...args: readonly string[]) =>
      runEntry(cli, ["preset", ...args], root);
    const added = await run("add", "markdown", "--json");
    expect(added.exitCode).toBe(0);
    const selected = await run("list", "markdown", "--json");
    expect(selected.exitCode).toBe(0);
    expect(
      PresetReportSchema.parse(JSON.parse(selected.stdout)).presets.map(
        (item) => item.name
      )
    ).toEqual(["markdown"]);
    const all = await run("list", "--json");
    expect(all.exitCode).toBe(1);
    const before = await checkoutAt(root).files();
    for (const action of ["list", "add", "update", "adopt", "eject"]) {
      // eslint-disable-next-line no-await-in-loop -- each public route must reject before writing
      const invalid = await run(
        action,
        "markdown",
        "typescript",
        "--yes",
        "--json"
      );
      expect(invalid.exitCode).toBe(2);
    }
    const missing = await run("add", "--json");
    expect(missing.exitCode).toBe(2);
    const unknown = await run("list", "unknown", "--json");
    expect(unknown.exitCode).toBe(2);
    expect(await checkoutAt(root).files()).toEqual(before);
    const legacyList = await runEntry(
      legacy,
      ["preset", "list", "markdown", "--json"],
      root
    );
    expect(
      PresetReportSchema.parse(JSON.parse(legacyList.stdout)).presets.length
    ).toBeGreaterThan(1);
    const legacyAdd = await runEntry(
      legacy,
      ["preset", "add", "markdown", "typescript", "--dry-run", "--json"],
      root
    );
    expect(legacyAdd.exitCode).toBe(0);
    expect(await checkoutAt(root).files()).toEqual(before);
  });
});

test("public preset API rejects explicit evaluation time before any action", async () => {
  await withFixture(async (root) => {
    const before = await checkoutAt(root).files();
    for (const action of ["list", "add", "update", "adopt", "eject"]) {
      const request = {
        action,
        at: "2030-01-01T00:00:00.000Z",
        cwd: root,
        paths: ["markdown"],
        yes: true,
      };
      // eslint-disable-next-line no-await-in-loop -- verify the public API guard on every action
      const ran = await preset(request);
      expect(ran).toEqual({
        error:
          "An explicit evaluation time is only for explain, check, and policy snapshot.",
        ok: false,
      });
    }
    expect(await checkoutAt(root).files()).toEqual(before);
  });
});

test("public adoption recovery uses rope and legacy recovery retains cinch", async () => {
  await withFixture(async (root) => {
    const added = await runEntry(
      cli,
      ["preset", "add", "markdown", "--json"],
      root
    );
    expect(added.exitCode).toBe(0);
    await Bun.write(
      path.join(root, ".rumdl.toml"),
      'extends = ".ropes/configs/rumdl.toml"\n\n[MD007]\nindent = 4\n'
    );
    await Bun.write(
      path.join(root, ".ropes/configs/presets/rumdl.toml"),
      "# stale\n"
    );
    const before = await checkoutAt(root).files();
    const publicMove = await runEntry(
      cli,
      ["preset", "adopt", "markdown", "--json"],
      root
    );
    expect(publicMove.exitCode).toBe(1);
    expect(
      RelocateReportSchema.parse(JSON.parse(publicMove.stdout)).stopped?.join(
        "\n"
      )
    ).toContain("`rope doctor --fix`");
    const legacyMove = await runEntry(
      legacy,
      ["preset", "adopt", "markdown", "--json"],
      root
    );
    expect(legacyMove.exitCode).toBe(1);
    expect(
      RelocateReportSchema.parse(JSON.parse(legacyMove.stdout)).stopped?.join(
        "\n"
      )
    ).toContain("`cinch doctor --fix`");
    expect(await checkoutAt(root).files()).toEqual(before);
  });
});
