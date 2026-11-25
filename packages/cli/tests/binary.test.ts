import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { DoctorReportSchema } from "../../cinch/src/contracts/doctor.ts";
import { FixReportSchema } from "../../cinch/src/contracts/fix.ts";
import {
  checkoutAt,
  fixtureGit,
  runEntry,
} from "../../cinch/tests/acceptance-repo.ts";
import { qualifyStandaloneCache } from "../../cinch/tests/binary-cache.ts";
import { qualifyMiseInstall } from "../../cinch/tests/binary-install.ts";
import { qualifyStandaloneTaplo } from "../../cinch/tests/binary-taplo.ts";
import manifest from "../package.json" with { type: "json" };
import { standaloneFixture } from "./binary-fixture.ts";

const CLI = new URL("../src/cli.ts", import.meta.url);
let proof: Awaited<ReturnType<typeof standaloneFixture>>;

beforeAll(async () => {
  proof = await standaloneFixture();
}, 30_000);
afterAll(async () => {
  if (proof !== undefined) {
    await rm(proof.directory, { force: true, recursive: true });
  }
});

test("standalone rope identifies itself and shows help before setup", async () => {
  const version = await proof.run(["--version"], proof.directory, "");
  expect(version.stdout).toBe(`rope ${manifest.version} (binary)\n`);
  const help = await proof.run(["--help"], proof.directory, "");
  expect(help.exitCode).toBe(0);
  expect(help.stdout).toContain("rope doctor");
  expect(help.stdout).toContain("checksum through mise");
  expect(Bun.which("bun", { PATH: proof.engines })).toBeNull();
  const unknown = await proof.run(["nope"], proof.directory, "");
  expect(unknown.exitCode).toBe(2);
  expect(unknown.stderr).toContain('unknown command "nope"');
});

test("standalone rope previews and initializes a fresh repository without Bun", async () => {
  if (proof.needsTools("git", "rumdl")) {
    return;
  }
  const root = path.join(proof.directory, "init");
  await mkdir(root);
  await Bun.write(path.join(root, "README.md"), "# Guide\n\nText.\n");
  await fixtureGit(root, "init", "--quiet");
  await fixtureGit(root, "add", ".");
  await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
  const checkout = checkoutAt(root);
  const before = await checkout.files();
  const index = Bun.file(path.join(root, ".git/index"));
  const indexed = await index.bytes();
  const preview = await proof.run(["init", "--json"], root);
  expect(preview.exitCode).toBe(0);
  const report = FixReportSchema.parse(JSON.parse(preview.stdout));
  expect(report.changed).toContain("rope.toml");
  expect(report.changed).toContain(".ropes/configs/presets/rumdl.toml");
  expect(report.dryRun).toBe(true);
  expect(
    await proof.run(["init", "--yes", "--dry-run", "--json"], root)
  ).toEqual(preview);
  expect(await checkout.files()).toEqual(before);
  expect(await index.bytes()).toEqual(indexed);
  const apply = await proof.run(["init", "--yes", "--json"], root);
  expect(apply.exitCode).toBe(0);
  const applied = FixReportSchema.parse(JSON.parse(apply.stdout));
  expect(applied.changed).toEqual(report.changed);
  expect(applied.diff).toBe(report.diff);
  const kept = await Bun.file(
    path.join(root, ".ropes/configs/presets/rumdl.toml")
  ).text();
  expect(
    kept.endsWith(
      await Bun.file(
        new URL("../../cinch/presets/rumdl.toml", import.meta.url)
      ).text()
    )
  ).toBe(true);
  const checked = await proof.run(["check", "README.md", "--json"], root);
  expect(checked.exitCode).toBe(0);
  const repeat = await proof.run(["init", "--yes", "--json"], root);
  expect(repeat.exitCode).toBe(0);
  expect(FixReportSchema.parse(JSON.parse(repeat.stdout)).changed).toEqual([]);
  expect(await index.bytes()).toEqual(indexed);

  await Bun.write(path.join(root, "cinch.toml"), "pilot = 0\n");
  const conflict = await proof.run(["init", "--yes", "--json"], root);
  expect(conflict.exitCode).toBe(2);
  expect(conflict.stderr).toContain("cinch.toml");
  expect(conflict.stderr).toContain("rope.toml");
  await rm(path.join(root, "rope.toml"));
  const legacy = await proof.run(["init", "--yes", "--json"], root);
  expect(legacy.exitCode).toBe(2);
  expect(legacy.stderr).toContain("rope migrate");
  expect(await Bun.file(path.join(root, "rope.toml")).exists()).toBe(false);
});

test("standalone rope matches package plans, results and doctor without writes or Bun", async () => {
  if (proof.needsTools("git", "rumdl")) {
    return;
  }
  const root = await proof.fixture("parity");
  const before = await checkoutAt(root).files();
  const index = await readFile(path.join(root, ".git/index"));
  for (const verb of ["explain", "check", "doctor"]) {
    // eslint-disable-next-line no-await-in-loop -- compare each real entry point on the same fixture
    const alone = await proof.run([verb, "--json"], root);
    // eslint-disable-next-line no-await-in-loop -- same fixture and pinned engines
    const packaged = await runEntry(CLI, [verb, "--json"], root, proof.engines);
    expect(alone).toEqual(packaged);
    if (verb === "doctor") {
      expect(
        DoctorReportSchema.parse(JSON.parse(alone.stdout)).settings
      ).toBeDefined();
    }
  }
  expect(await checkoutAt(root).files()).toEqual(before);
  expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
  const noEngine = await proof.run(
    ["check", "README.md", "--json"],
    root,
    proof.gitOnly
  );
  expect(noEngine.exitCode).toBe(2);
  expect(noEngine.stdout).toContain("rumdl is not on PATH");
});

test("standalone rope previews and applies fenced repairs through its embedded runtime", async () => {
  if (proof.needsTools("git", "rumdl")) {
    return;
  }
  const root = await proof.fixture(
    "fences",
    "# Guide\n\n```ts\nconst  a = 1\n```\n\n```js\nconst  b = 2\n```\n"
  );
  const before = await checkoutAt(root).files();
  const index = await readFile(path.join(root, ".git/index"));
  const preview = await proof.run(
    ["fix", "README.md", "--dry-run", "--json"],
    root
  );
  expect(preview.exitCode).toBe(0);
  const previewed = FixReportSchema.parse(JSON.parse(preview.stdout));
  expect(previewed.dryRun).toBe(true);
  expect(previewed.changed).toEqual(["README.md"]);
  expect(previewed.diff).toBe(
    "--- a/README.md\n+++ b/README.md\n@@ -1,9 +1,9 @@\n # Guide\n \n ```ts\n-const  a = 1\n+const a = 1;\n ```\n \n ```js\n-const  b = 2\n+const b = 2;\n ```\n"
  );
  expect(await checkoutAt(root).files()).toEqual(before);
  expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
  const fixed = await proof.run(["fix", "README.md", "--json"], root);
  expect(fixed.exitCode).toBe(0);
  const applied = FixReportSchema.parse(JSON.parse(fixed.stdout));
  expect(applied.dryRun).toBe(false);
  expect(applied.changed).toEqual(previewed.changed);
  expect(applied.diff).toBe(previewed.diff);
  expect(await Bun.file(path.join(root, "README.md")).text()).toBe(
    "# Guide\n\n```ts\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```\n"
  );
  const checked = await proof.run(["check", "README.md", "--json"], root);
  expect(checked.exitCode).toBe(0);
});

test.skipIf(process.platform !== "darwin")(
  "standalone rope recovers a native Taplo panic with its embedded worker",
  async () => {
    if (proof.needsTools("git", "rumdl")) {
      return;
    }
    const root = await proof.fixture("taplo-recovery");
    await qualifyStandaloneTaplo(proof.binary, root);
  }
);

test("rope keeps its shipped preset when the external engine is unavailable", async () => {
  if (proof.needsTools("git", "rumdl")) {
    return;
  }
  const root = await proof.fixture("missing-engine-setup");
  await rm(path.join(root, ".ropes"), { recursive: true });
  await rm(path.join(root, ".rumdl.toml"));
  const repaired = await proof.run(
    ["doctor", "--fix", "--json"],
    root,
    proof.gitOnly
  );
  expect(repaired.exitCode).toBe(2);
  const kept = await Bun.file(
    path.join(root, ".ropes/configs/presets/rumdl.toml")
  ).text();
  expect(
    kept.endsWith(
      await Bun.file(
        new URL("../../cinch/presets/rumdl.toml", import.meta.url)
      ).text()
    )
  ).toBe(true);
});

test("mise installs the checked rope and verifies cache identity without Bun", async () => {
  if (proof.needsTools("mise", "git", "rumdl", "taplo")) {
    return;
  }
  await qualifyMiseInstall({
    binary: proof.binary,
    engines: proof.engines,
    root: await proof.fixture("mise-install"),
  });
}, 30_000);

test("read-only rope keeps its Bun helper outside the checkout", async () => {
  if (proof.needsTools("git", "rumdl")) {
    return;
  }
  await qualifyStandaloneCache({
    binary: proof.binary,
    contents:
      "# Guide\n\n```ts\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```\n",
    root: await proof.fixture("cache-fixture"),
    run: async (command, cwd, expected, env) => {
      const ran = await proof.command(command, cwd, proof.engines, env);
      expect(
        ran.exitCode,
        `${command.join(" ")}\n${ran.stdout}\n${ran.stderr}`
      ).toBe(expected ?? 0);
      return ran;
    },
  });
});

test("rope carries its shipped rules with no Bun in reach", async () => {
  if (proof.needsTools("git", "rumdl", "ast-grep")) {
    return;
  }
  const root = await proof.fixture("rules");
  await Bun.write(
    path.join(root, "rope.toml"),
    'pilot = 0\ninclude = ["**/*.json"]\n[rules]\nenabled = true\npacks = ["config"]\n'
  );
  await Bun.write(path.join(root, "tsconfig.json"), "{}\n");
  const result = await proof.run(["check", "tsconfig.json", "--json"], root);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("config/tsconfig-extends");
});
