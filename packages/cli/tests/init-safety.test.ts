import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FixReportSchema } from "../../cinch/src/contracts/fix.ts";
import {
  checkoutAt,
  fixtureGit,
  runEntry,
} from "../../cinch/tests/acceptance-repo.ts";

const cli = new URL("../src/cli.ts", import.meta.url);

const inRepo = async (run: (root: string) => Promise<void>) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "rope-init-")));
  try {
    await fixtureGit(root, "init", "--quiet");
    await Bun.write(path.join(root, "README.md"), "# Guide\n");
    await fixtureGit(root, "add", "README.md");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const hasRumdl = (): boolean => {
  if (Bun.which("rumdl") !== null) {
    return true;
  }
  if (process.env.CI === "true") {
    throw new Error("Ropes setup migration tests require rumdl on PATH.");
  }
  console.warn("skipped: rumdl is required for setup migration proofs");
  return false;
};

test("rejected initialization keeps implicit Cinch setup in place", async () => {
  if (!hasRumdl()) {
    return;
  }
  await inRepo(async (root) => {
    const old = await runEntry(cli, ["doctor", "--fix", "--json"], root);
    expect(old.exitCode).toBe(0);
    const checkout = checkoutAt(root);
    const before = await checkout.files();
    const index = await readFile(path.join(root, ".git/index"));
    const preview = await runEntry(cli, ["init", "--json"], root);
    const apply = await runEntry(cli, ["init", "--yes", "--json"], root);
    expect(preview.exitCode).toBe(1);
    expect(apply).toEqual(preview);
    expect(apply.stdout).toContain("legacy managed directory");
    expect(await checkout.files()).toEqual(before);
    expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
  });
});

const markdown = {
  config: { MD007: { indent: 4 } },
  globs: ["docs/**/*.md"],
  ignores: ["docs/vendor"],
};

test.each([
  { config: markdown, source: ".markdownlint-cli2.jsonc" },
  { config: { "markdownlint-cli2": markdown }, source: "package.json" },
])(
  "init previews the scope and rules from ignored $source",
  async ({ config, source }) => {
    if (!hasRumdl()) {
      return;
    }
    await inRepo(async (root) => {
      await Bun.write(path.join(root, ".gitignore"), `${source}\n`);
      const old = `${JSON.stringify(config)}\n`;
      await Bun.write(path.join(root, source), old);
      const checkout = checkoutAt(root);
      const before = await checkout.files();
      const preview = await runEntry(cli, ["init", "--json"], root);
      expect(preview.exitCode).toBe(0);
      const proposed = FixReportSchema.parse(JSON.parse(preview.stdout));
      expect(proposed.diff).toContain('"docs/**/*.md"');
      expect(proposed.diff).toContain('"docs/vendor/**"');
      expect(proposed.diff).toContain("indent = 4");
      expect(await checkout.files()).toEqual(before);
      const apply = await runEntry(cli, ["init", "--yes", "--json"], root);
      expect(apply.exitCode).toBe(0);
      expect(FixReportSchema.parse(JSON.parse(apply.stdout)).diff).toBe(
        proposed.diff
      );
      expect(await readFile(path.join(root, source), "utf-8")).toBe(old);
    });
  }
);
