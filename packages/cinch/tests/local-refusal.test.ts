import { expect, test } from "bun:test";
import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { scanBatch } from "../src/adapters/ast-grep/run.ts";

/** Stands in for the engine: counts its starts and refuses every one. */
const refuser = (log: string): string =>
  `#!/bin/sh\necho start >> '${log}'\necho 'Error: Cannot parse rule' >&2\necho '╰▻ unknown field' >&2\nexit 8\n`;

test("a refused local rule is looked for once, not once for each file", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-rf-")));
  try {
    const log = path.join(root, "starts.log");
    const binary = path.join(root, "engine.sh");
    await Bun.write(binary, refuser(log));
    await chmod(binary, 0o755);
    await Bun.write(path.join(root, "rules/bad.yml"), "id: bad\n");
    const paths = ["a.ts", "b.ts", "c.ts"];
    await Promise.all(
      paths.map((file) => Bun.write(path.join(root, file), "export {};\n"))
    );
    const outcomes = await scanBatch(
      binary,
      "engine",
      { package: ".", paths, root, rules: [] },
      ["rules"]
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "incomplete",
      "incomplete",
      "incomplete",
    ]);
    expect(JSON.stringify(outcomes[0])).toContain(
      "rules/bad.yml: unknown field"
    );
    const starts = await Bun.file(log).text();
    expect(starts.trim().split("\n")).toHaveLength(2);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
