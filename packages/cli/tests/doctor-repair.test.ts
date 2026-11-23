import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DoctorReportSchema } from "../../cinch/src/contracts/doctor.ts";
import { FixReportSchema } from "../../cinch/src/contracts/fix.ts";
import {
  checkoutAt,
  fixtureGit,
  runEntry,
} from "../../cinch/tests/acceptance-repo.ts";

const cli = new URL("../src/cli.ts", import.meta.url);

test("rope doctor previews and repairs only managed setup and the missing extends", async () => {
  if (Bun.which("rumdl") === null) {
    if (process.env.CI === "true") {
      throw new Error("The Ropes doctor repair proof requires rumdl on PATH.");
    }
    console.warn(
      "skipped: rumdl is required for the Ropes doctor repair proof"
    );
    return;
  }
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "rope-doctor-"))
  );
  const authored = "[MD013]\nline-length = 88\n";
  const readRoot = () => readFile(path.join(root, ".rumdl.toml"), "utf-8");
  const run = (...args: readonly string[]) => runEntry(cli, args, root);
  try {
    await Bun.write(
      path.join(root, "rope.toml"),
      "pilot = 0\n[toml]\nenabled = false\n"
    );
    await Bun.write(path.join(root, ".rumdl.toml"), authored);
    await Bun.write(path.join(root, "README.md"), "# Guide\n\nText.\n");
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    const index = path.join(root, ".git/index");
    const beforeIndex = await readFile(index);
    const checkout = checkoutAt(root);
    const before = await checkout.files();

    const inspection = await run("doctor", "--json");
    expect(inspection.exitCode).toBe(1);
    expect(
      DoctorReportSchema.parse(JSON.parse(inspection.stdout)).settings
    ).toBeDefined();
    const stopped = await run("fix", "--json");
    expect(stopped.exitCode).toBe(1);
    expect(FixReportSchema.parse(JSON.parse(stopped.stdout)).stopped).toContain(
      "rope doctor --fix"
    );

    const preview = await run("doctor", "--fix", "--dry-run", "--json");
    expect(preview.exitCode).toBe(0);
    const report = DoctorReportSchema.parse(JSON.parse(preview.stdout));
    expect(report.fix).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.changed.toSorted()).toEqual([
      ".ropes/configs/presets/rumdl.toml",
      ".ropes/configs/rumdl.toml",
      ".rumdl.toml",
    ]);
    expect(await checkout.files()).toEqual(before);
    expect(await readFile(index)).toEqual(beforeIndex);

    const applied = await run("doctor", "--fix", "--json");
    expect(applied.exitCode).toBe(0);
    const appliedReport = DoctorReportSchema.parse(JSON.parse(applied.stdout));
    expect(appliedReport.changed).toEqual(report.changed);
    expect(appliedReport.diff).toBe(report.diff);
    expect(await readRoot()).toBe(
      `extends = ".ropes/configs/rumdl.toml"\n\n${authored}`
    );
    const checked = await run("check", "README.md", "--json");
    expect(checked.exitCode).toBe(0);
    const repaired = await run("doctor", "--json");
    expect(repaired.exitCode).toBe(0);
    const repeated = await run("doctor", "--fix", "--json");
    expect(repeated.exitCode).toBe(0);
    expect(
      DoctorReportSchema.parse(JSON.parse(repeated.stdout)).changed
    ).toEqual([]);
    expect(await readFile(index)).toEqual(beforeIndex);

    await Bun.write(path.join(root, "cinch.toml"), "pilot = 0\n");
    const conflicted = await checkout.files();
    const rejected = await run("doctor", "--fix", "--json");
    expect(rejected.exitCode).toBe(2);
    expect(rejected.stderr).toContain("cinch.toml");
    expect(rejected.stderr).toContain("rope.toml");
    expect(await checkout.files()).toEqual(conflicted);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
