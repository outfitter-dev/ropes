import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { scanBatch } from "../src/adapters/ast-grep/run.ts";

const RULE = "id: bad\nlanguage: typescript\nrule:\n  pattern: a\n";

/** Exits 2 for every start, and records one line each time it is run. */
const REFUSES = `#!/bin/sh
echo x >> "$(dirname "$0")/runs"
exit 2
`;

/**
 * A start of several files cannot run. One file, or a rule on its own, can.
 * That is the failure `inChunks` splits, when it is not a refused rule.
 */
const SPLIT = `#!/bin/sh
rule=0
seen=0
paths=0
for arg in "$@"; do
  if [ "$seen" = 1 ]; then
    paths=$((paths + 1))
  fi
  if [ "$arg" = "--rule" ]; then
    rule=1
  fi
  if [ "$arg" = "--json=compact" ]; then
    seen=1
  fi
done
if [ "$rule" = 0 ] && [ "$paths" -gt 1 ]; then
  echo "unreadable" >&2
  exit 2
fi
echo "[]"
exit 0
`;

const withRules = async (
  engine: string,
  check: (root: string, command: string) => Promise<void>
): Promise<void> => {
  const root = await mkdtemp(path.join(tmpdir(), "cinch-refused-"));
  try {
    const command = path.join(root, "engine");
    await Promise.all([
      Bun.write(command, engine),
      Bun.write(path.join(root, "a.ts"), "console.log(1);\n"),
      Bun.write(path.join(root, "b.ts"), "console.log(2);\n"),
      Bun.write(path.join(root, "rules", "bad.yml"), RULE),
    ]);
    await chmod(command, 0o755);
    await check(root, command);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const input = (root: string) => ({
  package: ".",
  paths: ["a.ts", "b.ts"],
  root,
  rules: [],
});

test("a refused local rule is diagnosed once for the batch", async () => {
  await withRules(REFUSES, async (root, command) => {
    const outcomes = await scanBatch(command, "ast-grep", input(root), [
      "rules",
    ]);
    const recorded = await Bun.file(path.join(root, "runs")).text();
    expect(recorded.trim().split("\n")).toHaveLength(2);
    expect(outcomes).toEqual([
      {
        findings: [],
        path: "a.ts",
        reason: "rules/bad.yml: the engine refused it",
        status: "incomplete",
      },
      {
        findings: [],
        path: "b.ts",
        reason: "rules/bad.yml: the engine refused it",
        status: "incomplete",
      },
    ]);
  });
});

test("a failed batch is still retried per file when no rule was refused", async () => {
  await withRules(SPLIT, async (root, command) => {
    const outcomes = await scanBatch(command, "ast-grep", input(root), [
      "rules",
    ]);
    expect(outcomes).toEqual([
      { findings: [], path: "a.ts", status: "passed" },
      { findings: [], path: "b.ts", status: "passed" },
    ]);
  });
});
