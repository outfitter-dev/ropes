import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fixtureGit, runEntry } from "../../cinch/tests/acceptance-repo.ts";

const cli = new URL("../src/cli.ts", import.meta.url);
test("rope lists public schemas and describes real versioned output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rope-schema-"));
  const run = (...args: readonly string[]) => runEntry(cli, args, root);
  try {
    await fixtureGit(root, "init", "--quiet");
    await Bun.write(
      path.join(root, "rope.toml"),
      "pilot = 0\n[markdown]\nenabled = false\npreset = false\n[toml]\nenabled = false\n"
    );
    await Bun.write(path.join(root, "README.md"), "# Guide\n");
    await fixtureGit(root, "add", ".");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");

    const listing = await run("schema", "--json");
    expect(listing.exitCode).toBe(0);
    expect(JSON.parse(listing.stdout)).toEqual({
      commands: [
        "check",
        "check migration",
        "doctor",
        "explain",
        "explain migration",
        "failure",
        "fix",
        "init",
      ],
      files: ["config"],
      schemaVersion: 3,
    });
    for (const command of ["explain", "check", "fix", "init"]) {
      // eslint-disable-next-line no-await-in-loop -- verify schema and report for each command
      const [schema, report] = await Promise.all([
        run("schema", command),
        run(command, ...(command === "init" ? [] : ["README.md"]), "--json"),
      ]);
      expect(schema.exitCode).toBe(0);
      expect(report.exitCode).toBe(0);
      expect(JSON.parse(schema.stdout)).toMatchObject({
        properties: { schemaVersion: { const: 3 } },
      });
      expect(JSON.parse(report.stdout)).toMatchObject({ schemaVersion: 3 });
    }

    const config = await run("schema", "config");
    expect(config.exitCode).toBe(0);
    expect(JSON.parse(config.stdout)).toMatchObject({
      properties: { pilot: { const: 0 } },
      title: "rope.toml",
    });

    const unknown = await run("schema", "constructor", "--json");
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain('No schema for \\"constructor\\"');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
