import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DoctorReportSchema } from "../../cinch/src/contracts/doctor.ts";
import { FixReportSchema } from "../../cinch/src/contracts/fix.ts";
import {
  checkoutAt,
  fixtureGit,
  runEntry,
} from "../../cinch/tests/acceptance-repo.ts";
import { qualifyStandaloneTaplo } from "../../cinch/tests/binary-taplo.ts";
import manifest from "../package.json" with { type: "json" };

const CLI = new URL("../src/cli.ts", import.meta.url);
const CINCH = new URL("../../cinch/src/cli.ts", import.meta.url);
const BUILD = new URL("../scripts/build-binary.ts", import.meta.url);
let directory = "";
let binary = "";
let engines = "";
let gitOnly = "";

const run = async (
  args: readonly string[],
  cwd: string,
  searchPath = engines
) => {
  const child = Bun.spawn([binary, ...args], {
    cwd,
    env: {
      HOME: directory,
      PATH: searchPath,
      XDG_CACHE_HOME: path.join(directory, "cache"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
};

beforeAll(async () => {
  directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "rope-binary-"))
  );
  engines = path.join(directory, "engines");
  await mkdir(engines);
  gitOnly = path.join(directory, "git-only");
  await mkdir(gitOnly);
  for (const tool of ["git", "rumdl"]) {
    const executable = Bun.which(tool);
    if (executable !== null) {
      // eslint-disable-next-line no-await-in-loop -- assemble the isolated engine PATH
      await symlink(await realpath(executable), path.join(engines, tool));
      if (tool === "git") {
        // eslint-disable-next-line no-await-in-loop -- missing-engine fixture retains Git
        await symlink(await realpath(executable), path.join(gitOnly, tool));
      }
    } else if (process.env.CI === "true") {
      throw new Error(`The standalone Ropes proof requires ${tool} on PATH.`);
    }
  }
  binary = process.env.ROPES_BINARY ?? path.join(directory, "rope");
  if (!path.isAbsolute(binary)) {
    throw new Error("ROPES_BINARY must be an absolute path to the candidate.");
  }
  if (process.env.ROPES_BINARY === undefined) {
    const child = Bun.spawn([process.execPath, fileURLToPath(BUILD), binary], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`Standalone rope build failed: ${stderr}`);
    }
  }
});
afterAll(() => rm(directory, { force: true, recursive: true }));

const fixture = async (name: string, text = "# Guide\n\n# Another title\n") => {
  const root = path.join(directory, name);
  await mkdir(root);
  await Bun.write(
    path.join(root, "rope.toml"),
    "pilot = 0\n[toml]\nenabled = false\n"
  );
  await Bun.write(path.join(root, "README.md"), text);
  await fixtureGit(root, "init", "--quiet");
  await fixtureGit(root, "add", ".");
  await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
  const initialized = await runEntry(
    CINCH,
    ["doctor", "--fix", "--json"],
    root
  );
  expect(initialized.exitCode).toBe(0);
  await fixtureGit(root, "add", ".");
  await fixtureGit(
    root,
    "commit",
    "--quiet",
    "--allow-empty",
    "--message",
    "setup"
  );
  return root;
};

const needsEngine = () => {
  if (Bun.which("rumdl", { PATH: engines }) !== null) {
    return false;
  }
  console.warn("skipped: rumdl is required for the standalone Ropes proof");
  return true;
};

test("standalone rope identifies itself and shows help before setup", async () => {
  const version = await run(["--version"], directory, "");
  expect(version.stdout).toBe(`rope ${manifest.version} (binary)\n`);
  const help = await run(["--help"], directory, "");
  expect(help.exitCode).toBe(0);
  expect(help.stdout).toContain("rope doctor");
  expect(help.stdout).toContain("checksum through mise");
  expect(Bun.which("bun", { PATH: engines })).toBeNull();
});

test("standalone rope previews and initializes a fresh repository without Bun", async () => {
  if (needsEngine()) {
    return;
  }
  const root = path.join(directory, "init");
  await mkdir(root);
  await Bun.write(path.join(root, "README.md"), "# Guide\n\nText.\n");
  await fixtureGit(root, "init", "--quiet");
  await fixtureGit(root, "add", ".");
  await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
  const checkout = checkoutAt(root);
  const before = await checkout.files();
  const index = Bun.file(path.join(root, ".git/index"));
  const indexed = await index.bytes();
  const preview = await run(["init", "--json"], root);
  expect(preview.exitCode).toBe(0);
  const report = FixReportSchema.parse(JSON.parse(preview.stdout));
  expect(report.changed).toContain("rope.toml");
  expect(report.changed).toContain(".ropes/configs/presets/rumdl.toml");
  expect(report.dryRun).toBe(true);
  expect(await run(["init", "--yes", "--dry-run", "--json"], root)).toEqual(
    preview
  );
  expect(await checkout.files()).toEqual(before);
  expect(await index.bytes()).toEqual(indexed);
  const apply = await run(["init", "--yes", "--json"], root);
  expect(apply.exitCode).toBe(0);
  const applied = FixReportSchema.parse(JSON.parse(apply.stdout));
  expect(applied.changed).toEqual(report.changed);
  expect(applied.diff).toBe(report.diff);
  const checked = await run(["check", "README.md", "--json"], root);
  expect(checked.exitCode).toBe(0);
  const repeat = await run(["init", "--yes", "--json"], root);
  expect(repeat.exitCode).toBe(0);
  expect(FixReportSchema.parse(JSON.parse(repeat.stdout)).changed).toEqual([]);
  expect(await index.bytes()).toEqual(indexed);

  await Bun.write(path.join(root, "cinch.toml"), "pilot = 0\n");
  const conflict = await run(["init", "--yes", "--json"], root);
  expect(conflict.exitCode).toBe(2);
  expect(conflict.stderr).toContain("cinch.toml");
  expect(conflict.stderr).toContain("rope.toml");
  await rm(path.join(root, "rope.toml"));
  const legacy = await run(["init", "--yes", "--json"], root);
  expect(legacy.exitCode).toBe(2);
  expect(legacy.stderr).toContain("rope migrate");
  expect(await Bun.file(path.join(root, "rope.toml")).exists()).toBe(false);
});

test("standalone rope matches package plans, results and doctor without writes or Bun", async () => {
  if (needsEngine()) {
    return;
  }
  const root = await fixture("parity");
  const before = await checkoutAt(root).files();
  const index = await readFile(path.join(root, ".git/index"));
  for (const verb of ["explain", "check", "doctor"]) {
    // eslint-disable-next-line no-await-in-loop -- compare each real entry point on the same fixture
    const alone = await run([verb, "--json"], root);
    // eslint-disable-next-line no-await-in-loop -- same fixture and pinned engines
    const packaged = await runEntry(CLI, [verb, "--json"], root, engines);
    expect(alone).toEqual(packaged);
    if (verb === "doctor") {
      expect(
        DoctorReportSchema.parse(JSON.parse(alone.stdout)).settings
      ).toBeDefined();
    }
  }
  expect(await checkoutAt(root).files()).toEqual(before);
  expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
  const noEngine = await run(["check", "README.md", "--json"], root, gitOnly);
  expect(noEngine.exitCode).toBe(2);
  expect(noEngine.stdout).toContain("rumdl is not on PATH");
});

test("standalone rope previews and applies fenced repairs through its embedded runtime", async () => {
  if (needsEngine()) {
    return;
  }
  const root = await fixture("fences", "# Guide\n\n```ts\nconst  a = 1\n```\n");
  const before = await checkoutAt(root).files();
  const index = await readFile(path.join(root, ".git/index"));
  const preview = await run(["fix", "README.md", "--dry-run", "--json"], root);
  expect(preview.exitCode).toBe(0);
  const previewed = FixReportSchema.parse(JSON.parse(preview.stdout));
  expect(previewed.dryRun).toBe(true);
  expect(previewed.changed).toEqual(["README.md"]);
  expect(previewed.diff).toBe(
    "--- a/README.md\n+++ b/README.md\n@@ -1,5 +1,5 @@\n # Guide\n \n ```ts\n-const  a = 1\n+const a = 1;\n ```\n"
  );
  expect(await checkoutAt(root).files()).toEqual(before);
  expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
  const fixed = await run(["fix", "README.md", "--json"], root);
  expect(fixed.exitCode).toBe(0);
  const applied = FixReportSchema.parse(JSON.parse(fixed.stdout));
  expect(applied.dryRun).toBe(false);
  expect(applied.changed).toEqual(previewed.changed);
  expect(applied.diff).toBe(previewed.diff);
  expect(await Bun.file(path.join(root, "README.md")).text()).toBe(
    "# Guide\n\n```ts\nconst a = 1;\n```\n"
  );
  const checked = await run(["check", "README.md", "--json"], root);
  expect(checked.exitCode).toBe(0);
});

test.skipIf(process.platform !== "darwin")(
  "standalone rope recovers a native Taplo panic with its embedded worker",
  async () => {
    if (needsEngine()) {
      return;
    }
    const root = await fixture("taplo-recovery");
    await rm(path.join(root, "rope.toml"));
    await qualifyStandaloneTaplo(binary, root);
  }
);
