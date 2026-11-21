import { expect } from "bun:test";
import path from "node:path";

import { parsePlan, parseResult } from "@ropes/core";

import { FixReportSchema } from "../../cinch/src/contracts/fix.ts";
import { SCHEMA_VERSION } from "../../cinch/src/contracts/plan.ts";
import { json, proof, runEntry } from "../../cinch/tests/acceptance-repo.ts";
import manifest from "../package.json" with { type: "json" };

const ROPE = new URL(manifest.bin.rope, new URL("../", import.meta.url));
const CORE = new URL("core-entry.ts", import.meta.url);

proof(
  "Cinch, rope and core agree on the Markdown fixture",
  async ({ main, emptyPath }) => {
    const setup = await main.cinch(["doctor", "--fix"]);
    expect(setup.exitCode).toBe(0);
    await Bun.write(path.join(main.root, "clean.md"), "# Clean\n\nText.\n");
    const before = await main.files();

    const compare = async (
      verb: string,
      file: string,
      expectedExit: number,
      options: { path?: string; preview?: boolean } = {}
    ) => {
      const args = [
        verb,
        file,
        "--json",
        ...(options.preview === true ? ["--dry-run"] : []),
      ];
      const [cinch, rope, core] = await Promise.all([
        main.cinch(args, options),
        runEntry(ROPE, args, main.root, options.path),
        runEntry(CORE, [verb, file], main.root, options.path),
      ]);
      expect([cinch.exitCode, rope.exitCode, core.exitCode]).toEqual([
        expectedExit,
        expectedExit,
        expectedExit,
      ]);
      expect([cinch.stderr, rope.stderr, core.stderr]).toEqual(["", "", ""]);
      const document = json(cinch);
      expect(json(rope)).toEqual(document);
      expect(json(core)).toEqual(document);
      return document;
    };

    const clean = parseResult(await compare("check", "clean.md", 0));
    expect(clean).toMatchObject({
      ok: true,
      value: {
        steps: [
          { adapter: "rumdl", path: "clean.md", status: "passed" },
          { adapter: "lychee", path: "clean.md", status: "passed" },
        ],
      },
    });
    const findings = parseResult(await compare("check", "README.md", 1));
    if (!findings.ok) {
      throw new Error(JSON.stringify(findings.error));
    }
    expect(findings.value.outcome).toBe("findings");
    expect(
      findings.value.steps.flatMap((step) =>
        step.findings.map(({ rule }) => rule)
      )
    ).toContain("MD025");
    const missing = parseResult(
      await compare("check", "README.md", 2, { path: emptyPath })
    );
    expect(missing).toMatchObject({
      ok: true,
      value: { outcome: "incomplete" },
    });
    const explained = parsePlan(await compare("explain", "legacy/old.md", 0));
    expect(explained).toMatchObject({
      ok: true,
      value: {
        paths: [
          {
            policy: [
              {
                key: "markdown.enabled",
                source: {
                  file: "cinch.toml",
                  key: "overrides.0.markdown.enabled",
                },
                value: false,
              },
              { key: "toml.enabled" },
            ],
            steps: [],
          },
        ],
      },
    });
    const preview = FixReportSchema.parse(
      await compare("fix", "README.md", 0, { preview: true })
    );
    expect(preview).toMatchObject({
      changed: ["README.md"],
      dryRun: true,
      schemaVersion: SCHEMA_VERSION,
    });
    expect(preview.diff).toContain("-# Second title\n+## Second title");
    expect(await main.files()).toEqual(before);
  }
);
