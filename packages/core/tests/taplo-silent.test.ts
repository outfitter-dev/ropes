import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { taploAdapter } from "../src/adapters/taplo/adapter.ts";
import { checkOne } from "./one-file.ts";

/**
 * Stands in for an engine that lints the file and exits 0, and only says
 * which files it read from its `from`th start on. It counts its starts.
 */
const QUIET = `#!/bin/sh
here=$(dirname "$0")
starts=$(($(cat "$here/starts") + 1))
echo "$starts" > "$here/starts"
for file; do :; done
if [ "$starts" -ge "$(cat "$here/from")" ]; then
  echo " INFO taplo:files: found files total=1 excluded=0 files=[\\"$file\\"] cwd=\\"$PWD\\"" >&2
fi
`;

/**
 * Stands in for an engine that finds a schema problem and exits 1, and only
 * names the check that failed from its `from`th start on.
 */
const UNNAMED = `#!/bin/sh
here=$(dirname "$0")
starts=$(($(cat "$here/starts") + 1))
echo "$starts" > "$here/starts"
for file; do :; done
{
  echo " INFO taplo:files: found files total=1 excluded=0 files=[\\"$file\\"] cwd=\\"$PWD\\""
  echo "error: 'nope' was unexpected"
  echo "  ┌─ $file:1:1"
  if [ "$starts" -ge "$(cat "$here/from")" ]; then
    echo "ERROR taplo:lint_files: invalid file error=schema validation failed path=\\"$file\\""
  fi
} >&2
exit 1
`;

const run = async (from: number, engine = QUIET) => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-quiet-"));
  try {
    const command = path.join(root, "engine");
    await Promise.all([
      Bun.write(command, engine),
      Bun.write(path.join(root, "starts"), "0"),
      Bun.write(path.join(root, "from"), String(from)),
      Bun.write(path.join(root, "a.toml"), "a = 1\n"),
    ]);
    await chmod(command, 0o755);
    const outcome = await checkOne(taploAdapter({ command }), {
      path: "a.toml",
      root,
    });
    const starts = Number(await Bun.file(path.join(root, "starts")).text());
    return { outcome, starts };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

test("an engine that says what it read is started once", async () => {
  const { outcome, starts } = await run(1);
  expect(outcome.status).toBe("passed");
  expect(starts).toBe(1);
});

test("an engine that ran without saying what it read is asked again", async () => {
  const { outcome, starts } = await run(3);
  expect(outcome.status).toBe("passed");
  expect(starts).toBe(3);
});

test("an engine that never says what it read is incomplete, not passed", async () => {
  const { outcome, starts } = await run(7);
  expect(outcome).toMatchObject({
    reason:
      "taplo did not say which files it read in 6 starts: it printed nothing",
    status: "incomplete",
  });
  expect(starts).toBe(6);
});

test("an engine that did not name the check that failed is asked again", async () => {
  const { outcome, starts } = await run(2, UNNAMED);
  expect(outcome.status).toBe("findings");
  expect(outcome.findings.map((finding) => finding.rule)).toEqual(["schema"]);
  expect(starts).toBe(2);
});

test("an engine that never names the check is incomplete, not a guess", async () => {
  const { outcome, starts } = await run(7, UNNAMED);
  expect(outcome).toMatchObject({
    reason: "taplo ran, but it did not say which check failed",
    status: "incomplete",
  });
  expect(starts).toBe(6);
});
