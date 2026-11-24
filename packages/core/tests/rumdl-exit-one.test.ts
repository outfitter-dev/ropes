import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runBatch } from "../src/adapters/rumdl/run.ts";

/**
 * Stands in for an engine that exits 1 with no finding in its JSON, and
 * prints on stderr whatever the `warns` file beside it holds.
 */
const ENGINE = `#!/bin/sh
cat "$(dirname "$0")/warns" >&2
echo "[]"
exit 1
`;

const run = async (warns: string) => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-exit-one-"));
  try {
    const command = path.join(root, "engine");
    await Promise.all([
      Bun.write(command, ENGINE),
      Bun.write(path.join(root, "warns"), warns),
      Bun.write(path.join(root, "a.md"), "# A\n"),
      Bun.write(path.join(root, "b.md"), "# B\n"),
    ]);
    await chmod(command, 0o755);
    return await runBatch(
      command,
      { package: ".", paths: ["a.md", "b.md"], root },
      []
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test("exit 1 with nothing reported leaves every file incomplete", async () => {
  const outcomes = await run("");
  expect(outcomes.map((outcome) => outcome.reason)).toEqual([
    "rumdl exited 1 without reporting a finding",
    "rumdl exited 1 without reporting a finding",
  ]);
});

test("exit 1 with only a fence warning gives that file its own reason", async () => {
  const outcomes = await run(
    "Warning: a.md:3: [bun] error: Cannot load the configuration file\n"
  );
  expect(outcomes).toEqual([
    {
      findings: [],
      path: "a.md",
      reason:
        "rumdl ran, but the formatter's config did not load, so the fenced block at line 3 was not checked. Are the repository's dependencies installed?",
      status: "incomplete",
    },
    { findings: [], path: "b.md", status: "passed" },
  ]);
});

test("a file that is gone when its comments are read is incomplete, never passed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-exit-one-"));
  try {
    const command = path.join(root, "engine");
    await Bun.write(command, '#!/bin/sh\necho "[]"\n');
    await chmod(command, 0o755);
    const outcomes = await runBatch(
      command,
      { package: ".", paths: ["gone.md"], root },
      []
    );
    expect(outcomes).toEqual([
      {
        findings: [],
        path: "gone.md",
        reason:
          "rumdl ran, but the file is gone, so its comments could not be read",
        status: "incomplete",
      },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
